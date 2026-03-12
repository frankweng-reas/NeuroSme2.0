"""排班服務：使用 OR-Tools CP-SAT 求解班表"""
from __future__ import annotations

import logging
from typing import Any

from ortools.sat.python import cp_model

logger = logging.getLogger(__name__)


def solve(params: dict[str, Any]) -> dict[str, Any]:
    """
    依結構化參數求解排班。

    參數格式：
    - staff: [{"id": "s1", "name": "王小明"}, ...]
    - shifts: [{"id": "morning", "name": "早班"}, ...]
    - days: int（排班天數，0-based）
    - demand: {"0": {"morning": 2, "evening": 1}, ...}  每日每班所需人數
    - max_shifts_per_staff: int（每人總班數上限，預設 days）
    - min_shifts_per_staff: int（每人總班數下限，預設 0）
    """
    staff_list = params.get("staff") or []
    shifts_list = params.get("shifts") or []
    num_days = int(params.get("days", 7))
    demand_raw = params.get("demand") or {}
    max_per_staff = int(params.get("max_shifts_per_staff", num_days))
    min_per_staff = int(params.get("min_shifts_per_staff", 0))

    if not staff_list or not shifts_list:
        return {
            "status": "INVALID",
            "error": "staff 與 shifts 不可為空",
            "assignments": [],
        }

    staff_ids = [s["id"] if isinstance(s, dict) else str(s) for s in staff_list]
    shift_ids = [s["id"] if isinstance(s, dict) else str(s) for s in shifts_list]

    demand: dict[int, dict[str, int]] = {}
    for d in range(num_days):
        day_key = str(d)
        shift_demand = demand_raw.get(day_key) if isinstance(demand_raw, dict) else {}
        demand[d] = {}
        for sid in shift_ids:
            demand[d][sid] = int(shift_demand.get(sid, 1)) if isinstance(shift_demand, dict) else 1

    model = cp_model.CpModel()

    x: dict[str, dict[int, dict[str, Any]]] = {}
    for sid in staff_ids:
        x[sid] = {}
        for d in range(num_days):
            x[sid][d] = {}
            for shift_id in shift_ids:
                x[sid][d][shift_id] = model.NewBoolVar(f"x_{sid}_{d}_{shift_id}")

    for sid in staff_ids:
        for d in range(num_days):
            model.Add(sum(x[sid][d][shift_id] for shift_id in shift_ids) <= 1)

    for d in range(num_days):
        for shift_id in shift_ids:
            needed = demand[d].get(shift_id, 1)
            model.Add(sum(x[sid][d][shift_id] for sid in staff_ids) == needed)

    for sid in staff_ids:
        total = sum(
            x[sid][d][shift_id]
            for d in range(num_days)
            for shift_id in shift_ids
        )
        model.Add(total >= min_per_staff)
        model.Add(total <= max_per_staff)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0
    status = solver.Solve(model)

    if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
        assignments: list[dict[str, Any]] = []
        for sid in staff_ids:
            for d in range(num_days):
                for shift_id in shift_ids:
                    if solver.Value(x[sid][d][shift_id]) == 1:
                        staff_name = sid
                        for s in staff_list:
                            if isinstance(s, dict) and s.get("id") == sid:
                                staff_name = s.get("name", sid)
                                break
                        shift_name = shift_id
                        for s in shifts_list:
                            if isinstance(s, dict) and s.get("id") == shift_id:
                                shift_name = s.get("name", shift_id)
                                break
                        assignments.append({
                            "staff_id": sid,
                            "staff_name": staff_name,
                            "day": d,
                            "shift_id": shift_id,
                            "shift_name": shift_name,
                        })
        status_str = "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE"
        return {
            "status": status_str,
            "assignments": assignments,
            "objective_value": solver.ObjectiveValue() if status == cp_model.OPTIMAL else None,
        }
    if status == cp_model.INFEASIBLE:
        return {
            "status": "INFEASIBLE",
            "error": "無可行解，請放寬約束條件",
            "assignments": [],
        }
    return {
        "status": "UNKNOWN",
        "error": f"求解器回傳狀態: {status}",
        "assignments": [],
    }
