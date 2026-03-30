#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
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
    'owner_unresolved',
    'tenant_mismatch',
    'scope_conflict',
]

SQLITE_NODE_SCRIPT = r"""
const Database = require('better-sqlite3');
const path = process.env.DATABASE_PATH || '/app/database/mitarbeiter.db';
const db = new Database(path, { readonly: true, fileMustExist: true });
const templates = db.prepare(`
  SELECT id, name, employee_id, created_at, updated_at
  FROM shift_plan_templates
  WHERE employee_id IS NOT NULL
  ORDER BY employee_id ASC, name COLLATE NOCASE ASC, id ASC
`).all();
const days = db.prepare(`
  SELECT rowid AS _rowid, id, template_id, weekday, segment_index, mode, start_time, end_time, required_pause_minutes, label
  FROM shift_plan_template_days
  WHERE template_id IN (
    SELECT id FROM shift_plan_templates WHERE employee_id IS NOT NULL
  )
  ORDER BY template_id ASC, weekday ASC, segment_index ASC, id ASC
`).all();
console.log(JSON.stringify({ databasePath: path, templates, days }));
""".strip()

SQL_EMPLOYEES = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY id), '[]'::json)
FROM (
  SELECT id, "tenantId", username, "personnelNumber", "isActive"
  FROM "Employee"
  ORDER BY id
) t;
""".strip()

SQL_PG_PERSONAL_TEMPLATES = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY id), '[]'::json)
FROM (
  SELECT t.id, t."tenantId", t."employeeId", t.name,
         to_char(t."createdAt", 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
         to_char(t."updatedAt", 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt",
         e."tenantId" AS "employeeTenantId"
  FROM "ShiftPlanTemplate" t
  LEFT JOIN "Employee" e ON e.id = t."employeeId"
  WHERE t."employeeId" IS NOT NULL
  ORDER BY t.id
) t;
""".strip()

SQL_PG_PERSONAL_TEMPLATE_DAYS = """
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY "templateId", weekday, "segmentIndex", id), '[]'::json)
FROM (
  SELECT d.id, d."templateId", d.weekday, d."segmentIndex", d.mode, d."startTime", d."endTime", d."requiredPauseMinutes", d.label
  FROM "ShiftPlanTemplateDay" d
  JOIN "ShiftPlanTemplate" t ON t.id = d."templateId"
  WHERE t."employeeId" IS NOT NULL
  ORDER BY d."templateId", d.weekday, d."segmentIndex", d.id
) t;
""".strip()

SQL_PG_GLOBAL_TEMPLATE_COUNT = """
SELECT COALESCE(count(*), 0)
FROM "ShiftPlanTemplate"
WHERE "employeeId" IS NULL;
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


def psql_scalar(db_container: str, db_env: dict[str, str], sql: str) -> str:
    return run([
        'docker', 'exec', '-e', f"PGPASSWORD={db_env.get('POSTGRES_PASSWORD', '')}",
        db_container, 'psql', '-U', db_env['POSTGRES_USER'], '-d', db_env['POSTGRES_DB'], '-Atqc', sql,
    ])


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


def is_legacy_empty_absence(row: dict[str, Any]) -> bool:
    label = (row.get('label') or '').strip().lower()
    if row.get('mode') != 'unavailable' or label != 'abwesend':
        return False
    return not row.get('start_time') and not row.get('end_time') and safe_pause(row.get('required_pause_minutes')) <= 0


def build_runtime_days(rows: list[dict[str, Any]], *, apply_legacy_filter: bool) -> tuple[list[dict[str, Any]], int]:
    grouped: dict[int, list[dict[str, Any]]] = {weekday: [] for weekday in range(7)}
    skipped = 0
    ordered = sorted(
        rows,
        key=lambda row: (
            int(row.get('weekday', 0)),
            int(row.get('segment_index', row.get('segmentIndex', 0)) or 0),
            int(row.get('_rowid', row.get('id', 0)) or 0),
        ),
    )
    for row in ordered:
        if apply_legacy_filter and is_legacy_empty_absence(row):
            skipped += 1
            continue
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
    day_entries = []
    for weekday in range(7):
        day_entries.append({'weekday': weekday, 'segments': grouped.get(weekday, [])})
    return day_entries, skipped


def fingerprint_days(days: list[dict[str, Any]]) -> str:
    payload = json.dumps(days, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def identity_key(entry: dict[str, Any]) -> str:
    return f"{entry['tenantId']}|{entry['employeeId']}|{entry['normalizedName']}|{entry['dayFingerprint']}"


def scope_name_key(entry: dict[str, Any]) -> str:
    return f"{entry['tenantId']}|{entry['employeeId']}|{entry['normalizedName']}"


def parse_exclusion(raw: str) -> tuple[int, int]:
    parts = raw.split(':', 1)
    if len(parts) != 2:
        raise argparse.ArgumentTypeError('expected EMPLOYEE_ID:TEMPLATE_ID')
    try:
        employee_id = int(parts[0])
        template_id = int(parts[1])
    except ValueError as exc:
        raise argparse.ArgumentTypeError('expected EMPLOYEE_ID:TEMPLATE_ID') from exc
    if employee_id <= 0 or template_id <= 0:
        raise argparse.ArgumentTypeError('expected positive EMPLOYEE_ID:TEMPLATE_ID')
    return employee_id, template_id


def entry_matches_exclusions(value: Any, excluded_pairs: set[tuple[int, int]]) -> bool:
    if not excluded_pairs:
        return False
    if isinstance(value, dict):
        source = value.get('source')
        employee_id = value.get('employeeId')
        template_id = value.get('sqliteTemplateId')
        if source == 'sqlite' and employee_id is not None and template_id is not None:
            try:
                if (int(employee_id), int(template_id)) in excluded_pairs:
                    return True
            except (TypeError, ValueError):
                pass
        return any(entry_matches_exclusions(item, excluded_pairs) for item in value.values())
    if isinstance(value, list):
        return any(entry_matches_exclusions(item, excluded_pairs) for item in value)
    return False


def build_sqlite_entry(template: dict[str, Any], days: list[dict[str, Any]], employee_by_id: dict[int, dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    employee_id = int(template['employee_id'])
    owner = employee_by_id.get(employee_id)
    runtime_days, skipped = build_runtime_days(days, apply_legacy_filter=True)
    entry = {
        'source': 'sqlite',
        'sqliteTemplateId': int(template['id']),
        'employeeId': employee_id,
        'name': template.get('name') or '',
        'normalizedName': normalize_name(template.get('name')),
        'runtimeDays': runtime_days,
        'dayFingerprint': fingerprint_days(runtime_days),
        'legacyEmptyAbsenceSegmentsSkipped': skipped,
        'createdAt': template.get('created_at'),
        'updatedAt': template.get('updated_at'),
    }
    if owner is None:
        return 'owner_unresolved', entry
    entry['tenantId'] = owner['tenantId']
    entry['owner'] = owner
    return 'ok', entry


def build_pg_entry(template: dict[str, Any], days: list[dict[str, Any]], employee_by_id: dict[int, dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    employee_id = int(template['employeeId'])
    owner = employee_by_id.get(employee_id)
    runtime_days, skipped = build_runtime_days(days, apply_legacy_filter=True)
    entry = {
        'source': 'pg',
        'pgTemplateId': int(template['id']),
        'employeeId': employee_id,
        'tenantId': template.get('tenantId'),
        'name': template.get('name') or '',
        'normalizedName': normalize_name(template.get('name')),
        'runtimeDays': runtime_days,
        'dayFingerprint': fingerprint_days(runtime_days),
        'legacyEmptyAbsenceSegmentsSkipped': skipped,
        'createdAt': template.get('createdAt'),
        'updatedAt': template.get('updatedAt'),
    }
    if owner is None:
        return 'owner_unresolved', entry
    entry['owner'] = owner
    if template.get('tenantId') != owner.get('tenantId'):
        return 'tenant_mismatch', entry
    return 'ok', entry


def summarize(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        'source': entry['source'],
        'tenantId': entry.get('tenantId'),
        'employeeId': entry['employeeId'],
        'name': entry['name'],
        'normalizedName': entry['normalizedName'],
        'dayFingerprint': entry['dayFingerprint'],
        'sqliteTemplateId': entry.get('sqliteTemplateId'),
        'pgTemplateId': entry.get('pgTemplateId'),
        'legacyEmptyAbsenceSegmentsSkipped': entry['legacyEmptyAbsenceSegmentsSkipped'],
        'runtimeDays': entry['runtimeDays'],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only preflight for personal template SQLite -> Postgres migration.')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--exclude-sqlite-template', action='append', default=[], metavar='EMPLOYEE_ID:TEMPLATE_ID')
    parser.add_argument('--output-json')
    args = parser.parse_args()

    excluded_pairs = {parse_exclusion(raw) for raw in args.exclude_sqlite_template}

    db_env = docker_env(args.db_container)
    sqlite_payload = load_sqlite_payload(args.app_container)
    employees = psql_json(args.db_container, db_env, SQL_EMPLOYEES) or []
    pg_templates = psql_json(args.db_container, db_env, SQL_PG_PERSONAL_TEMPLATES) or []
    pg_days = psql_json(args.db_container, db_env, SQL_PG_PERSONAL_TEMPLATE_DAYS) or []
    pg_global_count = int(psql_scalar(args.db_container, db_env, SQL_PG_GLOBAL_TEMPLATE_COUNT) or '0')

    employee_by_id = {
        int(row['id']): {
            'id': int(row['id']),
            'tenantId': row['tenantId'],
            'username': row.get('username'),
            'personnelNumber': row.get('personnelNumber'),
            'isActive': row.get('isActive'),
        }
        for row in employees
    }

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
        status, entry = build_sqlite_entry(template, sqlite_days_by_template.get(int(template['id']), []), employee_by_id)
        if status == 'owner_unresolved':
            classes['owner_unresolved'].append(summarize(entry))
        else:
            valid_sqlite.append(entry)

    for template in pg_templates:
        status, entry = build_pg_entry(template, pg_days_by_template.get(int(template['id']), []), employee_by_id)
        if status == 'owner_unresolved':
            classes['owner_unresolved'].append(summarize(entry))
        elif status == 'tenant_mismatch':
            payload = summarize(entry)
            payload['ownerTenantId'] = entry['owner']['tenantId']
            payload['templateTenantId'] = entry['tenantId']
            classes['tenant_mismatch'].append(payload)
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
                'employeeId': sqlite_entry['employeeId'],
                'name': sqlite_entry['name'],
                'normalizedName': sqlite_entry['normalizedName'],
                'dayFingerprint': sqlite_entry['dayFingerprint'],
                'sqliteTemplateId': sqlite_entry.get('sqliteTemplateId'),
                'pgTemplateId': pg_entry.get('pgTemplateId'),
                'legacyEmptyAbsenceSegmentsSkipped': {
                    'sqlite': sqlite_entry['legacyEmptyAbsenceSegmentsSkipped'],
                    'pg': pg_entry['legacyEmptyAbsenceSegmentsSkipped'],
                },
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
        name: [entry for entry in classes[name] if entry_matches_exclusions(entry, excluded_pairs)]
        for name in CLASS_ORDER
    }
    ignored_by_gate_counts = {name: len(entries) for name, entries in ignored_by_gate.items()}
    effective_classes = {
        name: [entry for entry in classes[name] if not entry_matches_exclusions(entry, excluded_pairs)]
        for name in CLASS_ORDER
    }
    effective_class_counts = {name: len(entries) for name, entries in effective_classes.items()}

    ready_for_backfill = all(
        effective_class_counts[name] == 0
        for name in ('missing_sqlite', 'raw_mismatch', 'owner_unresolved', 'tenant_mismatch', 'scope_conflict')
    )
    ready_for_cutover = ready_for_backfill and effective_class_counts['missing_pg'] == 0
    overall_status = 'ready_for_cutover' if ready_for_cutover else ('ready_for_backfill' if ready_for_backfill else 'stop')

    payload = {
        'timestamp': datetime.now(UTC).isoformat(),
        'appContainer': args.app_container,
        'dbContainer': args.db_container,
        'matching': {
            'strategy': '(tenantId, employeeId, normalizedName, normalizedDayFingerprint)',
            'noRawIdMatching': True,
            'scope': 'personal_templates_only',
            'legacyEmptyAbsenceFilterApplied': True,
        },
        'exclusions': {
            'sqliteTemplates': [
                {'employeeId': employee_id, 'sqliteTemplateId': template_id}
                for employee_id, template_id in sorted(excluded_pairs)
            ],
            'ignoredByGateCounts': ignored_by_gate_counts,
            'ignoredByGate': ignored_by_gate,
        },
        'sqlite': {
            'databasePath': sqlite_payload.get('databasePath'),
            'personalTemplateCount': len(sqlite_payload.get('templates', [])),
            'templateDayCount': len(sqlite_payload.get('days', [])),
        },
        'pg': {
            'personalTemplateCount': len(pg_templates),
            'personalTemplateDayCount': len(pg_days),
            'ignoredGlobalTemplateCount': pg_global_count,
        },
        'employeeCount': len(employee_by_id),
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
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'personal template preflight failed: {exc}', file=sys.stderr)
        raise
