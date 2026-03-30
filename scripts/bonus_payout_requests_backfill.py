#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


def load_preflight_module() -> Any:
    path = Path(__file__).with_name('bonus_payout_requests_preflight.py')
    spec = importlib.util.spec_from_file_location('bonus_payout_requests_preflight', path)
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


def build_apply_sql(entries: list[dict[str, Any]]) -> str:
    statements: list[str] = ['BEGIN;']
    for entry in entries:
        for row in entry['sqliteRows']:
            statements.append(
                'INSERT INTO "BonusPayoutRequest" ("employeeId", year, month, "requestedAmount", note, status, "createdAt", "updatedAt") VALUES '
                f'({sql_literal(entry["employeeId"])}, {sql_literal(entry["year"])}, {sql_literal(entry["month"])}, '
                f'{sql_literal(row["requestedAmount"])}, {sql_literal(row["note"])}, {sql_literal(row["status"])}, '
                f'{sql_literal(row["createdAt"])}, {sql_literal(row["updatedAt"])});'
            )
    statements.append('COMMIT;')
    return '\n'.join(statements)


def main() -> int:
    parser = argparse.ArgumentParser(description='Controlled backfill for bonus payout requests SQLite -> PostgreSQL.')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json', type=Path)
    args = parser.parse_args()

    pre = load_preflight_module()
    payload = pre.build_payload(args.app_container, args.db_container)
    db_env = pre.docker_env(args.db_container)

    blocking = {
        'missing_sqlite': payload['classes']['missing_sqlite'],
        'raw_mismatch': payload['classes']['raw_mismatch'],
        'orphans': payload['classes']['orphans'],
    }
    if any(blocking.values()):
        raise RuntimeError(json.dumps(blocking, ensure_ascii=False))

    insert_candidates = payload['classes']['missing_pg']
    executed_sql = False
    inserted_group_keys: list[str] = []
    inserted_row_count = 0
    if insert_candidates and args.apply:
        sql = build_apply_sql(insert_candidates)
        pre.run(
            [
                'docker', 'exec', '-i', '-e', f"PGPASSWORD={db_env.get('POSTGRES_PASSWORD', '')}",
                args.db_container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', db_env['POSTGRES_USER'], '-d', db_env['POSTGRES_DB'], '-q',
            ],
            input_text=sql,
        )
        executed_sql = True
        inserted_group_keys = [entry['key'] for entry in insert_candidates]
        inserted_row_count = sum(len(entry['sqliteRows']) for entry in insert_candidates)

    summary = {
        'meta': {
            'appContainer': args.app_container,
            'dbContainer': args.db_container,
            'applied': args.apply,
            'executedSql': executed_sql,
        },
        'insertCandidateGroups': [entry['key'] for entry in insert_candidates],
        'insertedGroupKeys': inserted_group_keys,
        'insertedRowCount': inserted_row_count,
        'conflictFreeGroups': [entry['key'] for entry in payload['classes']['conflict_free']],
    }

    print('bonus_payout_requests_backfill')
    print(f"  applied: {str(args.apply).lower()}")
    print(f"  executed_sql: {str(executed_sql).lower()}")
    print(f"  insert_candidate_groups: {summary['insertCandidateGroups']}")
    print(f"  inserted_group_keys: {inserted_group_keys}")
    print(f"  inserted_row_count: {inserted_row_count}")

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
        print(f'bonus payout request backfill failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
