#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

CLASS_ORDER = [
    'conflict_free',
    'missing_pg',
    'missing_sqlite',
    'raw_mismatch',
    'scope_conflict',
]

SQLITE_NODE_SCRIPT = r"""
const Database = require('better-sqlite3');
const path = process.env.DATABASE_PATH || '/app/database/mitarbeiter.db';
const db = new Database(path, { readonly: true, fileMustExist: true });
const templates = db.prepare(`
  SELECT id, name, employee_id, created_at, updated_at
  FROM shift_plan_templates
  WHERE employee_id IS NULL
  ORDER BY name COLLATE NOCASE ASC, id ASC
`).all();
const days = db.prepare(`
  SELECT rowid AS _rowid, id, template_id, weekday, segment_index, mode, start_time, end_time, required_pause_minutes, label
  FROM shift_plan_template_days
  WHERE template_id IN (
    SELECT id FROM shift_plan_templates WHERE employee_id IS NULL
  )
  ORDER BY template_id ASC, weekday ASC, segment_index ASC, id ASC
`).all();
console.log(JSON.stringify({ databasePath: path, templates, days }));
""".strip()

SQL_EMPLOYEE_TENANTS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "tenantId"), '[]'::json)
FROM (
  SELECT "tenantId", count(*) AS count
  FROM "Employee"
  GROUP BY "tenantId"
  ORDER BY "tenantId"
) t;
""".strip()

SQL_PG_GLOBAL_TEMPLATES = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY id), '[]'::json)
FROM (
  SELECT t.id, t."tenantId", t."employeeId", t.name,
         to_char(t."createdAt", 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
         to_char(t."updatedAt", 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
  FROM "ShiftPlanTemplate" t
  WHERE t."employeeId" IS NULL
  ORDER BY t.id
) t;
""".strip()

SQL_PG_GLOBAL_TEMPLATE_DAYS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "templateId", weekday, "segmentIndex", id), '[]'::json)
FROM (
  SELECT d.id, d."templateId", d.weekday, d."segmentIndex", d.mode, d."startTime", d."endTime", d."requiredPauseMinutes", d.label
  FROM "ShiftPlanTemplateDay" d
  JOIN "ShiftPlanTemplate" t ON t.id = d."templateId"
  WHERE t."employeeId" IS NULL
  ORDER BY d."templateId", d.weekday, d."segmentIndex", d.id
) t;
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
    output = run([
        'docker', 'exec', '-e', f"PGPASSWORD={db_env.get('POSTGRES_PASSWORD', '')}",
        db_container, 'psql', '-U', db_env['POSTGRES_USER'], '-d', db_env['POSTGRES_DB'], '-Atqc', sql,
    ])
    return json.loads(output) if output else None


def load_sqlite_payload(app_container: str) -> dict[str, Any]:
    output = run(['docker', 'exec', '-i', app_container, 'node', '-'], input_text=SQLITE_NODE_SCRIPT)
    return json.loads(output)


def normalize_name(value: Any) -> str:
    text = '' if value is None else str(value)
    return re.sub(r'\s+', ' ', text.strip()).lower()


def normalize_label(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def sanitize_time(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r'\d{1,2}:\d{2}', text):
        return text.zfill(5)
    return text


def safe_pause(value: Any) -> int:
    if value is None:
        return 0
    try:
        return max(0, int(round(float(value))))
    except (TypeError, ValueError):
        return 0


def build_runtime_days(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[int, list[dict[str, Any]]] = {weekday: [] for weekday in range(7)}
    ordered = sorted(
        rows,
        key=lambda row: (
            int(row.get('weekday', 0)),
            int(row.get('segment_index', row.get('segmentIndex', 0)) or 0),
            int(row.get('_rowid', row.get('id', 0)) or 0),
        ),
    )
    for row in ordered:
        weekday = int(row.get('weekday', 0))
        mode = 'unavailable' if str(row.get('mode') or '').lower() == 'unavailable' else 'available'
        keep_times = mode == 'available'
        grouped.setdefault(weekday, []).append({
            'mode': mode,
            'start': sanitize_time(row.get('start_time', row.get('startTime')) if keep_times else None),
            'end': sanitize_time(row.get('end_time', row.get('endTime')) if keep_times else None),
            'requiredPauseMinutes': safe_pause(row.get('required_pause_minutes', row.get('requiredPauseMinutes'))) if keep_times else 0,
            'label': normalize_label(row.get('label')),
        })
    return [{'weekday': weekday, 'segments': grouped.get(weekday, [])} for weekday in range(7)]


def fingerprint_days(days: list[dict[str, Any]]) -> str:
    payload = json.dumps(days, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def identity_key(entry: dict[str, Any]) -> str:
    return f"{entry['tenantId']}|global|{entry['normalizedName']}|{entry['dayFingerprint']}"


def scope_name_key(entry: dict[str, Any]) -> str:
    return f"{entry['tenantId']}|global|{entry['normalizedName']}"


def entry_matches_exclusions(value: Any, excluded_pg_ids: set[int]) -> bool:
    if not excluded_pg_ids:
        return False
    if isinstance(value, dict):
        pg_template_id = value.get('pgTemplateId')
        if pg_template_id is not None:
            try:
                if int(pg_template_id) in excluded_pg_ids:
                    return True
            except (TypeError, ValueError):
                pass
        return any(entry_matches_exclusions(item, excluded_pg_ids) for item in value.values())
    if isinstance(value, list):
        return any(entry_matches_exclusions(item, excluded_pg_ids) for item in value)
    return False


def summarize(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        'source': entry['source'],
        'tenantId': entry.get('tenantId'),
        'employeeId': entry.get('employeeId'),
        'name': entry['name'],
        'normalizedName': entry['normalizedName'],
        'dayFingerprint': entry['dayFingerprint'],
        'sqliteTemplateId': entry.get('sqliteTemplateId'),
        'pgTemplateId': entry.get('pgTemplateId'),
        'runtimeDays': entry['runtimeDays'],
        'createdAt': entry.get('createdAt'),
        'updatedAt': entry.get('updatedAt'),
    }


def build_sqlite_entry(template: dict[str, Any], days: list[dict[str, Any]], derived_tenant_id: str | None) -> tuple[str, dict[str, Any]]:
    entry = {
        'source': 'sqlite',
        'sqliteTemplateId': int(template['id']),
        'employeeId': None,
        'tenantId': derived_tenant_id,
        'name': template.get('name') or '',
        'normalizedName': normalize_name(template.get('name')),
        'runtimeDays': build_runtime_days(days),
        'dayFingerprint': fingerprint_days(build_runtime_days(days)),
        'createdAt': template.get('created_at'),
        'updatedAt': template.get('updated_at'),
    }
    if not derived_tenant_id:
        return 'scope_conflict', entry
    return 'ok', entry


def build_pg_entry(template: dict[str, Any], days: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    entry = {
        'source': 'pg',
        'pgTemplateId': int(template['id']),
        'employeeId': template.get('employeeId'),
        'tenantId': template.get('tenantId'),
        'name': template.get('name') or '',
        'normalizedName': normalize_name(template.get('name')),
        'runtimeDays': build_runtime_days(days),
        'dayFingerprint': fingerprint_days(build_runtime_days(days)),
        'createdAt': template.get('createdAt'),
        'updatedAt': template.get('updatedAt'),
    }
    if template.get('employeeId') is not None:
        return 'scope_conflict', entry
    if not template.get('tenantId'):
        return 'scope_conflict', entry
    return 'ok', entry


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only preflight for global template SQLite -> Postgres migration.')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--exclude-pg-template-id', action='append', default=[], type=int, metavar='TEMPLATE_ID')
    parser.add_argument('--exclude-legacy-pg-template-id', action='append', default=[], type=int, metavar='TEMPLATE_ID')
    parser.add_argument('--output-json')
    args = parser.parse_args()

    legacy_excluded_pg_ids = {value for value in args.exclude_legacy_pg_template_id if value and value > 0}
    explicit_excluded_pg_ids = {value for value in args.exclude_pg_template_id if value and value > 0}
    excluded_pg_ids = legacy_excluded_pg_ids | explicit_excluded_pg_ids

    db_env = docker_env(args.db_container)
    sqlite_payload = load_sqlite_payload(args.app_container)
    employee_tenants = psql_json(args.db_container, db_env, SQL_EMPLOYEE_TENANTS) or []
    pg_templates = psql_json(args.db_container, db_env, SQL_PG_GLOBAL_TEMPLATES) or []
    pg_days = psql_json(args.db_container, db_env, SQL_PG_GLOBAL_TEMPLATE_DAYS) or []

    derived_tenant_id = employee_tenants[0]['tenantId'] if len(employee_tenants) == 1 else None
    tenant_derivation = 'single_employee_tenant' if derived_tenant_id else 'unresolved'

    sqlite_days_by_template: dict[int, list[dict[str, Any]]] = {}
    for row in sqlite_payload.get('days', []):
        template_id = int(row['template_id'])
        sqlite_days_by_template.setdefault(template_id, []).append(row)

    pg_days_by_template: dict[int, list[dict[str, Any]]] = {}
    for row in pg_days:
        template_id = int(row['templateId'])
        normalized = {
            'id': row['id'],
            'templateId': row['templateId'],
            'weekday': row['weekday'],
            'segmentIndex': row['segmentIndex'],
            'mode': row['mode'],
            'startTime': row.get('startTime'),
            'endTime': row.get('endTime'),
            'requiredPauseMinutes': row.get('requiredPauseMinutes'),
            'label': row.get('label'),
        }
        pg_days_by_template.setdefault(template_id, []).append(normalized)

    classes: dict[str, list[dict[str, Any]]] = {name: [] for name in CLASS_ORDER}
    valid_sqlite: list[dict[str, Any]] = []
    valid_pg: list[dict[str, Any]] = []

    for template in sqlite_payload.get('templates', []):
        status, entry = build_sqlite_entry(template, sqlite_days_by_template.get(int(template['id']), []), derived_tenant_id)
        if status == 'scope_conflict':
            payload = summarize(entry)
            payload['reason'] = 'tenant_unresolved'
            classes['scope_conflict'].append(payload)
        else:
            valid_sqlite.append(entry)

    for template in pg_templates:
        status, entry = build_pg_entry(template, pg_days_by_template.get(int(template['id']), []))
        if status == 'scope_conflict':
            payload = summarize(entry)
            payload['reason'] = 'invalid_pg_global_scope'
            classes['scope_conflict'].append(payload)
        else:
            valid_pg.append(entry)

    sqlite_by_identity: dict[str, list[dict[str, Any]]] = {}
    pg_by_identity: dict[str, list[dict[str, Any]]] = {}
    for entry in valid_sqlite:
        sqlite_by_identity.setdefault(identity_key(entry), []).append(entry)
    for entry in valid_pg:
        pg_by_identity.setdefault(identity_key(entry), []).append(entry)

    conflicted_identity_keys: set[str] = set()
    for key in sorted(set(sqlite_by_identity) | set(pg_by_identity)):
        sqlite_entries = sqlite_by_identity.get(key, [])
        pg_entries = pg_by_identity.get(key, [])
        if len(sqlite_entries) > 1 or len(pg_entries) > 1:
            conflicted_identity_keys.add(key)
            classes['scope_conflict'].append({
                'identityKey': key,
                'sqlite': [summarize(entry) for entry in sqlite_entries],
                'pg': [summarize(entry) for entry in pg_entries],
                'reason': 'duplicate_identity_key',
            })

    remaining_sqlite: list[dict[str, Any]] = []
    remaining_pg: list[dict[str, Any]] = []

    for key in sorted(set(sqlite_by_identity) | set(pg_by_identity)):
        if key in conflicted_identity_keys:
            continue
        sqlite_entry = (sqlite_by_identity.get(key) or [None])[0]
        pg_entry = (pg_by_identity.get(key) or [None])[0]
        if sqlite_entry and pg_entry:
            classes['conflict_free'].append({
                'identityKey': key,
                'tenantId': sqlite_entry['tenantId'],
                'name': sqlite_entry['name'],
                'normalizedName': sqlite_entry['normalizedName'],
                'dayFingerprint': sqlite_entry['dayFingerprint'],
                'sqliteTemplateId': sqlite_entry.get('sqliteTemplateId'),
                'pgTemplateId': pg_entry.get('pgTemplateId'),
            })
        elif sqlite_entry:
            remaining_sqlite.append(sqlite_entry)
        elif pg_entry:
            remaining_pg.append(pg_entry)

    sqlite_by_scope_name: dict[str, list[dict[str, Any]]] = {}
    pg_by_scope_name: dict[str, list[dict[str, Any]]] = {}
    for entry in remaining_sqlite:
        sqlite_by_scope_name.setdefault(scope_name_key(entry), []).append(entry)
    for entry in remaining_pg:
        pg_by_scope_name.setdefault(scope_name_key(entry), []).append(entry)

    for key in sorted(set(sqlite_by_scope_name) | set(pg_by_scope_name)):
        sqlite_entries = sqlite_by_scope_name.get(key, [])
        pg_entries = pg_by_scope_name.get(key, [])
        if len(sqlite_entries) == 1 and len(pg_entries) == 1:
            classes['raw_mismatch'].append({
                'scopeNameKey': key,
                'sqlite': summarize(sqlite_entries[0]),
                'pg': summarize(pg_entries[0]),
            })
            continue
        if len(sqlite_entries) == 1 and len(pg_entries) == 0:
            classes['missing_pg'].append(summarize(sqlite_entries[0]))
            continue
        if len(sqlite_entries) == 0 and len(pg_entries) == 1:
            classes['missing_sqlite'].append(summarize(pg_entries[0]))
            continue
        if sqlite_entries or pg_entries:
            classes['scope_conflict'].append({
                'scopeNameKey': key,
                'sqlite': [summarize(entry) for entry in sqlite_entries],
                'pg': [summarize(entry) for entry in pg_entries],
                'reason': 'ambiguous_scope_name_match',
            })

    class_counts = {name: len(classes[name]) for name in CLASS_ORDER}
    ignored_by_gate = {
        name: [entry for entry in classes[name] if entry_matches_exclusions(entry, excluded_pg_ids)]
        for name in CLASS_ORDER
    }
    ignored_by_gate_counts = {name: len(entries) for name, entries in ignored_by_gate.items()}
    effective_classes = {
        name: [entry for entry in classes[name] if not entry_matches_exclusions(entry, excluded_pg_ids)]
        for name in CLASS_ORDER
    }
    effective_class_counts = {name: len(entries) for name, entries in effective_classes.items()}

    ready_for_backfill = all(
        effective_class_counts[name] == 0
        for name in ('raw_mismatch', 'scope_conflict')
    )
    ready_for_cutover = ready_for_backfill and effective_class_counts['missing_pg'] == 0
    overall_status = 'ready_for_cutover' if ready_for_cutover else ('ready_for_backfill' if ready_for_backfill else 'stop')

    payload = {
        'timestamp': datetime.now(UTC).isoformat(),
        'appContainer': args.app_container,
        'dbContainer': args.db_container,
        'matching': {
            'strategy': '(tenantId, employeeId=null, normalizedName, normalizedDayFingerprint)',
            'noRawIdMatching': True,
            'scope': 'global_templates_only',
            'tenantDerivation': tenant_derivation,
        },
        'exclusions': {
            'mode': 'gate_only',
            'legacyPgTemplateIds': sorted(legacy_excluded_pg_ids),
            'pgTemplateIds': sorted(excluded_pg_ids),
            'ignoredByGateCounts': ignored_by_gate_counts,
            'ignoredByGate': ignored_by_gate,
        },
        'sqlite': {
            'databasePath': sqlite_payload.get('databasePath'),
            'globalTemplateCount': len(sqlite_payload.get('templates', [])),
            'templateDayCount': len(sqlite_payload.get('days', [])),
        },
        'pg': {
            'globalTemplateCount': len(pg_templates),
            'templateDayCount': len(pg_days),
        },
        'employeeTenants': employee_tenants,
        'classCounts': class_counts,
        'classes': classes,
        'effectiveClassCounts': effective_class_counts,
        'effectiveClasses': effective_classes,
        'gate': {
            'readyForBackfill': ready_for_backfill,
            'readyForCutover': ready_for_cutover,
            'overallStatus': overall_status,
        },
    }

    if args.output_json:
        Path(args.output_json).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n')

    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
