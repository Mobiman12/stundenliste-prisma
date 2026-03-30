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
const news = db.prepare(`
  SELECT id, title, content, created_at
  FROM news
  ORDER BY id ASC
`).all();
const reads = db.prepare(`
  SELECT rowid AS _rowid, employee_id, news_id, read_at
  FROM news_read
  ORDER BY employee_id ASC, news_id ASC, rowid ASC
`).all();
console.log(JSON.stringify({ databasePath: path, news, reads }));
""".strip()

SQL_PG_NEWS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY id ASC), '[]'::json)
FROM (
  SELECT id, "tenantId", title, content, to_char("createdAt", 'YYYY-MM-DD HH24:MI:SS') AS "createdAt"
  FROM "News"
  WHERE "tenantId" = %(tenant)s
) t;
"""

SQL_PG_EMPLOYEE_NEWS_READ = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "employeeId" ASC, "newsId" ASC), '[]'::json)
FROM (
  SELECT enr."employeeId", enr."newsId", to_char(enr."readAt", 'YYYY-MM-DD HH24:MI:SS') AS "readAt"
  FROM "EmployeeNewsRead" enr
  JOIN "News" n ON n.id = enr."newsId"
  WHERE n."tenantId" = %(tenant)s
) t;
"""

SQL_PG_LEGACY_NEWS_READ = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "employeeId" ASC, "newsId" ASC), '[]'::json)
FROM (
  SELECT nr."employeeId", nr."newsId", to_char(nr."readAt", 'YYYY-MM-DD HH24:MI:SS') AS "readAt"
  FROM "NewsRead" nr
  JOIN "News" n ON n.id = nr."newsId"
  WHERE n."tenantId" = %(tenant)s
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

SQL_EMPLOYEE_IDS = """
SELECT COALESCE(json_agg(id ORDER BY id), '[]'::json)
FROM "Employee";
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
    return text or None


def canonical_news_sqlite(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'key': f"news:{int(row['id'])}",
        'entryType': 'news',
        'id': int(row['id']),
        'title': row.get('title') or '',
        'content': row.get('content') or '',
        'createdAt': normalize_timestamp(row.get('created_at')),
    }


def canonical_news_pg(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'key': f"news:{int(row['id'])}",
        'entryType': 'news',
        'id': int(row['id']),
        'title': row.get('title') or '',
        'content': row.get('content') or '',
        'createdAt': normalize_timestamp(row.get('createdAt')),
    }


def canonical_read_sqlite(row: dict[str, Any]) -> dict[str, Any]:
    employee_id = int(row['employee_id'])
    news_id = int(row['news_id'])
    return {
        'key': f'read:{employee_id}:{news_id}',
        'entryType': 'read',
        'employeeId': employee_id,
        'newsId': news_id,
        'readAt': normalize_timestamp(row.get('read_at')),
        '_rowid': row.get('_rowid'),
    }


def canonical_read_pg(row: dict[str, Any]) -> dict[str, Any]:
    employee_id = int(row['employeeId'])
    news_id = int(row['newsId'])
    return {
        'key': f'read:{employee_id}:{news_id}',
        'entryType': 'read',
        'employeeId': employee_id,
        'newsId': news_id,
        'readAt': normalize_timestamp(row.get('readAt')),
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
    pg_news_raw = psql_json(db_container, db_env, SQL_PG_NEWS % {'tenant': f"'{tenant_sql}'"}) or []
    pg_reads_raw = psql_json(db_container, db_env, SQL_PG_EMPLOYEE_NEWS_READ % {'tenant': f"'{tenant_sql}'"}) or []
    pg_legacy_reads_raw = psql_json(db_container, db_env, SQL_PG_LEGACY_NEWS_READ % {'tenant': f"'{tenant_sql}'"}) or []
    known_tenants = set(psql_json(db_container, db_env, SQL_TENANTS) or [])
    employee_ids = set(int(value) for value in (psql_json(db_container, db_env, SQL_EMPLOYEE_IDS) or []))

    sqlite_news = [canonical_news_sqlite(row) for row in sqlite_payload.get('news', [])]
    sqlite_reads = [canonical_read_sqlite(row) for row in sqlite_payload.get('reads', [])]
    pg_news = [canonical_news_pg(row) for row in pg_news_raw]
    pg_reads = [canonical_read_pg(row) for row in pg_reads_raw]

    sqlite_news_ids = {row['id'] for row in sqlite_news}
    pg_news_ids = {row['id'] for row in pg_news}
    pg_news_by_id = {row['id']: row for row in pg_news}

    classes: dict[str, list[dict[str, Any]]] = {name: [] for name in CLASS_ORDER}
    tenant_exists = tenant_id in known_tenants

    for row in sqlite_reads:
        if row['employeeId'] not in employee_ids or row['newsId'] not in sqlite_news_ids:
            classes['orphans'].append({
                'key': row['key'],
                'entryType': 'read',
                'tenantId': tenant_id,
                'sqliteRaw': raw_payload(row, source='sqlite'),
                'pgRaw': None,
                'reason': 'sqlite_read_reference_missing',
            })

    for row in pg_reads:
        if row['employeeId'] not in employee_ids or row['newsId'] not in pg_news_ids:
            classes['orphans'].append({
                'key': row['key'],
                'entryType': 'read',
                'tenantId': tenant_id,
                'sqliteRaw': None,
                'pgRaw': raw_payload(row, source='pg'),
                'reason': 'pg_read_reference_missing',
            })

    for row in pg_legacy_reads_raw:
        classes['orphans'].append({
            'key': f"legacy-newsread:{int(row['employeeId'])}:{int(row['newsId'])}",
            'entryType': 'legacy_pg_news_read',
            'tenantId': tenant_id,
            'sqliteRaw': None,
            'pgRaw': {
                'employeeId': int(row['employeeId']),
                'newsId': int(row['newsId']),
                'readAt': normalize_timestamp(row.get('readAt')),
            },
            'reason': 'legacy_pg_newsread_not_supported_in_cutover',
        })

    sqlite_by_key = {row['key']: row for row in sqlite_news + sqlite_reads}
    pg_by_key = {row['key']: row for row in pg_news + pg_reads}

    for key in sorted(set(sqlite_by_key) | set(pg_by_key)):
        sqlite_row = sqlite_by_key.get(key)
        pg_row = pg_by_key.get(key)
        if any(existing['key'] == key for existing in classes['orphans']):
            continue
        entry = {
            'key': key,
            'entryType': sqlite_row['entryType'] if sqlite_row else pg_row['entryType'],
            'tenantId': tenant_id,
            'sqliteRaw': raw_payload(sqlite_row, source='sqlite'),
            'pgRaw': raw_payload(pg_row, source='pg'),
        }
        if not tenant_exists:
            entry['reason'] = 'tenant_missing'
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
    ready_for_backfill = all(class_counts[name] == 0 for name in ('raw_mismatch', 'orphans'))
    ready_for_cutover = all(class_counts[name] == 0 for name in ('missing_pg', 'missing_sqlite', 'raw_mismatch', 'orphans'))
    overall_status = 'ready_for_cutover' if ready_for_cutover else ('ready_for_backfill' if ready_for_backfill else 'stop')

    return {
        'timestamp': datetime.now(UTC).isoformat(),
        'tenantId': tenant_id,
        'appContainer': app_container,
        'dbContainer': db_container,
        'sqlite': {
            'databasePath': sqlite_payload.get('databasePath'),
            'newsCount': len(sqlite_news),
            'readCount': len(sqlite_reads),
        },
        'pg': {
            'newsCount': len(pg_news),
            'readCount': len(pg_reads),
            'legacyNewsReadCount': len(pg_legacy_reads_raw),
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
    parser = argparse.ArgumentParser(description='Read-only compare SQLite news -> PostgreSQL News/EmployeeNewsRead.')
    parser.add_argument('--tenant-id', required=True)
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json', type=Path)
    args = parser.parse_args()

    payload = build_payload(args.app_container, args.db_container, args.tenant_id)
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
        print(f'news preflight failed: {exc}', file=sys.stderr)
        raise SystemExit(1)
