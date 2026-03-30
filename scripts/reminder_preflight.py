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
const settings = db.prepare(`
  SELECT id, enabled, send_hour, subject, content_template
  FROM reminder_settings
  WHERE id = 1
`).get() ?? null;
const logs = db.prepare(`
  SELECT rowid AS _rowid, period_key, sent_count, error_count, sent_at
  FROM reminder_send_log
  ORDER BY sent_at DESC, period_key ASC, rowid ASC
`).all();
console.log(JSON.stringify({ databasePath: path, settings, logs }));
""".strip()

SQL_PG_SETTINGS = """
SELECT COALESCE(row_to_json(t), 'null'::json)
FROM (
  SELECT "tenantId", id, enabled, "sendHour", subject, "contentTemplate"
  FROM "ReminderSettings"
  WHERE "tenantId" = %(tenant)s AND id = 1
) t;
"""

SQL_PG_LOGS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "sentAt" DESC, "periodKey" ASC), '[]'::json)
FROM (
  SELECT "tenantId", "periodKey", "sentCount", "errorCount", "sentAt"
  FROM "ReminderSendLog"
  WHERE "tenantId" = %(tenant)s
) t;
"""

SQL_TENANTS = """
SELECT COALESCE(json_agg(t ORDER BY t), '[]'::json)
FROM (
  SELECT DISTINCT "tenantId" AS t FROM "Admin"
  UNION
  SELECT DISTINCT "tenantId" AS t FROM "Employee"
) q;
"""


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
            'docker', 'exec', '-e', f"PGPASSWORD={db_env.get('POSTGRES_PASSWORD', '')}",
            db_container, 'psql', '-U', db_env['POSTGRES_USER'], '-d', db_env['POSTGRES_DB'], '-Atqc', sql,
        ]
    )
    return json.loads(output) if output else None


def load_sqlite_payload(app_container: str) -> dict[str, Any]:
    output = run(['docker', 'exec', '-i', app_container, 'node', '-'], input_text=SQLITE_NODE_SCRIPT)
    return json.loads(output)


def sql_quote(value: str) -> str:
    return value.replace("'", "''")


def normalize_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        normalized = text.replace('Z', '+00:00')
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.isoformat()
        return parsed.astimezone(UTC).isoformat().replace('+00:00', 'Z')
    except ValueError:
        return text


def canonical_settings_sqlite(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        'key': 'settings',
        'entryType': 'settings',
        'id': int(row['id']),
        'enabled': int(row.get('enabled') or 0),
        'sendHour': int(row.get('send_hour') or 0),
        'subject': row.get('subject') or '',
        'contentTemplate': row.get('content_template') or '',
    }


def canonical_settings_pg(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        'key': 'settings',
        'entryType': 'settings',
        'id': int(row['id']),
        'enabled': int(row.get('enabled') or 0),
        'sendHour': int(row.get('sendHour') or 0),
        'subject': row.get('subject') or '',
        'contentTemplate': row.get('contentTemplate') or '',
    }


def canonical_log_sqlite(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'key': f"log:{row['period_key']}",
        'entryType': 'log',
        'periodKey': row['period_key'],
        'sentCount': int(row.get('sent_count') or 0),
        'errorCount': int(row.get('error_count') or 0),
        'sentAt': normalize_timestamp(row.get('sent_at')),
        '_rowid': row.get('_rowid'),
    }


def canonical_log_pg(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'key': f"log:{row['periodKey']}",
        'entryType': 'log',
        'periodKey': row['periodKey'],
        'sentCount': int(row.get('sentCount') or 0),
        'errorCount': int(row.get('errorCount') or 0),
        'sentAt': normalize_timestamp(row.get('sentAt')),
    }


def raw_payload(row: dict[str, Any] | None, *, source: str) -> dict[str, Any] | None:
    if row is None:
        return None
    payload = {key: value for key, value in row.items() if key not in {'key', 'entryType', '_rowid'}}
    if source == 'sqlite' and '_rowid' in row:
        payload['rowid'] = row['_rowid']
    return payload


def build_payload(app_container: str, db_container: str, tenant_id: str) -> dict[str, Any]:
    db_env = docker_env(db_container)
    sqlite_payload = load_sqlite_payload(app_container)
    tenant_sql = sql_quote(tenant_id)
    pg_settings_raw = psql_json(db_container, db_env, SQL_PG_SETTINGS % {'tenant': f"'{tenant_sql}'"})
    pg_logs_raw = psql_json(db_container, db_env, SQL_PG_LOGS % {'tenant': f"'{tenant_sql}'"}) or []
    known_tenants = set(psql_json(db_container, db_env, SQL_TENANTS) or [])

    sqlite_settings = canonical_settings_sqlite(sqlite_payload.get('settings'))
    sqlite_logs = [canonical_log_sqlite(row) for row in sqlite_payload.get('logs', [])]
    pg_settings = canonical_settings_pg(pg_settings_raw)
    pg_logs = [canonical_log_pg(row) for row in pg_logs_raw]

    sqlite_by_key: dict[str, dict[str, Any]] = {}
    if sqlite_settings is not None:
        sqlite_by_key[sqlite_settings['key']] = sqlite_settings
    sqlite_by_key.update({row['key']: row for row in sqlite_logs})

    pg_by_key: dict[str, dict[str, Any]] = {}
    if pg_settings is not None:
        pg_by_key[pg_settings['key']] = pg_settings
    pg_by_key.update({row['key']: row for row in pg_logs})

    classes: dict[str, list[dict[str, Any]]] = {name: [] for name in CLASS_ORDER}
    tenant_exists = tenant_id in known_tenants

    for key in sorted(set(sqlite_by_key) | set(pg_by_key)):
        sqlite_row = sqlite_by_key.get(key)
        pg_row = pg_by_key.get(key)
        entry = {
            'key': key,
            'entryType': sqlite_row['entryType'] if sqlite_row else pg_row['entryType'],
            'tenantId': tenant_id,
            'sqliteRaw': raw_payload(sqlite_row, source='sqlite'),
            'pgRaw': raw_payload(pg_row, source='pg'),
        }
        if not tenant_exists:
            classes['orphans'].append(entry)
            continue
        if sqlite_row is None:
            classes['missing_sqlite'].append(entry)
            continue
        if pg_row is None:
            classes['missing_pg'].append(entry)
            continue
        sqlite_compare = {k: v for k, v in sqlite_row.items() if k not in {'key', 'entryType', '_rowid'}}
        pg_compare = {k: v for k, v in pg_row.items() if k not in {'key', 'entryType'}}
        if sqlite_compare != pg_compare:
            diffs = {}
            for diff_key in sorted(set(sqlite_compare) | set(pg_compare)):
                if sqlite_compare.get(diff_key) != pg_compare.get(diff_key):
                    diffs[diff_key] = {'sqlite': sqlite_compare.get(diff_key), 'pg': pg_compare.get(diff_key)}
            entry['diffs'] = diffs
            classes['raw_mismatch'].append(entry)
            continue
        classes['conflict_free'].append(entry)

    class_counts = {name: len(classes[name]) for name in CLASS_ORDER}
    ready_for_backfill = all(class_counts[name] == 0 for name in ('missing_pg', 'raw_mismatch', 'orphans'))
    ready_for_cutover = all(class_counts[name] == 0 for name in ('missing_pg', 'missing_sqlite', 'raw_mismatch', 'orphans'))
    overall_status = 'ready_for_cutover' if ready_for_cutover else ('ready_for_backfill' if ready_for_backfill else 'stop')

    return {
        'timestamp': datetime.now(UTC).isoformat(),
        'tenantId': tenant_id,
        'appContainer': app_container,
        'dbContainer': db_container,
        'sqlite': {
            'databasePath': sqlite_payload.get('databasePath'),
            'settingsCount': 1 if sqlite_settings else 0,
            'logCount': len(sqlite_logs),
        },
        'pg': {
            'settingsCount': 1 if pg_settings else 0,
            'logCount': len(pg_logs),
        },
        'tenantExists': tenant_exists,
        'classCounts': class_counts,
        'classes': classes,
        'gate': {
            'readyForBackfill': ready_for_backfill,
            'readyForCutover': ready_for_cutover,
            'overallStatus': overall_status,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only preflight for reminder settings/logs SQLite -> PostgreSQL.')
    parser.add_argument('--tenant-id', required=True)
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json')
    args = parser.parse_args()

    payload = build_payload(args.app_container, args.db_container, args.tenant_id)
    if args.output_json:
        output_path = Path(args.output_json)
        output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'reminder preflight failed: {exc}', file=sys.stderr)
        raise
