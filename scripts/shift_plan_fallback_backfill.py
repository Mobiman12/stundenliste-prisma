#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

ALLOWED_IDS = [1, 3, 5, 15, 16, 17, 18, 19, 20, 22]
EXCLUDED_IDS = [2, 4, 6, 7, 9, 11, 12, 21]


def load_preflight_module() -> Any:
    path = Path(__file__).with_name("shift_plan_fallback_preflight.py")
    spec = importlib.util.spec_from_file_location("shift_plan_fallback_preflight", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load preflight module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def pg_select_sql(pre: Any, employee_ids: list[int]) -> str:
    ids_sql = ", ".join(str(employee_id) for employee_id in employee_ids)
    select_fields = [
        '"id" AS id',
        '"employeeId" AS employee_id',
        '"twoWeekCycle" AS two_week_cycle',
    ]
    for prefix in ("W1", "W2"):
        lower_prefix = prefix.lower()
        for day_key in pre.DAY_KEYS:
            select_fields.append(f'"{prefix}_{day_key}_start" AS {lower_prefix}_{day_key}_start')
            select_fields.append(f'"{prefix}_{day_key}_end" AS {lower_prefix}_{day_key}_end')
        for day_key in pre.DAY_KEYS:
            select_fields.append(
                f'"{prefix}_{day_key}_req_pause_min" AS {lower_prefix}_{day_key}_req_pause_min'
            )
    inner = ",\n        ".join(select_fields)
    return (
        "SELECT COALESCE(json_agg(t ORDER BY employee_id, id), '[]'::json) "
        f"FROM (SELECT {inner} FROM \"ShiftPlan\" WHERE \"employeeId\" IN ({ids_sql})) t;"
    )


def build_insert_sql(rows: list[dict[str, Any]]) -> str:
    columns = [
        '"employeeId"',
        '"twoWeekCycle"',
    ]
    for prefix in ("W1", "W2"):
        for day_key in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
            columns.append(f'"{prefix}_{day_key}_start"')
            columns.append(f'"{prefix}_{day_key}_end"')
    for prefix in ("W1", "W2"):
        for day_key in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
            columns.append(f'"{prefix}_{day_key}_req_pause_min"')

    value_rows = []
    for row in rows:
        values = [
            sql_literal(row["employee_id"]),
            sql_literal(row["two_week_cycle"] or "no"),
        ]
        for prefix in ("w1", "w2"):
            for day_key in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
                values.append(sql_literal(row[f"{prefix}_{day_key}_start"]))
                values.append(sql_literal(row[f"{prefix}_{day_key}_end"]))
        for prefix in ("w1", "w2"):
            for day_key in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
                values.append(sql_literal(row[f"{prefix}_{day_key}_req_pause_min"]))
        value_rows.append("(" + ", ".join(values) + ")")

    return (
        "BEGIN;\n"
        f"INSERT INTO \"ShiftPlan\" ({', '.join(columns)})\nVALUES\n  "
        + ",\n  ".join(value_rows)
        + "\nCOMMIT;"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Conservative backfill for SQLite shift_plans -> PostgreSQL ShiftPlan.")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--app-container", default="ops-stundenliste-prisma-1")
    parser.add_argument("--db-container", default="ops-timeshift-db-1")
    parser.add_argument("--output-json", type=Path)
    args = parser.parse_args()

    pre = load_preflight_module()
    app_env = pre.docker_env(args.app_container)
    db_env = pre.docker_env(args.db_container)
    sqlite_database_path, sqlite_rows_raw = pre.load_sqlite_rows(args.app_container)

    sqlite_rows = [pre.canonical_row(row, "employee_id") | {"_rowid": row.get("_rowid")} for row in sqlite_rows_raw]
    sqlite_by_employee = pre.grouped_by_employee(sqlite_rows)

    allowed_sqlite: dict[int, dict[str, Any]] = {}
    excluded_sqlite: dict[int, list[dict[str, Any]]] = {}

    for employee_id in ALLOWED_IDS:
        rows = sqlite_by_employee.get(employee_id, [])
        if len(rows) != 1:
            raise RuntimeError(f"allowed employeeId {employee_id} expected exactly 1 sqlite row, found {len(rows)}")
        allowed_sqlite[employee_id] = rows[0]

    for employee_id in EXCLUDED_IDS:
        excluded_sqlite[employee_id] = sqlite_by_employee.get(employee_id, [])

    pg_rows_raw = pre.psql_json(args.db_container, db_env, pg_select_sql(pre, ALLOWED_IDS + EXCLUDED_IDS)) or []
    pg_rows = [pre.canonical_row(row, "employee_id") | {"_id": row.get("id")} for row in pg_rows_raw]
    pg_by_employee = pre.grouped_by_employee(pg_rows)

    for employee_id in ALLOWED_IDS + EXCLUDED_IDS:
        if len(pg_by_employee.get(employee_id, [])) > 1:
            raise RuntimeError(f"employeeId {employee_id} has duplicate PG ShiftPlan rows")

    unexpected_excluded_pg = [employee_id for employee_id in EXCLUDED_IDS if pg_by_employee.get(employee_id)]
    if unexpected_excluded_pg:
        raise RuntimeError(f"excluded employeeIds unexpectedly present in PG ShiftPlan: {unexpected_excluded_pg}")

    already_present: list[int] = []
    inserted_candidates: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []

    for employee_id in ALLOWED_IDS:
        sqlite_row = allowed_sqlite[employee_id]
        pg_rows_for_employee = pg_by_employee.get(employee_id, [])
        if not pg_rows_for_employee:
            inserted_candidates.append(sqlite_row)
            continue
        pg_row = pg_rows_for_employee[0]
        diffs = pre.diff_raw(sqlite_row, pg_row)
        if diffs:
            conflicts.append({"employeeId": employee_id, "diffs": diffs})
        else:
            already_present.append(employee_id)

    if conflicts:
        raise RuntimeError(json.dumps({"conflicts": conflicts}, ensure_ascii=False))

    inserted_ids: list[int] = []
    executed_sql = False
    if inserted_candidates and args.apply:
        insert_sql = build_insert_sql(inserted_candidates)
        pre.run(
            [
                "docker",
                "exec",
                "-e",
                f"PGPASSWORD={db_env.get('POSTGRES_PASSWORD', '')}",
                args.db_container,
                "psql",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                db_env["POSTGRES_USER"],
                "-d",
                db_env["POSTGRES_DB"],
                "-q",
                "-c",
                insert_sql,
            ]
        )
        inserted_ids = [row["employee_id"] for row in inserted_candidates]
        executed_sql = True

    summary = {
        "meta": {
            "appContainer": args.app_container,
            "dbContainer": args.db_container,
            "sqliteDatabasePath": sqlite_database_path,
            "databaseUrl": app_env.get("DATABASE_URL"),
            "applied": args.apply,
            "executedSql": executed_sql,
        },
        "allowedIds": ALLOWED_IDS,
        "excludedIds": EXCLUDED_IDS,
        "alreadyPresent": already_present,
        "insertCandidates": [row["employee_id"] for row in inserted_candidates],
        "insertedIds": inserted_ids,
        "excludedUntouched": [employee_id for employee_id in EXCLUDED_IDS if not pg_by_employee.get(employee_id)],
        "conflicts": conflicts,
    }

    print("shift_plan_fallback_backfill")
    print(f"  applied: {str(args.apply).lower()}")
    print(f"  executed_sql: {str(executed_sql).lower()}")
    print(f"  allowed_ids: {ALLOWED_IDS}")
    print(f"  excluded_ids: {EXCLUDED_IDS}")
    print(f"  already_present: {already_present}")
    print(f"  insert_candidates: {[row['employee_id'] for row in inserted_candidates]}")
    print(f"  inserted_ids: {inserted_ids}")
    print(f"  excluded_untouched: {summary['excludedUntouched']}")

    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  wrote_json: {args.output_json}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:
        print(f"backfill failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
