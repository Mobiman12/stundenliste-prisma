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
    'orphan_sqlite',
    'orphan_pg',
]

SQLITE_NODE_SCRIPT = r"""
const Database = require('better-sqlite3');
const path = process.env.DATABASE_PATH || '/app/database/mitarbeiter.db';
const db = new Database(path, { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT rowid AS _rowid, employee_id, year, month, status, closed_at, closed_by
  FROM monthly_closings
  ORDER BY employee_id, year, month, rowid
`).all();
console.log(JSON.stringify({ databasePath: path, rows }));
""".strip()

SQL_PG_ROWS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "employeeId", "year", "month", id), '[]'::json)
FROM (
  SELECT id, "employeeId", "year", "month", status, "closedAt", "closedBy"
  FROM "MonthlyClosing"
  ORDER BY "employeeId", "year", "month", id
) t;
""".strip()

SQL_EMPLOYEE_IDS = """
SELECT COALESCE(json_agg("id" ORDER BY "id"), '[]'::json)
FROM "Employee";
""".strip()


def run(cmd: list[str], *, input_text: str | None = None) -> str:
    result = subprocess.run(
        cmd,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        stdout = result.stdout.strip()
        details = stderr or stdout or f'exit {result.returncode}'
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{details}")
    return result.stdout.strip()


def docker_env(container: str) -> dict[str, str]:
    raw = run(['docker', 'inspect', container, '--format', '{{json .Config.Env}}'])
    items = json.loads(raw)
    env: dict[str, str] = {}
    for item in items:
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


def normalise_status(value: Any) -> str:
    return 'closed' if isinstance(value, str) and value.lower() == 'closed' else 'open'


def canonical_row(row: dict[str, Any], employee_key: str) -> dict[str, Any]:
    return {
        'employeeId': int(row[employee_key]),
        'year': int(row['year']),
        'month': int(row['month']),
        'status': normalise_status(row.get('status')),
        'closedAt': row.get('closed_at') if employee_key == 'employee_id' else row.get('closedAt'),
        'closedBy': row.get('closed_by') if employee_key == 'employee_id' else row.get('closedBy'),
        '_rowid': row.get('_rowid'),
        '_id': row.get('id'),
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
        'status': row['status'],
        'closedAt': row['closedAt'],
        'closedBy': row['closedBy'],
    }
    if source == 'sqlite':
        payload['rowid'] = row.get('_rowid')
    else:
        payload['id'] = row.get('_id')
    return payload


def diff_raw(sqlite_row: dict[str, Any], pg_row: dict[str, Any]) -> dict[str, dict[str, Any]]:
    diffs: dict[str, dict[str, Any]] = {}
    for field in ('status', 'closedAt', 'closedBy'):
        if sqlite_row.get(field) != pg_row.get(field):
            diffs[field] = {
                'sqlite': sqlite_row.get(field),
                'pg': pg_row.get(field),
            }
    return diffs


def duplicate_entries(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
                'rows': [raw_payload(item, source='sqlite' if item.get('_rowid') is not None else 'pg') for item in items],
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

    sqlite_duplicates = duplicate_entries(sqlite_rows)
    pg_duplicates = duplicate_entries(pg_rows)

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

        if sqlite_row and employee_id not in employee_ids:
            classes['orphan_sqlite'].append(entry)
            continue
        if pg_row and employee_id not in employee_ids:
            classes['orphan_pg'].append(entry)
            continue
        if sqlite_row is None:
            classes['missing_sqlite'].append(entry)
            continue
        if pg_row is None:
            classes['missing_pg'].append(entry)
            continue
        diffs = diff_raw(sqlite_row, pg_row)
        if diffs:
            entry['diffs'] = diffs
            classes['raw_mismatch'].append(entry)
            continue
        classes['conflict_free'].append(entry)

    class_counts = {name: len(classes[name]) for name in CLASS_ORDER}
    integrity = {
        'duplicateSqliteKeys': sqlite_duplicates,
        'duplicatePgKeys': pg_duplicates,
    }
    hard_stop = bool(sqlite_duplicates or pg_duplicates)
    ready_for_backfill = (
        not hard_stop
        and class_counts['missing_sqlite'] == 0
        and class_counts['raw_mismatch'] == 0
        and class_counts['orphan_pg'] == 0
    )
    ready_for_cutover = ready_for_backfill and class_counts['missing_pg'] == 0
    overall_status = 'stop'
    if ready_for_cutover:
        overall_status = 'ready_for_cutover'
    elif ready_for_backfill:
        overall_status = 'ready_for_backfill'

    return {
        'timestamp': datetime.now(UTC).isoformat(),
        'appContainer': app_container,
        'dbContainer': db_container,
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
        'integrity': integrity,
        'gate': {
            'readyForBackfill': ready_for_backfill,
            'readyForCutover': ready_for_cutover,
            'overallStatus': overall_status,
        },
        'notes': {
            'orphanSqliteIsInformational': True,
            'rawComparisonUsesStatusClosedAtClosedBy': True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only preflight for monthly closings SQLite -> Postgres.')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json')
    args = parser.parse_args()

    payload = build_payload(args.app_container, args.db_container)

    if args.output_json:
        output_path = Path(args.output_json)
        output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'monthly closings preflight failed: {exc}', file=sys.stderr)
        raise
