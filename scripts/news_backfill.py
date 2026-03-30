#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


def load_preflight_module() -> Any:
    path = Path(__file__).with_name('news_preflight.py')
    spec = importlib.util.spec_from_file_location('news_preflight', path)
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


def build_apply_sql(tenant_id: str, entries: list[dict[str, Any]]) -> str:
    statements: list[str] = ['BEGIN;']
    for entry in entries:
        sqlite_raw = entry['sqliteRaw']
        if entry['entryType'] == 'news':
            statements.append(
                'DO $$\n'
                'BEGIN\n'
                f'  IF EXISTS (SELECT 1 FROM "News" WHERE id = {sql_literal(sqlite_raw["id"])} AND "tenantId" <> {sql_literal(tenant_id)}) THEN\n'
                '    RAISE EXCEPTION ''News id already belongs to another tenant'';\n'
                '  END IF;\n'
                f'  INSERT INTO "News" (id, "tenantId", title, content, "createdAt") VALUES ({sql_literal(sqlite_raw["id"])}, {sql_literal(tenant_id)}, {sql_literal(sqlite_raw["title"])}, {sql_literal(sqlite_raw["content"])}, {sql_literal(sqlite_raw["createdAt"])})\n'
                '  ON CONFLICT (id) DO NOTHING;\n'
                'END $$;'
            )
        elif entry['entryType'] == 'read':
            statements.append(
                'DO $$\n'
                'BEGIN\n'
                f'  INSERT INTO "EmployeeNewsRead" ("employeeId", "newsId", "readAt") VALUES ({sql_literal(sqlite_raw["employeeId"])}, {sql_literal(sqlite_raw["newsId"])}, {sql_literal(sqlite_raw["readAt"])})\n'
                '  ON CONFLICT ("employeeId", "newsId") DO NOTHING;\n'
                'END $$;'
            )
        else:
            raise RuntimeError(f'unsupported entry type: {entry["entryType"]}')
    statements.append("SELECT setval(pg_get_serial_sequence('\"News\"', 'id'), COALESCE((SELECT MAX(id) FROM \"News\"), 1), true);")
    statements.append('COMMIT;')
    return '\n'.join(statements)


def main() -> int:
    parser = argparse.ArgumentParser(description='Controlled news backfill SQLite -> PostgreSQL.')
    parser.add_argument('--tenant-id', required=True)
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--output-json', type=Path)
    args = parser.parse_args()

    pre = load_preflight_module()
    payload = pre.build_payload(args.app_container, args.db_container, args.tenant_id)
    db_env = pre.docker_env(args.db_container)

    if payload['classes']['orphans']:
        raise RuntimeError(json.dumps({'orphans': payload['classes']['orphans']}, ensure_ascii=False))
    if payload['classes']['raw_mismatch']:
        raise RuntimeError(json.dumps({'raw_mismatch': payload['classes']['raw_mismatch']}, ensure_ascii=False))
    if payload['classes']['missing_sqlite']:
        raise RuntimeError(json.dumps({'missing_sqlite': payload['classes']['missing_sqlite']}, ensure_ascii=False))

    apply_candidates = payload['classes']['missing_pg']
    executed_sql = False
    if apply_candidates and args.apply:
        sql = build_apply_sql(args.tenant_id, apply_candidates)
        pre.run(
            [
                'docker', 'exec', '-i', '-e', f"PGPASSWORD={db_env.get('POSTGRES_PASSWORD', '')}",
                args.db_container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', db_env['POSTGRES_USER'], '-d', db_env['POSTGRES_DB'], '-q',
            ],
            input_text=sql,
        )
        executed_sql = True

    summary = {
        'tenantId': args.tenant_id,
        'applied': args.apply,
        'executedSql': executed_sql,
        'missingPgKeys': [entry['key'] for entry in payload['classes']['missing_pg']],
        'conflictFreeKeys': [entry['key'] for entry in payload['classes']['conflict_free']],
    }

    print('news_backfill')
    print(f"  tenant_id: {args.tenant_id}")
    print(f"  applied: {str(args.apply).lower()}")
    print(f"  executed_sql: {str(executed_sql).lower()}")
    print(f"  missing_pg_keys: {summary['missingPgKeys']}")

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
        print(f'news backfill failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
