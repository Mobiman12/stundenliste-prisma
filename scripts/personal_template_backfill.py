#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from typing import Any


def load_preflight_module() -> Any:
    path = Path(__file__).with_name('personal_template_preflight.py')
    spec = importlib.util.spec_from_file_location('personal_template_preflight', path)
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


def run_preflight(pre: Any, *, app_container: str, db_container: str, exclusions: list[str]) -> dict[str, Any]:
    preflight_path = Path(__file__).with_name('personal_template_preflight.py')
    with tempfile.NamedTemporaryFile(prefix='personal_template_preflight_', suffix='.json', delete=False) as tmp:
        output_path = Path(tmp.name)
    cmd = [
        sys.executable,
        str(preflight_path),
        '--app-container',
        app_container,
        '--db-container',
        db_container,
        '--output-json',
        str(output_path),
    ]
    for item in exclusions:
        cmd.extend(['--exclude-sqlite-template', item])
    pre.run(cmd)
    try:
        return json.loads(output_path.read_text(encoding='utf-8'))
    finally:
        output_path.unlink(missing_ok=True)


def build_filtered_day_rows(pre: Any, rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    filtered: list[dict[str, Any]] = []
    skipped = 0
    ordered = sorted(
        rows,
        key=lambda row: (
            int(row.get('weekday', 0)),
            int(row.get('segment_index', 0) or 0),
            int(row.get('_rowid', row.get('id', 0)) or 0),
        ),
    )
    for row in ordered:
        if pre.is_legacy_empty_absence(row):
            skipped += 1
            continue
        mode = 'unavailable' if str(row.get('mode') or '').lower() == 'unavailable' else 'available'
        keep_times = mode == 'available'
        filtered.append(
            {
                'weekday': int(row.get('weekday', 0)),
                'segmentIndex': int(row.get('segment_index', 0) or 0),
                'mode': mode,
                'startTime': pre.sanitize_time(row.get('start_time') if keep_times else None),
                'endTime': pre.sanitize_time(row.get('end_time') if keep_times else None),
                'requiredPauseMinutes': pre.safe_pause(row.get('required_pause_minutes')) if keep_times else 0,
                'label': pre.normalize_label(row.get('label')),
            }
        )
    return filtered, skipped


def build_insert_sql(candidates: list[dict[str, Any]]) -> str:
    statements = ['BEGIN;']
    for candidate in candidates:
        template_values = ', '.join(
            [
                sql_literal(candidate['tenantId']),
                sql_literal(candidate['employeeId']),
                sql_literal(candidate['name']),
                sql_literal(candidate['createdAt']),
                sql_literal(candidate['updatedAt']),
            ]
        )
        if candidate['dayRows']:
            day_values = []
            for day in candidate['dayRows']:
                day_values.append(
                    '('
                    + ', '.join(
                        [
                            sql_literal(day['weekday']),
                            sql_literal(day['segmentIndex']),
                            sql_literal(day['mode']),
                            sql_literal(day['startTime']),
                            sql_literal(day['endTime']),
                            sql_literal(day['requiredPauseMinutes']),
                            sql_literal(day['label']),
                            sql_literal(candidate['createdAt']),
                            sql_literal(candidate['updatedAt']),
                        ]
                    )
                    + ')'
                )
            statements.append(
                'WITH inserted_template AS (\n'
                '  INSERT INTO "ShiftPlanTemplate" ("tenantId", "employeeId", name, "createdAt", "updatedAt")\n'
                f'  VALUES ({template_values})\n'
                '  RETURNING id\n'
                ')\n'
                'INSERT INTO "ShiftPlanTemplateDay" ("templateId", weekday, "segmentIndex", mode, "startTime", "endTime", "requiredPauseMinutes", label, "createdAt", "updatedAt")\n'
                'SELECT inserted_template.id, v.weekday, v.segment_index, v.mode, v.start_time, v.end_time, v.required_pause_minutes, v.label, v.created_at::timestamp, v.updated_at::timestamp\n'
                'FROM inserted_template\n'
                'CROSS JOIN (VALUES\n  '
                + ',\n  '.join(day_values)
                + '\n) AS v(weekday, segment_index, mode, start_time, end_time, required_pause_minutes, label, created_at, updated_at);'
            )
        else:
            statements.append(
                'INSERT INTO "ShiftPlanTemplate" ("tenantId", "employeeId", name, "createdAt", "updatedAt")\n'
                f'VALUES ({template_values});'
            )
    statements.append('COMMIT;')
    return '\n'.join(statements)


def main() -> int:
    parser = argparse.ArgumentParser(description='Conservative backfill for personal SQLite templates -> PostgreSQL ShiftPlanTemplate.')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--app-container', default='ops-stundenliste-prisma-1')
    parser.add_argument('--db-container', default='ops-timeshift-db-1')
    parser.add_argument('--exclude-sqlite-template', action='append', default=[], metavar='EMPLOYEE_ID:TEMPLATE_ID')
    parser.add_argument('--expect-missing-pg', type=int)
    parser.add_argument('--output-json', type=Path)
    args = parser.parse_args()

    pre = load_preflight_module()
    excluded_pairs = {pre.parse_exclusion(raw) for raw in args.exclude_sqlite_template}
    payload = run_preflight(pre, app_container=args.app_container, db_container=args.db_container, exclusions=args.exclude_sqlite_template)

    effective_counts = payload['effectiveClassCounts']
    blocking = {
        'missing_sqlite': payload['effectiveClasses']['missing_sqlite'],
        'raw_mismatch': payload['effectiveClasses']['raw_mismatch'],
        'owner_unresolved': payload['effectiveClasses']['owner_unresolved'],
        'tenant_mismatch': payload['effectiveClasses']['tenant_mismatch'],
        'scope_conflict': payload['effectiveClasses']['scope_conflict'],
    }
    if any(blocking.values()):
        raise RuntimeError(json.dumps(blocking, ensure_ascii=False))

    insert_candidates = payload['effectiveClasses']['missing_pg']
    if args.expect_missing_pg is not None and len(insert_candidates) != args.expect_missing_pg:
        raise RuntimeError(
            json.dumps(
                {
                    'expectedMissingPg': args.expect_missing_pg,
                    'actualMissingPg': len(insert_candidates),
                    'insertCandidates': [
                        {
                            'employeeId': entry['employeeId'],
                            'sqliteTemplateId': entry['sqliteTemplateId'],
                            'name': entry['name'],
                        }
                        for entry in insert_candidates
                    ],
                },
                ensure_ascii=False,
            )
        )

    db_env = pre.docker_env(args.db_container)
    employees = pre.psql_json(args.db_container, db_env, pre.SQL_EMPLOYEES) or []
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

    sqlite_payload = pre.load_sqlite_payload(args.app_container)
    sqlite_days_by_template: dict[int, list[dict[str, Any]]] = {}
    sqlite_templates_by_pair: dict[tuple[int, int], dict[str, Any]] = {}
    for row in sqlite_payload.get('days', []):
        sqlite_days_by_template.setdefault(int(row['template_id']), []).append(row)
    for template in sqlite_payload.get('templates', []):
        sqlite_templates_by_pair[(int(template['employee_id']), int(template['id']))] = template

    candidate_by_pair = {
        (int(entry['employeeId']), int(entry['sqliteTemplateId'])): entry
        for entry in insert_candidates
    }

    prepared: list[dict[str, Any]] = []
    for pair in sorted(candidate_by_pair):
        expected = candidate_by_pair[pair]
        template = sqlite_templates_by_pair.get(pair)
        if template is None:
            raise RuntimeError(json.dumps({'missingSqliteTemplateForCandidate': {'employeeId': pair[0], 'sqliteTemplateId': pair[1]}}, ensure_ascii=False))
        status, built = pre.build_sqlite_entry(template, sqlite_days_by_template.get(int(template['id']), []), employee_by_id)
        if status != 'ok':
            raise RuntimeError(json.dumps({'unexpectedTemplateStatus': status, 'candidate': {'employeeId': pair[0], 'sqliteTemplateId': pair[1], 'name': template.get('name')}}, ensure_ascii=False))
        if built['tenantId'] != expected['tenantId'] or built['normalizedName'] != expected['normalizedName'] or built['dayFingerprint'] != expected['dayFingerprint']:
            raise RuntimeError(
                json.dumps(
                    {
                        'candidateMismatch': {
                            'employeeId': pair[0],
                            'sqliteTemplateId': pair[1],
                            'expected': {
                                'tenantId': expected['tenantId'],
                                'normalizedName': expected['normalizedName'],
                                'dayFingerprint': expected['dayFingerprint'],
                            },
                            'actual': {
                                'tenantId': built['tenantId'],
                                'normalizedName': built['normalizedName'],
                                'dayFingerprint': built['dayFingerprint'],
                            },
                        }
                    },
                    ensure_ascii=False,
                )
            )
        created_at = template.get('created_at')
        updated_at = template.get('updated_at')
        if not created_at or not updated_at:
            raise RuntimeError(
                json.dumps(
                    {
                        'missingTemplateTimestamps': {
                            'employeeId': pair[0],
                            'sqliteTemplateId': pair[1],
                            'created_at': created_at,
                            'updated_at': updated_at,
                        }
                    },
                    ensure_ascii=False,
                )
            )
        day_rows, skipped = build_filtered_day_rows(pre, sqlite_days_by_template.get(int(template['id']), []))
        if skipped != int(expected['legacyEmptyAbsenceSegmentsSkipped']):
            raise RuntimeError(
                json.dumps(
                    {
                        'legacyFilterMismatch': {
                            'employeeId': pair[0],
                            'sqliteTemplateId': pair[1],
                            'expectedSkipped': expected['legacyEmptyAbsenceSegmentsSkipped'],
                            'actualSkipped': skipped,
                        }
                    },
                    ensure_ascii=False,
                )
            )
        prepared.append(
            {
                'tenantId': built['tenantId'],
                'employeeId': built['employeeId'],
                'name': template.get('name') or '',
                'normalizedName': built['normalizedName'],
                'sqliteTemplateId': int(template['id']),
                'createdAt': created_at,
                'updatedAt': updated_at,
                'dayFingerprint': built['dayFingerprint'],
                'dayRows': day_rows,
            }
        )

    executed_sql = False
    inserted_pairs: list[dict[str, Any]] = []
    inserted_day_count = 0
    if prepared and args.apply:
        insert_sql = build_insert_sql(prepared)
        pre.run(
            [
                'docker',
                'exec',
                '-i',
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
                '-f',
                '-',
            ],
            input_text=insert_sql,
        )
        executed_sql = True
        inserted_pairs = [
            {
                'employeeId': item['employeeId'],
                'sqliteTemplateId': item['sqliteTemplateId'],
                'name': item['name'],
            }
            for item in prepared
        ]
        inserted_day_count = sum(len(item['dayRows']) for item in prepared)

    summary = {
        'meta': {
            'appContainer': args.app_container,
            'dbContainer': args.db_container,
            'applied': args.apply,
            'executedSql': executed_sql,
        },
        'exclusions': [
            {'employeeId': employee_id, 'sqliteTemplateId': template_id}
            for employee_id, template_id in sorted(excluded_pairs)
        ],
        'effectiveGate': payload['gate'],
        'effectiveClassCounts': effective_counts,
        'insertCandidateCount': len(prepared),
        'insertDayCandidateCount': sum(len(item['dayRows']) for item in prepared),
        'insertCandidates': [
            {
                'employeeId': item['employeeId'],
                'sqliteTemplateId': item['sqliteTemplateId'],
                'name': item['name'],
                'tenantId': item['tenantId'],
                'normalizedName': item['normalizedName'],
                'dayFingerprint': item['dayFingerprint'],
                'dayRowCount': len(item['dayRows']),
            }
            for item in prepared
        ],
        'insertedPairs': inserted_pairs,
        'insertedDayCount': inserted_day_count,
        'conflictFree': payload['effectiveClasses']['conflict_free'],
    }

    print('personal_template_backfill')
    print(f"  applied: {str(args.apply).lower()}")
    print(f"  executed_sql: {str(executed_sql).lower()}")
    print(f"  exclusions: {summary['exclusions']}")
    print(f"  insert_candidate_count: {summary['insertCandidateCount']}")
    print(f"  insert_day_candidate_count: {summary['insertDayCandidateCount']}")
    print(f"  inserted_pairs: {inserted_pairs}")

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
