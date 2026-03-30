#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
WEEKDAY_SAMPLES = {
    "mon": "2026-03-23",
    "tue": "2026-03-24",
    "wed": "2026-03-25",
    "thu": "2026-03-26",
    "fri": "2026-03-27",
    "sat": "2026-03-28",
    "sun": "2026-03-29",
}
CLASS_ORDER = [
    "conflict_free",
    "missing_pg",
    "missing_sqlite",
    "raw_mismatch",
    "derived_mismatch_main",
    "derived_mismatch_admin",
    "hard_stop_duplicate_sqlite",
    "hard_stop_duplicate_pg",
    "hard_stop_orphan_employee",
]
RAW_FIELD_NAMES = ["two_week_cycle"]
for prefix in ("w1", "w2"):
    for day_key in DAY_KEYS:
        RAW_FIELD_NAMES.append(f"{prefix}_{day_key}_start")
        RAW_FIELD_NAMES.append(f"{prefix}_{day_key}_end")
for prefix in ("w1", "w2"):
    for day_key in DAY_KEYS:
        RAW_FIELD_NAMES.append(f"{prefix}_{day_key}_req_pause_min")

SQLITE_NODE_SCRIPT = r"""
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH, { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT
    rowid AS _rowid,
    employee_id,
    two_week_cycle,
    W1_mon_start AS w1_mon_start,
    W1_mon_end AS w1_mon_end,
    W1_tue_start AS w1_tue_start,
    W1_tue_end AS w1_tue_end,
    W1_wed_start AS w1_wed_start,
    W1_wed_end AS w1_wed_end,
    W1_thu_start AS w1_thu_start,
    W1_thu_end AS w1_thu_end,
    W1_fri_start AS w1_fri_start,
    W1_fri_end AS w1_fri_end,
    W1_sat_start AS w1_sat_start,
    W1_sat_end AS w1_sat_end,
    W1_sun_start AS w1_sun_start,
    W1_sun_end AS w1_sun_end,
    W2_mon_start AS w2_mon_start,
    W2_mon_end AS w2_mon_end,
    W2_tue_start AS w2_tue_start,
    W2_tue_end AS w2_tue_end,
    W2_wed_start AS w2_wed_start,
    W2_wed_end AS w2_wed_end,
    W2_thu_start AS w2_thu_start,
    W2_thu_end AS w2_thu_end,
    W2_fri_start AS w2_fri_start,
    W2_fri_end AS w2_fri_end,
    W2_sat_start AS w2_sat_start,
    W2_sat_end AS w2_sat_end,
    W2_sun_start AS w2_sun_start,
    W2_sun_end AS w2_sun_end,
    W1_mon_req_pause_min AS w1_mon_req_pause_min,
    W1_tue_req_pause_min AS w1_tue_req_pause_min,
    W1_wed_req_pause_min AS w1_wed_req_pause_min,
    W1_thu_req_pause_min AS w1_thu_req_pause_min,
    W1_fri_req_pause_min AS w1_fri_req_pause_min,
    W1_sat_req_pause_min AS w1_sat_req_pause_min,
    W1_sun_req_pause_min AS w1_sun_req_pause_min,
    W2_mon_req_pause_min AS w2_mon_req_pause_min,
    W2_tue_req_pause_min AS w2_tue_req_pause_min,
    W2_wed_req_pause_min AS w2_wed_req_pause_min,
    W2_thu_req_pause_min AS w2_thu_req_pause_min,
    W2_fri_req_pause_min AS w2_fri_req_pause_min,
    W2_sat_req_pause_min AS w2_sat_req_pause_min,
    W2_sun_req_pause_min AS w2_sun_req_pause_min
  FROM shift_plans
  ORDER BY employee_id, rowid
`).all();
console.log(JSON.stringify({ databasePath: process.env.DATABASE_PATH ?? null, rows }));
""".strip()

SQL_EMPLOYEE_IDS = """
SELECT COALESCE(json_agg("id" ORDER BY "id"), '[]'::json)
FROM "Employee";
""".strip()

SQL_DAILY_DAY_SCHICHT = """
SELECT COALESCE(json_agg(val ORDER BY val), '[]'::json)
FROM (
  SELECT DISTINCT "schicht" AS val
  FROM "DailyDay"
  WHERE "schicht" IS NOT NULL AND btrim("schicht") <> ''
) t;
""".strip()

SQL_SHIFT_PLAN_DAY_LABEL = """
SELECT COALESCE(json_agg(val ORDER BY val), '[]'::json)
FROM (
  SELECT DISTINCT "label" AS val
  FROM "ShiftPlanDay"
  WHERE "label" IS NOT NULL AND btrim("label") <> ''
) t;
""".strip()

SQL_LEAVE_REQUEST_REASON = """
SELECT COALESCE(json_agg(val ORDER BY val), '[]'::json)
FROM (
  SELECT DISTINCT "reason" AS val
  FROM "LeaveRequest"
  WHERE "reason" IS NOT NULL AND btrim("reason") <> ''
) t;
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
        details = stderr or stdout or f"exit {result.returncode}"
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{details}")
    return result.stdout.strip()



def docker_env(container: str) -> dict[str, str]:
    raw = run(["docker", "inspect", container, "--format", "{{json .Config.Env}}"])
    items = json.loads(raw)
    env: dict[str, str] = {}
    for item in items:
        if "=" in item:
            key, value = item.split("=", 1)
        else:
            key, value = item, ""
        env[key] = value
    return env



def psql_json(db_container: str, db_env: dict[str, str], sql: str) -> Any:
    output = run(
        [
            "docker",
            "exec",
            "-e",
            f"PGPASSWORD={db_env.get('POSTGRES_PASSWORD', '')}",
            db_container,
            "psql",
            "-U",
            db_env["POSTGRES_USER"],
            "-d",
            db_env["POSTGRES_DB"],
            "-Atqc",
            sql,
        ]
    )
    if not output:
        return None
    return json.loads(output)



def load_sqlite_rows(app_container: str) -> tuple[str | None, list[dict[str, Any]]]:
    output = run(["docker", "exec", "-i", app_container, "node", "-"], input_text=SQLITE_NODE_SCRIPT)
    payload = json.loads(output)
    return payload.get("databasePath"), payload.get("rows", [])



def normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().lower()
    return normalized or None



def sanitize_time(value: Any) -> str | None:
    if value is None:
        return None
    trimmed = str(value).strip()
    if not trimmed:
        return None
    parts = trimmed.split(":")
    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit() and len(parts[1]) == 2:
        return trimmed.zfill(5)
    return trimmed



def safe_pause(value: Any) -> int:
    if value is None:
        return 0
    try:
        return max(0, int(round(float(value))))
    except (TypeError, ValueError):
        return 0



def parse_time_string(value: str | None) -> tuple[int, int] | None:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    parts = trimmed.split(":")
    if len(parts) != 2:
        return None
    try:
        hours = int(parts[0], 10)
        minutes = int(parts[1], 10)
    except ValueError:
        return None
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        return None
    return hours, minutes



def time_to_decimal(parsed: tuple[int, int] | None) -> float:
    if parsed is None:
        return 0.0
    return parsed[0] + parsed[1] / 60.0



def calculate_legal_pause_hours(total_raw_hours: float) -> float:
    if total_raw_hours > 9:
        return 0.75
    if total_raw_hours > 6:
        return 0.5
    return 0.0



def build_plan_hours(start: str | None, end: str | None, required_pause_minutes: int) -> dict[str, Any]:
    start_time = parse_time_string(start)
    end_time = parse_time_string(end)
    if not start_time or not end_time:
        return {
            "rawHours": 0.0,
            "sollHours": 0.0,
            "requiredPauseMinutes": required_pause_minutes,
            "start": start,
            "end": end,
        }
    raw = max(0.0, time_to_decimal(end_time) - time_to_decimal(start_time))
    if raw <= 0.01:
        return {
            "rawHours": 0.0,
            "sollHours": 0.0,
            "requiredPauseMinutes": required_pause_minutes,
            "start": start,
            "end": end,
        }
    legal_pause = calculate_legal_pause_hours(raw)
    required_pause_hours = required_pause_minutes / 60.0
    soll = max(raw - max(legal_pause, required_pause_hours), 0.0)
    return {
        "rawHours": round(raw, 2),
        "sollHours": round(soll, 2),
        "requiredPauseMinutes": required_pause_minutes,
        "start": start,
        "end": end,
    }



def calculate_admin_hours(start: str | None, end: str | None, required_pause_minutes: int) -> dict[str, float]:
    start_time = parse_time_string(start)
    end_time = parse_time_string(end)
    if not start_time or not end_time:
        return {"rawHours": 0.0, "netHours": 0.0}
    diff = time_to_decimal(end_time) - time_to_decimal(start_time)
    if diff < 0:
        diff += 24.0
    raw = max(diff, 0.0)
    legal_pause = calculate_legal_pause_hours(raw)
    manual_pause = min(max(required_pause_minutes, 0), 180) / 60.0
    effective_pause = max(legal_pause, manual_pause)
    net = max(raw - effective_pause, 0.0)
    return {
        "rawHours": round(raw, 2),
        "netHours": round(net, 2),
    }



def day_key_for_iso(iso_date: str) -> str:
    date = datetime.strptime(iso_date, "%Y-%m-%d")
    return DAY_KEYS[date.weekday()]



def get_row_entry(row: dict[str, Any] | None, prefix: str, day_key: str) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "start": sanitize_time(row.get(f"{prefix}_{day_key}_start")),
        "end": sanitize_time(row.get(f"{prefix}_{day_key}_end")),
        "requiredPauseMinutes": safe_pause(row.get(f"{prefix}_{day_key}_req_pause_min")),
    }



def derive_main(row: dict[str, Any] | None, iso_date: str, schicht: str | None) -> dict[str, Any] | None:
    if row is None:
        return None
    day_key = day_key_for_iso(iso_date)
    two_week = normalize_text(row.get("two_week_cycle")) == "yes"
    prefix = "w1"
    if two_week:
        normalized_schicht = normalize_text(schicht) or ""
        prefix = "w2" if normalized_schicht == "spät" else "w1"
    entry = get_row_entry(row, prefix, day_key)
    if entry is None:
        return None
    return {
        **entry,
        "selectedWeek": prefix,
        "planHours": build_plan_hours(entry["start"], entry["end"], entry["requiredPauseMinutes"]),
    }



def derive_admin(row: dict[str, Any] | None, iso_date: str, label: str | None) -> dict[str, Any] | None:
    if row is None:
        return None
    day_key = day_key_for_iso(iso_date)
    two_week = normalize_text(row.get("two_week_cycle")) == "yes"
    prefix = "w1"
    if two_week:
        normalized_label = normalize_text(label) or ""
        prefix = "w2" if "spät" in normalized_label else "w1"
    entry = get_row_entry(row, prefix, day_key)
    if entry is None:
        return None
    return {
        **entry,
        "selectedWeek": prefix,
        **calculate_admin_hours(entry["start"], entry["end"], entry["requiredPauseMinutes"]),
    }



def canonical_row(source_row: dict[str, Any], employee_key: str) -> dict[str, Any]:
    canonical: dict[str, Any] = {"employee_id": int(source_row[employee_key])}
    for field_name in RAW_FIELD_NAMES:
        if field_name.endswith("_start") or field_name.endswith("_end"):
            canonical[field_name] = sanitize_time(source_row.get(field_name))
        elif field_name.endswith("_req_pause_min"):
            canonical[field_name] = safe_pause(source_row.get(field_name))
        else:
            canonical[field_name] = normalize_text(source_row.get(field_name))
    return canonical



def grouped_by_employee(rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        employee_id = int(row["employee_id"])
        grouped.setdefault(employee_id, []).append(row)
    return grouped



def diff_raw(sqlite_row: dict[str, Any], pg_row: dict[str, Any]) -> list[dict[str, Any]]:
    diffs: list[dict[str, Any]] = []
    for field_name in RAW_FIELD_NAMES:
        sqlite_value = sqlite_row.get(field_name)
        pg_value = pg_row.get(field_name)
        if sqlite_value != pg_value:
            diffs.append({"field": field_name, "sqlite": sqlite_value, "pg": pg_value})
    return diffs



def runtime_value_report(raw_values: list[str]) -> dict[str, Any]:
    normalized_pairs = []
    seen: set[tuple[str, str | None]] = set()
    for raw in sorted(raw_values):
        normalized = normalize_text(raw)
        pair = (raw, normalized)
        if pair in seen:
            continue
        seen.add(pair)
        normalized_pairs.append({"raw": raw, "normalized": normalized})
    normalized_values = sorted(
        {pair["normalized"] for pair in normalized_pairs if pair["normalized"] is not None}
    )
    return {
        "raw": sorted(raw_values),
        "normalized": normalized_values,
        "pairs": normalized_pairs,
    }



def distinct_compare_inputs(runtime_sources: dict[str, dict[str, Any]]) -> list[str | None]:
    values: list[str | None] = [None, "spät"]
    seen = {"<null>", "spät"}
    for source in runtime_sources.values():
        for raw in source["raw"]:
            if raw in seen:
                continue
            seen.add(raw)
            values.append(raw)
    return values



def build_pg_shift_plan_sql() -> str:
    select_fields = [
        '"id" AS id',
        '"employeeId" AS employee_id',
        '"twoWeekCycle" AS two_week_cycle',
    ]
    for prefix in ("W1", "W2"):
        lower_prefix = prefix.lower()
        for day_key in DAY_KEYS:
            select_fields.append(f'"{prefix}_{day_key}_start" AS {lower_prefix}_{day_key}_start')
            select_fields.append(f'"{prefix}_{day_key}_end" AS {lower_prefix}_{day_key}_end')
        for day_key in DAY_KEYS:
            select_fields.append(
                f'"{prefix}_{day_key}_req_pause_min" AS {lower_prefix}_{day_key}_req_pause_min'
            )
    inner = ",\n        ".join(select_fields)
    return (
        "SELECT COALESCE(json_agg(t ORDER BY employee_id, id), '[]'::json) "
        f"FROM (SELECT {inner} FROM \"ShiftPlan\") t;"
    )



def filter_class_items(items: list[dict[str, Any]], excluded_employee_ids: set[int]) -> list[dict[str, Any]]:
    if not excluded_employee_ids:
        return list(items)
    return [item for item in items if int(item.get("employeeId")) not in excluded_employee_ids]



def build_effective_payload(
    class_payload: dict[str, list[dict[str, Any]]], excluded_employee_ids: set[int]
) -> dict[str, list[dict[str, Any]]]:
    return {
        class_name: filter_class_items(class_payload[class_name], excluded_employee_ids)
        for class_name in CLASS_ORDER
    }



def build_ignored_by_exclusion_payload(
    class_payload: dict[str, list[dict[str, Any]]], excluded_employee_ids: set[int]
) -> dict[str, list[dict[str, Any]]]:
    if not excluded_employee_ids:
        return {class_name: [] for class_name in CLASS_ORDER}
    return {
        class_name: [
            item for item in class_payload[class_name] if int(item.get("employeeId")) in excluded_employee_ids
        ]
        for class_name in CLASS_ORDER
    }



def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only preflight / shadow-compare for SQLite shift_plans -> PostgreSQL ShiftPlan."
    )
    parser.add_argument("--app-container", default="ops-stundenliste-prisma-1")
    parser.add_argument("--db-container", default="ops-timeshift-db-1")
    parser.add_argument("--exclude-employee-id", action="append", type=int, default=[])
    parser.add_argument("--output-json", type=Path)
    args = parser.parse_args()
    excluded_employee_ids = sorted(set(args.exclude_employee_id))
    excluded_employee_id_set = set(excluded_employee_ids)

    app_env = docker_env(args.app_container)
    db_env = docker_env(args.db_container)

    sqlite_database_path, sqlite_rows_raw = load_sqlite_rows(args.app_container)
    pg_rows_raw = psql_json(args.db_container, db_env, build_pg_shift_plan_sql()) or []
    employee_ids = set(psql_json(args.db_container, db_env, SQL_EMPLOYEE_IDS) or [])
    daily_day_schicht = psql_json(args.db_container, db_env, SQL_DAILY_DAY_SCHICHT) or []
    shift_plan_day_label = psql_json(args.db_container, db_env, SQL_SHIFT_PLAN_DAY_LABEL) or []
    leave_request_reason = psql_json(args.db_container, db_env, SQL_LEAVE_REQUEST_REASON) or []

    sqlite_rows = [canonical_row(row, "employee_id") | {"_rowid": row.get("_rowid")} for row in sqlite_rows_raw]
    pg_rows = [canonical_row(row, "employee_id") | {"_id": row.get("id")} for row in pg_rows_raw]

    sqlite_by_employee = grouped_by_employee(sqlite_rows)
    pg_by_employee = grouped_by_employee(pg_rows)

    duplicate_sqlite = [
        {
            "employeeId": employee_id,
            "count": len(rows),
            "rowids": [row.get("_rowid") for row in rows],
        }
        for employee_id, rows in sorted(sqlite_by_employee.items())
        if len(rows) > 1
    ]
    duplicate_pg = [
        {
            "employeeId": employee_id,
            "count": len(rows),
            "ids": [row.get("_id") for row in rows],
        }
        for employee_id, rows in sorted(pg_by_employee.items())
        if len(rows) > 1
    ]

    orphan_employee: list[dict[str, Any]] = []
    for employee_id, rows in sorted(sqlite_by_employee.items()):
        if employee_id not in employee_ids:
            orphan_employee.append(
                {
                    "store": "sqlite",
                    "employeeId": employee_id,
                    "rowids": [row.get("_rowid") for row in rows],
                }
            )
    for employee_id, rows in sorted(pg_by_employee.items()):
        if employee_id not in employee_ids:
            orphan_employee.append(
                {
                    "store": "pg",
                    "employeeId": employee_id,
                    "ids": [row.get("_id") for row in rows],
                }
            )

    bad_sqlite_ids = {item["employeeId"] for item in duplicate_sqlite}
    bad_pg_ids = {item["employeeId"] for item in duplicate_pg}
    orphan_ids = {item["employeeId"] for item in orphan_employee}

    sqlite_single = {
        employee_id: rows[0]
        for employee_id, rows in sqlite_by_employee.items()
        if len(rows) == 1 and employee_id not in orphan_ids
    }
    pg_single = {
        employee_id: rows[0]
        for employee_id, rows in pg_by_employee.items()
        if len(rows) == 1 and employee_id not in orphan_ids
    }

    missing_pg = [
        {"employeeId": employee_id, "rowid": sqlite_single[employee_id].get("_rowid")}
        for employee_id in sorted(sqlite_single)
        if employee_id not in pg_single and employee_id not in bad_sqlite_ids
    ]
    missing_sqlite = [
        {"employeeId": employee_id, "id": pg_single[employee_id].get("_id")}
        for employee_id in sorted(pg_single)
        if employee_id not in sqlite_single and employee_id not in bad_pg_ids
    ]

    runtime_sources = {
        "DailyDay.schicht": runtime_value_report(daily_day_schicht),
        "ShiftPlanDay.label": runtime_value_report(shift_plan_day_label),
        "LeaveRequest.reason": runtime_value_report(leave_request_reason),
    }
    compare_inputs = distinct_compare_inputs(runtime_sources)

    raw_mismatch: list[dict[str, Any]] = []
    derived_mismatch_main: list[dict[str, Any]] = []
    derived_mismatch_admin: list[dict[str, Any]] = []
    conflict_free: list[dict[str, Any]] = []

    comparable_ids = sorted(set(sqlite_single).intersection(pg_single) - bad_sqlite_ids - bad_pg_ids - orphan_ids)
    for employee_id in comparable_ids:
        sqlite_row = sqlite_single[employee_id]
        pg_row = pg_single[employee_id]
        raw_diffs = diff_raw(sqlite_row, pg_row)
        if raw_diffs:
            raw_mismatch.append({"employeeId": employee_id, "diffs": raw_diffs})

        main_diffs: list[dict[str, Any]] = []
        admin_diffs: list[dict[str, Any]] = []
        for day_key, iso_date in WEEKDAY_SAMPLES.items():
            for raw_input in compare_inputs:
                sqlite_main = derive_main(sqlite_row, iso_date, raw_input)
                pg_main = derive_main(pg_row, iso_date, raw_input)
                if sqlite_main != pg_main:
                    main_diffs.append(
                        {
                            "weekday": day_key,
                            "isoDate": iso_date,
                            "inputRaw": raw_input,
                            "inputNormalized": normalize_text(raw_input),
                            "sqlite": sqlite_main,
                            "pg": pg_main,
                        }
                    )
                sqlite_admin = derive_admin(sqlite_row, iso_date, raw_input)
                pg_admin = derive_admin(pg_row, iso_date, raw_input)
                if sqlite_admin != pg_admin:
                    admin_diffs.append(
                        {
                            "weekday": day_key,
                            "isoDate": iso_date,
                            "inputRaw": raw_input,
                            "inputNormalized": normalize_text(raw_input),
                            "sqlite": sqlite_admin,
                            "pg": pg_admin,
                        }
                    )

        if main_diffs:
            derived_mismatch_main.append({"employeeId": employee_id, "diffs": main_diffs})
        if admin_diffs:
            derived_mismatch_admin.append({"employeeId": employee_id, "diffs": admin_diffs})
        if not raw_diffs and not main_diffs and not admin_diffs:
            conflict_free.append({"employeeId": employee_id})

    class_payload = {
        "conflict_free": conflict_free,
        "missing_pg": missing_pg,
        "missing_sqlite": missing_sqlite,
        "raw_mismatch": raw_mismatch,
        "derived_mismatch_main": derived_mismatch_main,
        "derived_mismatch_admin": derived_mismatch_admin,
        "hard_stop_duplicate_sqlite": duplicate_sqlite,
        "hard_stop_duplicate_pg": duplicate_pg,
        "hard_stop_orphan_employee": orphan_employee,
    }
    class_counts = {class_name: len(class_payload[class_name]) for class_name in CLASS_ORDER}
    effective_class_payload = build_effective_payload(class_payload, excluded_employee_id_set)
    effective_class_counts = {
        class_name: len(effective_class_payload[class_name]) for class_name in CLASS_ORDER
    }
    ignored_by_exclusion = build_ignored_by_exclusion_payload(class_payload, excluded_employee_id_set)
    ignored_by_exclusion_counts = {
        class_name: len(ignored_by_exclusion[class_name]) for class_name in CLASS_ORDER
    }

    effective_duplicate_sqlite = effective_class_payload["hard_stop_duplicate_sqlite"]
    effective_duplicate_pg = effective_class_payload["hard_stop_duplicate_pg"]
    effective_orphan_employee = effective_class_payload["hard_stop_orphan_employee"]
    effective_missing_sqlite = effective_class_payload["missing_sqlite"]
    effective_raw_mismatch = effective_class_payload["raw_mismatch"]
    effective_derived_mismatch_main = effective_class_payload["derived_mismatch_main"]
    effective_derived_mismatch_admin = effective_class_payload["derived_mismatch_admin"]

    ready_for_unique = len(effective_duplicate_pg) == 0 and not any(
        item["store"] == "pg" for item in effective_orphan_employee
    )
    ready_for_backfill = (
        ready_for_unique
        and len(effective_duplicate_sqlite) == 0
        and len(effective_orphan_employee) == 0
        and len(effective_raw_mismatch) == 0
        and len(effective_derived_mismatch_main) == 0
        and len(effective_derived_mismatch_admin) == 0
        and len(effective_missing_sqlite) == 0
    )
    overall_status = "stop"
    if ready_for_backfill:
        overall_status = "ready_for_schema_and_backfill"
    elif ready_for_unique:
        overall_status = "ready_for_unique_only"

    gate_reasons = []
    if effective_duplicate_pg:
        gate_reasons.append("PG duplicates block @@unique([employeeId]).")
    if any(item["store"] == "pg" for item in effective_orphan_employee):
        gate_reasons.append("PG orphans against Employee block @@unique([employeeId]).")
    if effective_duplicate_sqlite:
        gate_reasons.append("SQLite duplicates block safe 1:1 backfill.")
    if any(item["store"] == "sqlite" for item in effective_orphan_employee):
        gate_reasons.append("SQLite orphans block safe backfill.")
    if effective_missing_sqlite:
        gate_reasons.append("Existing PG-only rows require manual classification before backfill.")
    if effective_raw_mismatch:
        gate_reasons.append("Raw field mismatches exist between SQLite and PG.")
    if effective_derived_mismatch_main:
        gate_reasons.append("Main-path derived mismatches exist.")
    if effective_derived_mismatch_admin:
        gate_reasons.append("Admin-copy derived mismatches exist.")
    if not gate_reasons:
        if excluded_employee_ids:
            gate_reasons.append(
                "No scoped preflight blockers detected after applying explicit employee exclusions."
            )
        else:
            gate_reasons.append("No preflight blockers detected for conservative schema + backfill prep.")

    report = {
        "meta": {
            "appContainer": args.app_container,
            "dbContainer": args.db_container,
            "databaseUrl": app_env.get("DATABASE_URL"),
            "sqliteDatabasePath": sqlite_database_path,
            "templatesIncluded": False,
            "excludedEmployeeIds": excluded_employee_ids,
        },
        "inputs": {
            "compareInputs": [
                {"raw": raw_input, "normalized": normalize_text(raw_input)}
                for raw_input in compare_inputs
            ],
            "runtimeSources": runtime_sources,
        },
        "inventory": {
            "sqliteShiftPlanRows": len(sqlite_rows),
            "pgShiftPlanRows": len(pg_rows),
            "employeeRows": len(employee_ids),
        },
        "classes": class_payload,
        "classCounts": class_counts,
        "effectiveClasses": effective_class_payload,
        "effectiveClassCounts": effective_class_counts,
        "exclusions": {
            "employeeIds": excluded_employee_ids,
            "ignoredByGate": ignored_by_exclusion,
            "ignoredByGateCounts": ignored_by_exclusion_counts,
        },
        "gates": {
            "readyForUnique": ready_for_unique,
            "readyForBackfill": ready_for_backfill,
            "overallStatus": overall_status,
            "reasons": gate_reasons,
        },
    }

    print("shift_plan_fallback_preflight")
    print(f"  app_container: {args.app_container}")
    print(f"  db_container: {args.db_container}")
    print(f"  sqlite_database_path: {sqlite_database_path}")
    print(f"  excluded_employee_ids: {excluded_employee_ids}")
    print(f"  sqlite_shift_plan_rows: {len(sqlite_rows)}")
    print(f"  pg_shift_plan_rows: {len(pg_rows)}")
    print(f"  employee_rows: {len(employee_ids)}")
    print("  result_classes_raw:")
    for class_name in CLASS_ORDER:
        print(f"    {class_name}: {class_counts[class_name]}")
    print("  result_classes_effective:")
    for class_name in CLASS_ORDER:
        print(f"    {class_name}: {effective_class_counts[class_name]}")
    if excluded_employee_ids:
        print("  ignored_by_exclusion:")
        for class_name in CLASS_ORDER:
            print(f"    {class_name}: {ignored_by_exclusion_counts[class_name]}")
    print("  gates:")
    print(f"    ready_for_unique: {str(ready_for_unique).lower()}")
    print(f"    ready_for_backfill: {str(ready_for_backfill).lower()}")
    print(f"    overall_status: {overall_status}")
    for reason in gate_reasons:
        print(f"    reason: {reason}")

    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  wrote_json: {args.output_json}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:  # pragma: no cover - operational script
        print(f"preflight failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
