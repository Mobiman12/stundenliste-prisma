#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


def load_preflight_module() -> Any:
    path = Path(__file__).with_name('reminder_preflight.py')
    spec = importlib.util.spec_from_file_location('reminder_preflight', path)
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
        if entry['entryType'] == 'settings':
            statements.append(
                'DO $$\n'
                'BEGIN\n'
                f'  UPDATE "ReminderSettings" SET enabled = {sql_literal(sqlite_raw["enabled"])}, '
                f'"sendHour" = {sql_literal(sqlite_raw["sendHour"])}, subject = {sql_literal(sqlite_raw["subject"])}, '
                f'"contentTemplate" = {sql_literal(sqlite_raw["contentTemplate"])} '
                f'WHERE id = 1 AND "tenantId" = {sql_literal(tenant_id)};\n'
                '  IF FOUND THEN\n'
                '    RETURN;\n'
                '  END IF;\n'
                f'  IF EXISTS (SELECT 1 FROM "ReminderSettings" WHERE id = 1 AND "tenantId" <> {sql_literal(tenant_id)}) THEN\n'
                "    RAISE EXCEPTION 'ReminderSettings id=1 already belongs to another tenant';\n"
                '  END IF;\n'
                f'  INSERT INTO "ReminderSettings" ("tenantId", id, enabled, "sendHour", subject, "contentTemplate") VALUES ({sql_literal(tenant_id)}, 1, {sql_literal(sqlite_raw["enabled"])}, {sql_literal(sqlite_raw["sendHour"])}, {sql_literal(sqlite_raw["subject"])}, {sql_literal(sqlite_raw["contentTemplate"])});\n'
                'END $$;'
            )
        elif entry['entryType'] == 'log':
            statements.append(
                'DO $$\n'
                'BEGIN\n'
                f'  UPDATE "ReminderSendLog" SET "sentCount" = {sql_literal(sqlite_raw["sentCount"])}, '
                f'"errorCount" = {sql_literal(sqlite_raw["errorCount"])}, "sentAt" = {sql_literal(sqlite_raw["sentAt"])} '
                f'WHERE "periodKey" = {sql_literal(sqlite_raw["periodKey"])} AND "tenantId" = {sql_literal(tenant_id)};\n'
                '  IF FOUND THEN\n'
                '    RETURN;\n'
                '  END IF;\n'
                f'  IF EXISTS (SELECT 1 FROM "ReminderSendLog" WHERE "periodKey" = {sql_literal(sqlite_raw["periodKey"])} AND "tenantId" <> {sql_literal(tenant_id)}) THEN\n'
                "    RAISE EXCEPTION 'ReminderSendLog periodKey already belongs to another tenant';\n"
                '  END IF;\n'
                f'  INSERT INTO "ReminderSendLog" ("tenantId", "periodKey", "sentCount", "errorCount", "sentAt") VALUES ({sql_literal(tenant_id)}, {sql_literal(sqlite_raw["periodKey"])}, {sql_literal(sqlite_raw["sentCount"])}, {sql_literal(sqlite_raw["errorCount"])}, {sql_literal(sqlite_raw["sentAt"])});\n'
                'END $$;'
            )
        else:
            raise RuntimeError(f'unsupported entry type: {entry["entryType"]}')
    statements.append('COMMIT;')
    return '\n'.join(statements)


def main() -> int:
    parser = argparse.ArgumentParser(description='Controlled reminder backfill/sync SQLite -> PostgreSQL.')
    parser.add_argument('--tenant-id', required=True)
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--allow-sync-mismatch', action='store_true')
    parser.add_argument('--output-json', type=Path)
    args = parser.parse_args()

    pre = load_preflight_module()
    payload = pre.build_payload(args.app_container, args.db_container, args.tenant_id)
    db_env = pre.docker_env(args.db_container)

    if payload['classes']['orphans']:
        raise RuntimeError(json.dumps({'orphans': payload['classes']['orphans']}, ensure_ascii=False))
    if payload['classes']['missing_sqlite']:
        raise RuntimeError(json.dumps({'missing_sqlite': payload['classes']['missing_sqlite']}, ensure_ascii=False))
    if payload['classes']['raw_mismatch'] and not args.allow_sync_mismatch:
        raise RuntimeError(json.dumps({'raw_mismatch': payload['classes']['raw_mismatch']}, ensure_ascii=False))

    upsert_candidates = payload['classes']['missing_pg'] + payload['classes']['raw_mismatch']
    executed_sql = False
    if upsert_candidates and args.apply:
        sql = build_apply_sql(args.tenant_id, upsert_candidates)
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
        'syncedMismatchKeys': [entry['key'] for entry in payload['classes']['raw_mismatch']],
        'conflictFreeKeys': [entry['key'] for entry in payload['classes']['conflict_free']],
    }

    print('reminder_backfill')
    print(f"  tenant_id: {args.tenant_id}")
    print(f"  applied: {str(args.apply).lower()}")
    print(f"  executed_sql: {str(executed_sql).lower()}")
    print(f"  missing_pg_keys: {summary['missingPgKeys']}")
    print(f"  synced_mismatch_keys: {summary['syncedMismatchKeys']}")

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
