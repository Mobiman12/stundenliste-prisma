#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

CLASS_ORDER = [
    'conflict_free',
    'missing_pg',
    'missing_sqlite',
    'raw_mismatch',
    'orphans',
]

SQLITE_NODE_SCRIPT = r"""
const Database = require('better-sqlite3');
const path = process.env.DATABASE_PATH || '/app/database/mitarbeiter.db';
const db = new Database(path, { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT rowid AS _rowid, employee_id, year, month, auszahlung, uebertrag
  FROM employee_bonus
  ORDER BY employee_id, year, month, rowid
`).all();
console.log(JSON.stringify({ databasePath: path, rows }));
""".strip()

SQL_PG_ROWS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "employeeId", year, month), '[]'::json)
FROM (
  SELECT "employeeId", year, month, auszahlung, uebertrag
  FROM "EmployeeBonus"
  ORDER BY "employeeId", year, month
) t;
""".strip()

SQL_EMPLOYEE_IDS = """
SELECT COALESCE(json_agg("id" ORDER BY "id"), '[]'::json)
FROM "Employee";
""".strip()


def run(cmd: list[str], *, input_text: str | None = None) -> str:
    result = subprocess.run(cmd, input=input_text, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        stderr = result.stderr.strip()
        stdout = result.stdout.strip()
        details = stderr or stdout or f'exit {result.returncode}'
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{details}")
    return result.stdout.strip()


def docker_env(container: str) -> dict[str, str]:
    raw = run(['docker', 'inspect', container, '--format', '{{json .Config.Env}}'])
    env: dict[str, str] = {}
    for item in json.loads(raw):
        key, _, value = item.partition('=')
        env[key] = value
    return env


def psql_json(db_container: str, db_env: dict[str, str], sql: str) -> Any:
    output = run(
        [
            'docker',
            'exec',
            '-e',
            f"PGPASSWORD={db_env.get('POSTGRES_PASSWORD', '')}",
            db_container,
            'psql',
            '-U',
            db_env['POSTGRES_USER'],
            '-d',
            db_env['POSTGRES_DB'],
            '-Atqc',
            sql,
        ]
    )
    return json.loads(output) if output else None


def load_sqlite_rows(app_container: str) -> tuple[str | None, list[dict[str, Any]]]:
    output = run(['docker', 'exec', '-i', app_container, 'node', '-'], input_text=SQLITE_NODE_SCRIPT)
    payload = json.loads(output)
    return payload.get('databasePath'), payload.get('rows', [])


def round_two(value: float) -> float:
    return float(f'{value:.2f}')


def to_number(value: Any) -> float:
    if value is None:
        return 0.0
    numeric = float(value)
    if numeric != numeric or numeric in (float('inf'), float('-inf')):
        return 0.0
    return numeric


def canonical_row(row: dict[str, Any], employee_key: str) -> dict[str, Any]:
    return {
        'employeeId': int(row[employee_key]),
        'year': int(row['year']),
        'month': int(row['month']),
        'payout': round_two(to_number(row.get('auszahlung'))),
        'carryOver': round_two(to_number(row.get('uebertrag'))),
        '_rowid': row.get('_rowid'),
    }


def row_key(row: dict[str, Any]) -> tuple[int, int, int]:
    return (int(row['employeeId']), int(row['year']), int(row['month']))


def key_label(key: tuple[int, int, int]) -> str:
    employee_id, year, month = key
    return f'{employee_id}:{year}-{month:02d}'


def raw_payload(row: dict[str, Any] | None, *, source: str) -> dict[str, Any] | None:
    if row is None:
        return None
    payload = {
        'payout': row['payout'],
        'carryOver': row['carryOver'],
    }
    if source == 'sqlite':
        payload['rowid'] = row.get('_rowid')
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only preflight for bonus SQLite -> PostgreSQL EmployeeBonus.')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json')
    args = parser.parse_args()

    db_env = docker_env(args.db_container)
    sqlite_path, sqlite_rows_raw = load_sqlite_rows(args.app_container)
    pg_rows_raw = psql_json(args.db_container, db_env, SQL_PG_ROWS) or []
    employee_ids = set(psql_json(args.db_container, db_env, SQL_EMPLOYEE_IDS) or [])

    sqlite_rows = [canonical_row(row, 'employee_id') for row in sqlite_rows_raw]
    pg_rows = [canonical_row(row, 'employeeId') for row in pg_rows_raw]

    sqlite_by_key = {row_key(row): row for row in sqlite_rows}
    pg_by_key = {row_key(row): row for row in pg_rows}
    classes: dict[str, list[dict[str, Any]]] = {name: [] for name in CLASS_ORDER}

    for key in sorted(set(sqlite_by_key) | set(pg_by_key)):
        sqlite_row = sqlite_by_key.get(key)
        pg_row = pg_by_key.get(key)
        employee_id, year, month = key
        entry = {
            'key': key_label(key),
            'employeeId': employee_id,
            'year': year,
            'month': month,
            'sqliteRaw': raw_payload(sqlite_row, source='sqlite'),
            'pgRaw': raw_payload(pg_row, source='pg'),
        }

        sqlite_valid = sqlite_row is None or employee_id in employee_ids
        pg_valid = pg_row is None or employee_id in employee_ids
        if not sqlite_valid or not pg_valid:
            entry['source'] = 'both' if (not sqlite_valid and not pg_valid) else ('sqlite' if not sqlite_valid else 'pg')
            classes['orphans'].append(entry)
            continue
        if sqlite_row is None:
            classes['missing_sqlite'].append(entry)
            continue
        if pg_row is None:
            classes['missing_pg'].append(entry)
            continue
        if sqlite_row['payout'] != pg_row['payout'] or sqlite_row['carryOver'] != pg_row['carryOver']:
            entry['diffs'] = {
                'payout': {
                    'sqlite': sqlite_row['payout'],
                    'pg': pg_row['payout'],
                },
                'carryOver': {
                    'sqlite': sqlite_row['carryOver'],
                    'pg': pg_row['carryOver'],
                },
            }
            classes['raw_mismatch'].append(entry)
            continue
        classes['conflict_free'].append(entry)

    class_counts = {name: len(classes[name]) for name in CLASS_ORDER}
    ready_for_cutover = all(class_counts[name] == 0 for name in ('missing_pg', 'missing_sqlite', 'raw_mismatch', 'orphans'))
    ready_for_backfill = all(class_counts[name] == 0 for name in ('missing_pg', 'raw_mismatch', 'orphans'))
    overall_status = 'ready_for_cutover' if ready_for_cutover else ('ready_for_backfill' if ready_for_backfill else 'stop')

    payload = {
        'timestamp': datetime.now(UTC).isoformat(),
        'appContainer': args.app_container,
        'dbContainer': args.db_container,
        'sqlite': {
            'databasePath': sqlite_path,
            'rowCount': len(sqlite_rows),
        },
        'pg': {
            'rowCount': len(pg_rows),
        },
        'employeeCount': len(employee_ids),
        'classCounts': class_counts,
        'classes': classes,
        'gate': {
            'readyForBackfill': ready_for_backfill,
            'readyForCutover': ready_for_cutover,
            'overallStatus': overall_status,
        },
        'notes': {
            'targetTable': 'EmployeeBonus',
            'excludedModels': ['BonusMonat', 'BonusAuszahlung'],
            'excludedField': 'EmployeeBonus.bonusAusgezahlt',
        },
    }

    if args.output_json:
        output_path = Path(args.output_json)
        output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'bonus preflight failed: {exc}', file=sys.stderr)
        raise
