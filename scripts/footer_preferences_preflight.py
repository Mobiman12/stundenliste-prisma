#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DEFAULT_PREFS = {
    'sales': True,
    'bonus': True,
    'worktime': True,
    'absences': True,
}
CLASS_ORDER = [
    'conflict_free',
    'missing_pg',
    'missing_sqlite',
    'raw_mismatch',
    'normalized_mismatch',
    'orphan_sqlite',
    'orphan_pg',
]

SQLITE_NODE_SCRIPT = r"""
const Database = require('better-sqlite3');
const path = process.env.DATABASE_PATH || '/app/database/mitarbeiter.db';
const db = new Database(path, { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT user_id, group_states
  FROM footer_view_settings
  ORDER BY user_id
`).all();
console.log(JSON.stringify({ databasePath: path, rows }));
""".strip()

SQL_PG_ROWS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "userId"), '[]'::json)
FROM (
  SELECT "userId", "groupStates"
  FROM "FooterViewSettings"
  ORDER BY "userId"
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


def parse_json_object(raw: Any) -> dict[str, Any] | None:
    if raw is None or not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def canonical_raw(raw: Any) -> str | None:
    parsed = parse_json_object(raw)
    if parsed is not None:
        return json.dumps(parsed, ensure_ascii=False, sort_keys=True)
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def normalize_group_states(raw: Any) -> dict[str, Any]:
    parsed = parse_json_object(raw)
    if parsed is None:
        return dict(DEFAULT_PREFS)

    normalized: dict[str, Any] = {}
    for key, default in DEFAULT_PREFS.items():
        value = parsed.get(key)
        normalized[key] = default if value is None else value
    return normalized


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only preflight for footer preferences SQLite -> Postgres.')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--output-json')
    args = parser.parse_args()

    db_env = docker_env(args.db_container)
    sqlite_path, sqlite_rows = load_sqlite_rows(args.app_container)
    pg_rows = psql_json(args.db_container, db_env, SQL_PG_ROWS) or []
    employee_ids = set(psql_json(args.db_container, db_env, SQL_EMPLOYEE_IDS) or [])

    sqlite_by_id = {int(row['user_id']): row for row in sqlite_rows}
    pg_by_id = {int(row['userId']): row for row in pg_rows}
    classes: dict[str, list[dict[str, Any]]] = {name: [] for name in CLASS_ORDER}

    for user_id in sorted(set(sqlite_by_id) | set(pg_by_id)):
        sqlite_row = sqlite_by_id.get(user_id)
        pg_row = pg_by_id.get(user_id)
        sqlite_raw = sqlite_row.get('group_states') if sqlite_row else None
        pg_raw = pg_row.get('groupStates') if pg_row else None
        sqlite_canonical = canonical_raw(sqlite_raw)
        pg_canonical = canonical_raw(pg_raw)
        sqlite_normalized = normalize_group_states(sqlite_raw)
        pg_normalized = normalize_group_states(pg_raw)

        entry = {
            'userId': user_id,
            'sqliteRaw': sqlite_raw,
            'pgRaw': pg_raw,
            'sqliteCanonical': sqlite_canonical,
            'pgCanonical': pg_canonical,
            'sqliteNormalized': sqlite_normalized,
            'pgNormalized': pg_normalized,
        }

        if sqlite_row and user_id not in employee_ids:
            classes['orphan_sqlite'].append(entry)
            continue
        if pg_row and user_id not in employee_ids:
            classes['orphan_pg'].append(entry)
            continue
        if sqlite_row is None:
            classes['missing_sqlite'].append(entry)
            continue
        if pg_row is None:
            classes['missing_pg'].append(entry)
            continue
        if sqlite_normalized != pg_normalized:
            classes['normalized_mismatch'].append(entry)
            continue
        if sqlite_canonical != pg_canonical:
            classes['raw_mismatch'].append(entry)
            continue
        classes['conflict_free'].append(entry)

    class_counts = {name: len(classes[name]) for name in CLASS_ORDER}
    ready_for_cutover = all(
        class_counts[name] == 0
        for name in ('missing_pg', 'missing_sqlite', 'normalized_mismatch', 'orphan_pg')
    )
    ready_for_backfill = all(
        class_counts[name] == 0
        for name in ('missing_pg', 'normalized_mismatch', 'orphan_pg')
    )
    overall_status = 'ready_for_cutover' if ready_for_cutover else 'stop'

    payload = {
        'timestamp': datetime.now(UTC).isoformat(),
        'appContainer': args.app_container,
        'dbContainer': args.db_container,
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
        'gate': {
            'readyForBackfill': ready_for_backfill,
            'readyForCutover': ready_for_cutover,
            'overallStatus': overall_status,
        },
        'notes': {
            'orphanSqliteIsInformational': True,
            'normalizationMatchesEnsurePreferences': True,
        },
    }

    if args.output_json:
        output_path = Path(args.output_json)
        output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n')

    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'footer preferences preflight failed: {exc}', file=sys.stderr)
        raise
