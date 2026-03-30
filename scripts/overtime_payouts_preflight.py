#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

CLASS_ORDER = [
    'conflict_free',
    'missing_pg',
    'missing_sqlite',
    'raw_mismatch',
    'sum_mismatch',
    'orphans',
]

SQLITE_NODE_SCRIPT = r"""
const Database = require('better-sqlite3');
const path = process.env.DATABASE_PATH || '/app/database/mitarbeiter.db';
const db = new Database(path, { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT rowid AS _rowid, employee_id, year, month, payout_hours
  FROM employee_overtime_payouts
  ORDER BY employee_id, year, month, rowid
`).all();
console.log(JSON.stringify({ databasePath: path, rows }));
""".strip()

SQL_PG_ROWS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "employeeId", year, month), '[]'::json)
FROM (
  SELECT "employeeId", year, month, "payoutHours"
  FROM "EmployeeOvertimePayout"
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
        'payoutHours': round_two(
            to_number(row.get('payout_hours') if employee_key == 'employee_id' else row.get('payoutHours'))
        ),
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
    payload = {'payoutHours': row['payoutHours']}
    if source == 'sqlite':
        payload['rowid'] = row.get('_rowid')
    return payload


def duplicate_entries(rows: list[dict[str, Any]], *, source: str) -> list[dict[str, Any]]:
    grouped: dict[tuple[int, int, int], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row_key(row)].append(row)
    duplicates: list[dict[str, Any]] = []
    for key, items in sorted(grouped.items()):
        if len(items) < 2:
            continue
        duplicates.append(
            {
                'employeeId': key[0],
                'year': key[1],
                'month': key[2],
                'key': key_label(key),
                'source': source,
                'rows': [raw_payload(item, source=source) for item in items],
            }
        )
    return duplicates


def build_payload(app_container: str, db_container: str) -> dict[str, Any]:
    db_env = docker_env(db_container)
    sqlite_path, sqlite_rows_raw = load_sqlite_rows(app_container)
    pg_rows_raw = psql_json(db_container, db_env, SQL_PG_ROWS) or []
    employee_ids = set(psql_json(db_container, db_env, SQL_EMPLOYEE_IDS) or [])

    sqlite_rows = [canonical_row(row, 'employee_id') for row in sqlite_rows_raw]
    pg_rows = [canonical_row(row, 'employeeId') for row in pg_rows_raw]

    sqlite_duplicates = duplicate_entries(sqlite_rows, source='sqlite')
    pg_duplicates = duplicate_entries(pg_rows, source='pg')

    sqlite_by_key = {row_key(row): row for row in sqlite_rows}
    pg_by_key = {row_key(row): row for row in pg_rows}
    classes: dict[str, list[dict[str, Any]]] = {name: [] for name in CLASS_ORDER}

    all_keys = sorted(set(sqlite_by_key) | set(pg_by_key))
    for key in all_keys:
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
        if sqlite_row['payoutHours'] != pg_row['payoutHours']:
            entry['diffs'] = {
                'payoutHours': {
                    'sqlite': sqlite_row['payoutHours'],
                    'pg': pg_row['payoutHours'],
                }
            }
            classes['raw_mismatch'].append(entry)
            continue
        classes['conflict_free'].append(entry)

    valid_employee_points: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for key in all_keys:
        employee_id, year, month = key
        if employee_id not in employee_ids:
            continue
        valid_employee_points[employee_id].append((year, month))

    for employee_id, points in sorted(valid_employee_points.items()):
        sqlite_running = 0.0
        pg_running = 0.0
        for year, month in sorted(set(points)):
            key = (employee_id, year, month)
            sqlite_row = sqlite_by_key.get(key)
            pg_row = pg_by_key.get(key)
            if sqlite_row is not None:
                sqlite_running += sqlite_row['payoutHours']
            if pg_row is not None:
                pg_running += pg_row['payoutHours']
            sqlite_total = round_two(sqlite_running)
            pg_total = round_two(pg_running)
            if sqlite_total != pg_total:
                classes['sum_mismatch'].append(
                    {
                        'key': key_label(key),
                        'employeeId': employee_id,
                        'year': year,
                        'month': month,
                        'sqliteTotal': sqlite_total,
                        'pgTotal': pg_total,
                    }
                )

    class_counts = {name: len(classes[name]) for name in CLASS_ORDER}
    integrity = {
        'duplicateSqliteKeys': sqlite_duplicates,
        'duplicatePgKeys': pg_duplicates,
    }
    hard_stop = bool(sqlite_duplicates or pg_duplicates)
    orphan_pg = [entry for entry in classes['orphans'] if entry['source'] in {'pg', 'both'}]
    ready_for_backfill = (
        not hard_stop
        and class_counts['missing_sqlite'] == 0
        and class_counts['raw_mismatch'] == 0
        and len(orphan_pg) == 0
    )
    ready_for_cutover = (
        ready_for_backfill
        and class_counts['missing_pg'] == 0
        and class_counts['sum_mismatch'] == 0
    )
    overall_status = 'stop'
    if ready_for_cutover:
        overall_status = 'ready_for_cutover'
    elif ready_for_backfill:
        overall_status = 'ready_for_backfill'

    return {
        'timestamp': datetime.now(UTC).isoformat(),
        'appContainer': app_container,
        'dbContainer': db_container,
        'sqlite': {'databasePath': sqlite_path, 'rowCount': len(sqlite_rows)},
        'pg': {'rowCount': len(pg_rows)},
        'employeeCount': len(employee_ids),
        'classCounts': class_counts,
        'classes': classes,
        'integrity': integrity,
        'gate': {
            'readyForBackfill': ready_for_backfill,
            'readyForCutover': ready_for_cutover,
            'overallStatus': overall_status,
        },
        'notes': {
            'rawComparisonUsesPayoutHours': True,
            'sumComparisonUsesRoundedCumulativeTotals': True,
            'sqliteOnlyOrphansAreInformational': True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only compare for SQLite employee_overtime_payouts -> PostgreSQL EmployeeOvertimePayout.')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json', type=Path)
    args = parser.parse_args()

    payload = build_payload(args.app_container, args.db_container)
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:
        print(f'preflight failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
