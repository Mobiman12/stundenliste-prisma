#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


def load_preflight_module() -> Any:
    path = Path(__file__).with_name('overtime_payouts_preflight.py')
    spec = importlib.util.spec_from_file_location('overtime_payouts_preflight', path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'unable to load preflight module from {path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sql_literal(value: Any) -> str:
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def build_insert_sql(rows: list[dict[str, Any]]) -> str:
    value_rows = []
    for row in rows:
        value_rows.append(
            '('
            + ', '.join(
                [
                    sql_literal(row['employeeId']),
                    sql_literal(row['year']),
                    sql_literal(row['month']),
                    sql_literal(row['sqliteRaw']['payoutHours']),
                ]
            )
            + ')'
        )
    return (
        'BEGIN;\n'
        'INSERT INTO "EmployeeOvertimePayout" ("employeeId", year, month, "payoutHours")\n'
        'VALUES\n  '
        + ',\n  '.join(value_rows)
        + ';\nCOMMIT;'
    )


def main() -> int:
    parser = argparse.ArgumentParser(description='Conservative backfill for SQLite employee_overtime_payouts -> PostgreSQL EmployeeOvertimePayout.')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json', type=Path)
    args = parser.parse_args()

    pre = load_preflight_module()
    payload = pre.build_payload(args.app_container, args.db_container)
    db_env = pre.docker_env(args.db_container)

    duplicate_sqlite = payload['integrity']['duplicateSqliteKeys']
    duplicate_pg = payload['integrity']['duplicatePgKeys']
    if duplicate_sqlite or duplicate_pg:
        raise RuntimeError(json.dumps({'duplicateSqliteKeys': duplicate_sqlite, 'duplicatePgKeys': duplicate_pg}, ensure_ascii=False))

    blocking = {
        'missing_sqlite': payload['classes']['missing_sqlite'],
        'raw_mismatch': payload['classes']['raw_mismatch'],
        'orphan_pg': [entry for entry in payload['classes']['orphans'] if entry['source'] in {'pg', 'both'}],
    }
    if any(blocking.values()):
        raise RuntimeError(json.dumps(blocking, ensure_ascii=False))

    insert_candidates = payload['classes']['missing_pg']
    executed_sql = False
    inserted_keys: list[str] = []
    if insert_candidates and args.apply:
        insert_sql = build_insert_sql(insert_candidates)
        pre.run(
            [
                'docker',
                'exec',
                '-e',
                f"PGPASSWORD={db_env.get('POSTGRES_PASSWORD', '')}",
                args.db_container,
                'psql',
                '-v',
                'ON_ERROR_STOP=1',
                '-U',
                db_env['POSTGRES_USER'],
                '-d',
                db_env['POSTGRES_DB'],
                '-q',
                '-c',
                insert_sql,
            ]
        )
        executed_sql = True
        inserted_keys = [entry['key'] for entry in insert_candidates]

    summary = {
        'meta': {
            'appContainer': args.app_container,
            'dbContainer': args.db_container,
            'applied': args.apply,
            'executedSql': executed_sql,
        },
        'insertCandidates': [entry['key'] for entry in insert_candidates],
        'insertedKeys': inserted_keys,
        'conflictFree': [entry['key'] for entry in payload['classes']['conflict_free']],
        'orphanSqliteUntouched': [entry['key'] for entry in payload['classes']['orphans'] if entry['source'] == 'sqlite'],
    }

    print('overtime_payouts_backfill')
    print(f"  applied: {str(args.apply).lower()}")
    print(f"  executed_sql: {str(executed_sql).lower()}")
    print(f"  insert_candidates: {summary['insertCandidates']}")
    print(f"  inserted_keys: {inserted_keys}")
    print(f"  orphan_sqlite_untouched: {summary['orphanSqliteUntouched']}")

    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print(f'  wrote_json: {args.output_json}')

    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:
        print(f'backfill failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
