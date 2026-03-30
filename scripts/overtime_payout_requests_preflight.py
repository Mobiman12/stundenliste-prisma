#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
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
const hasTable = !!db.prepare(
  `SELECT name FROM sqlite_master WHERE type = ? AND name = ?`
).get('table', 'overtime_payout_requests');
const rows = hasTable
  ? db.prepare(`
      SELECT rowid AS _rowid, employee_id, year, month, requested_hours, note, status, created_at, updated_at
      FROM overtime_payout_requests
      ORDER BY employee_id, year, month, created_at, updated_at, rowid
    `).all()
  : [];
console.log(JSON.stringify({ databasePath: path, hasTable, rows }));
""".strip()

SQL_PG_TABLE_EXISTS = """
SELECT CASE
  WHEN to_regclass('public."OvertimePayoutRequest"') IS NULL THEN 'false'
  ELSE 'true'
END;
""".strip()

SQL_PG_ROWS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "employeeId", year, month, "createdAt", "updatedAt", id), '[]'::json)
FROM (
  SELECT
    id,
    "employeeId",
    year,
    month,
    "requestedHours",
    note,
    status,
    to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
    to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
  FROM "OvertimePayoutRequest"
  ORDER BY "employeeId", year, month, "createdAt", "updatedAt", id
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


def psql_scalar(db_container: str, db_env: dict[str, str], sql: str) -> str:
    return run(
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


def load_sqlite_rows(app_container: str) -> tuple[str | None, bool, list[dict[str, Any]]]:
    output = run(['docker', 'exec', '-i', app_container, 'node', '-'], input_text=SQLITE_NODE_SCRIPT)
    payload = json.loads(output)
    return payload.get('databasePath'), bool(payload.get('hasTable')), payload.get('rows', [])


def to_number(value: Any) -> float:
    if value is None:
        return 0.0
    numeric = float(value)
    if numeric != numeric or numeric in (float('inf'), float('-inf')):
        return 0.0
    return numeric


def canonical_row(row: dict[str, Any], employee_key: str) -> dict[str, Any]:
    requested_hours = row.get('requested_hours') if employee_key == 'employee_id' else row.get('requestedHours')
    created_at = row.get('created_at') if employee_key == 'employee_id' else row.get('createdAt')
    updated_at = row.get('updated_at') if employee_key == 'employee_id' else row.get('updatedAt')
    return {
        'id': int(row['id']) if row.get('id') is not None else None,
        'employeeId': int(row[employee_key]),
        'year': int(row['year']),
        'month': int(row['month']),
        'requestedHours': to_number(requested_hours),
        'note': row.get('note') if row.get('note') is not None else None,
        'status': str(row.get('status') or 'pending'),
        'createdAt': str(created_at or ''),
        'updatedAt': str(updated_at or ''),
        '_rowid': row.get('_rowid'),
    }


def group_key(row: dict[str, Any]) -> tuple[int, int, int]:
    return (int(row['employeeId']), int(row['year']), int(row['month']))


def group_label(key: tuple[int, int, int]) -> str:
    employee_id, year, month = key
    return f'{employee_id}:{year}-{month:02d}'


def row_identity(row: dict[str, Any]) -> tuple[float, str | None, str, str, str]:
    return (
        row['requestedHours'],
        row['note'],
        row['status'],
        row['createdAt'],
        row['updatedAt'],
    )


def raw_payload(row: dict[str, Any], *, source: str) -> dict[str, Any]:
    payload = {
        'requestedHours': row['requestedHours'],
        'note': row['note'],
        'status': row['status'],
        'createdAt': row['createdAt'],
        'updatedAt': row['updatedAt'],
    }
    if source == 'sqlite':
        payload['rowid'] = row.get('_rowid')
    else:
        payload['id'] = row.get('id')
    return payload


def sort_payloads(rows: list[dict[str, Any]], *, source: str) -> list[dict[str, Any]]:
    return sorted(
        [raw_payload(row, source=source) for row in rows],
        key=lambda row: (
            row['createdAt'],
            row['updatedAt'],
            row['requestedHours'],
            row['status'],
            row['note'] or '',
            row.get('rowid', row.get('id', 0)) or 0,
        ),
    )


def counter_from_rows(rows: list[dict[str, Any]]) -> Counter[tuple[float, str | None, str, str, str]]:
    return Counter(row_identity(row) for row in rows)


def diff_rows(sqlite_rows: list[dict[str, Any]], pg_rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    sqlite_counter = counter_from_rows(sqlite_rows)
    pg_counter = counter_from_rows(pg_rows)
    sqlite_only: list[dict[str, Any]] = []
    pg_only: list[dict[str, Any]] = []

    for identity, count in sorted((sqlite_counter - pg_counter).items()):
        requested_hours, note, status, created_at, updated_at = identity
        for _ in range(count):
            sqlite_only.append(
                {
                    'requestedHours': requested_hours,
                    'note': note,
                    'status': status,
                    'createdAt': created_at,
                    'updatedAt': updated_at,
                }
            )

    for identity, count in sorted((pg_counter - sqlite_counter).items()):
        requested_hours, note, status, created_at, updated_at = identity
        for _ in range(count):
            pg_only.append(
                {
                    'requestedHours': requested_hours,
                    'note': note,
                    'status': status,
                    'createdAt': created_at,
                    'updatedAt': updated_at,
                }
            )

    return {
        'sqliteOnly': sqlite_only,
        'pgOnly': pg_only,
    }


def build_payload(app_container: str, db_container: str) -> dict[str, Any]:
    db_env = docker_env(db_container)
    sqlite_path, sqlite_has_table, sqlite_rows_raw = load_sqlite_rows(app_container)
    pg_has_table = psql_scalar(db_container, db_env, SQL_PG_TABLE_EXISTS).strip().lower() == 'true'
    pg_rows_raw = psql_json(db_container, db_env, SQL_PG_ROWS) if pg_has_table else []
    employee_ids = set(psql_json(db_container, db_env, SQL_EMPLOYEE_IDS) or [])

    sqlite_rows = [canonical_row(row, 'employee_id') for row in sqlite_rows_raw]
    pg_rows = [canonical_row(row, 'employeeId') for row in (pg_rows_raw or [])]

    sqlite_groups: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    pg_groups: dict[tuple[int, int, int], list[dict[str, Any]]] = {}

    for row in sqlite_rows:
        sqlite_groups.setdefault(group_key(row), []).append(row)
    for row in pg_rows:
        pg_groups.setdefault(group_key(row), []).append(row)

    classes: dict[str, list[dict[str, Any]]] = {name: [] for name in CLASS_ORDER}

    for key in sorted(set(sqlite_groups) | set(pg_groups)):
        sqlite_group = sqlite_groups.get(key, [])
        pg_group = pg_groups.get(key, [])
        employee_id, year, month = key
        entry = {
            'key': group_label(key),
            'employeeId': employee_id,
            'year': year,
            'month': month,
            'sqliteRows': sort_payloads(sqlite_group, source='sqlite'),
            'pgRows': sort_payloads(pg_group, source='pg'),
        }

        if employee_id not in employee_ids:
            entry['source'] = 'both' if sqlite_group and pg_group else ('sqlite' if sqlite_group else 'pg')
            classes['orphans'].append(entry)
            continue
        if not sqlite_group:
            classes['missing_sqlite'].append(entry)
            continue
        if not pg_group:
            classes['missing_pg'].append(entry)
            continue
        if counter_from_rows(sqlite_group) != counter_from_rows(pg_group):
            entry['diff'] = diff_rows(sqlite_group, pg_group)
            classes['raw_mismatch'].append(entry)
            continue
        classes['conflict_free'].append(entry)

    class_counts = {name: len(classes[name]) for name in CLASS_ORDER}
    ready_for_backfill = not any(classes[name] for name in ('missing_sqlite', 'raw_mismatch', 'orphans'))
    ready_for_cutover = not any(classes[name] for name in ('missing_pg', 'missing_sqlite', 'raw_mismatch', 'orphans'))
    overall_status = (
        'ready_for_cutover'
        if ready_for_cutover
        else 'ready_for_backfill'
        if ready_for_backfill
        else 'stop'
    )

    generated_at = datetime.now(UTC).isoformat().replace('+00:00', 'Z')
    return {
        'meta': {
            'generatedAt': generated_at,
            'appContainer': app_container,
            'dbContainer': db_container,
            'sqliteDatabasePath': sqlite_path,
            'sqliteHasTable': sqlite_has_table,
            'pgHasTable': pg_has_table,
            'sqliteRowCount': len(sqlite_rows),
            'pgRowCount': len(pg_rows),
        },
        'classes': classes,
        'classCounts': class_counts,
        'gate': {
            'readyForBackfill': ready_for_backfill,
            'readyForCutover': ready_for_cutover,
            'overallStatus': overall_status,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only compare for overtime payout requests SQLite vs PostgreSQL.')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json', type=Path)
    args = parser.parse_args()

    payload = build_payload(args.app_container, args.db_container)

    print('overtime_payout_requests_preflight')
    print(f"  sqlite_database_path: {payload['meta']['sqliteDatabasePath']}")
    print(f"  sqlite_has_table: {str(payload['meta']['sqliteHasTable']).lower()}")
    print(f"  pg_has_table: {str(payload['meta']['pgHasTable']).lower()}")
    print(f"  sqlite_row_count: {payload['meta']['sqliteRowCount']}")
    print(f"  pg_row_count: {payload['meta']['pgRowCount']}")
    for name in CLASS_ORDER:
        print(f"  {name}: {payload['classCounts'][name]}")
    print(f"  ready_for_backfill: {str(payload['gate']['readyForBackfill']).lower()}")
    print(f"  ready_for_cutover: {str(payload['gate']['readyForCutover']).lower()}")
    print(f"  overall_status: {payload['gate']['overallStatus']}")

    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print(f'  wrote_json: {args.output_json}')

    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:
        print(f'overtime payout request preflight failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
