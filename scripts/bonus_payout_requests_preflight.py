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
).get('table', 'bonus_payout_requests');
const rows = hasTable
  ? db.prepare(`
      SELECT rowid AS _rowid, employee_id, year, month, requested_amount, note, status, created_at, updated_at
      FROM bonus_payout_requests
      ORDER BY employee_id, year, month, created_at, updated_at, rowid
    `).all()
  : [];
console.log(JSON.stringify({ databasePath: path, hasTable, rows }));
""".strip()

SQL_PG_ROWS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "employeeId", year, month, "createdAt", "updatedAt", id), '[]'::json)
FROM (
  SELECT
    id,
    "employeeId",
    year,
    month,
    "requestedAmount",
    note,
    status,
    to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
    to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
  FROM "BonusPayoutRequest"
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
    requested_amount = row.get('requested_amount') if employee_key == 'employee_id' else row.get('requestedAmount')
    created_at = row.get('created_at') if employee_key == 'employee_id' else row.get('createdAt')
    updated_at = row.get('updated_at') if employee_key == 'employee_id' else row.get('updatedAt')
    return {
        'id': int(row['id']) if row.get('id') is not None else None,
        'employeeId': int(row[employee_key]),
        'year': int(row['year']),
        'month': int(row['month']),
        'requestedAmount': to_number(requested_amount),
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
        row['requestedAmount'],
        row['note'],
        row['status'],
        row['createdAt'],
        row['updatedAt'],
    )


def raw_payload(row: dict[str, Any], *, source: str) -> dict[str, Any]:
    payload = {
        'requestedAmount': row['requestedAmount'],
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
            row['requestedAmount'],
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
        requested_amount, note, status, created_at, updated_at = identity
        for _ in range(count):
            sqlite_only.append(
                {
                    'requestedAmount': requested_amount,
                    'note': note,
                    'status': status,
                    'createdAt': created_at,
                    'updatedAt': updated_at,
                }
            )

    for identity, count in sorted((pg_counter - sqlite_counter).items()):
        requested_amount, note, status, created_at, updated_at = identity
        for _ in range(count):
            pg_only.append(
                {
                    'requestedAmount': requested_amount,
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
    pg_rows_raw = psql_json(db_container, db_env, SQL_PG_ROWS) or []
    employee_ids = set(psql_json(db_container, db_env, SQL_EMPLOYEE_IDS) or [])

    sqlite_rows = [canonical_row(row, 'employee_id') for row in sqlite_rows_raw]
    pg_rows = [canonical_row(row, 'employeeId') for row in pg_rows_raw]

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
            entry['diffs'] = diff_rows(sqlite_group, pg_group)
            classes['raw_mismatch'].append(entry)
            continue
        classes['conflict_free'].append(entry)

    class_counts = {name: len(classes[name]) for name in CLASS_ORDER}
    ready_for_backfill = all(class_counts[name] == 0 for name in ('missing_sqlite', 'raw_mismatch', 'orphans'))
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
            'hasTable': sqlite_has_table,
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
            'targetTable': 'BonusPayoutRequest',
            'comparisonKey': '(employeeId, year, month) with raw row multiset comparison',
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only preflight for bonus payout requests SQLite -> PostgreSQL.')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json', type=Path)
    args = parser.parse_args()

    payload = build_payload(args.app_container, args.db_container)

    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:
        print(f'bonus payout request preflight failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
