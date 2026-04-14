"""Math channels — user-defined calculated channels from formulas."""

import ast
import math
import os
from typing import Optional

import numpy as np
import pyarrow as pa
import pyarrow.ipc as ipc
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_db
from ..xrk_service import CACHE_DIR, get_resampled_lap_data

router = APIRouter()

# Safe math functions allowed in formulas
SAFE_FUNCTIONS = {
    "sqrt": np.sqrt,
    "abs": np.abs,
    "sin": np.sin,
    "cos": np.cos,
    "tan": np.tan,
    "log": np.log,
    "log10": np.log10,
    "exp": np.exp,
    "min": np.minimum,
    "max": np.maximum,
    "clip": np.clip,
    "pi": math.pi,
}


class MathChannelRequest(BaseModel):
    name: str
    formula: str
    units: str = ""


def _safe_eval_formula(formula: str, channel_data: dict[str, np.ndarray]) -> np.ndarray:
    """
    Safely evaluate a math formula against channel data using AST parsing.
    Only allows math operations, no arbitrary code execution.
    """
    # Replace ^ with ** for exponentiation
    formula = formula.replace("^", "**")

    # Parse AST and validate
    try:
        tree = ast.parse(formula, mode="eval")
    except SyntaxError as e:
        raise ValueError(f"Invalid formula syntax: {e}")

    _validate_ast(tree.body)

    # Build evaluation namespace
    namespace = {**SAFE_FUNCTIONS}
    for name, arr in channel_data.items():
        # Allow both exact names and underscore-normalized names
        namespace[name] = arr
        safe_name = name.replace(" ", "_").replace("/", "_")
        namespace[safe_name] = arr

    try:
        result = eval(compile(tree, "<formula>", "eval"), {"__builtins__": {}}, namespace)
    except Exception as e:
        raise ValueError(f"Formula evaluation error: {e}")

    if isinstance(result, (int, float)):
        result = np.full(next(iter(channel_data.values())).shape, result)

    return np.asarray(result, dtype=np.float64)


def _validate_ast(node):
    """Recursively validate AST nodes are safe (math only)."""
    allowed_types = (
        ast.Expression, ast.BinOp, ast.UnaryOp, ast.Call, ast.Name,
        ast.Constant, ast.Attribute, ast.Subscript, ast.Index,
        ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod,
        ast.FloorDiv, ast.USub, ast.UAdd,
        ast.Compare, ast.Gt, ast.Lt, ast.GtE, ast.LtE, ast.Eq,
        ast.BoolOp, ast.And, ast.Or, ast.IfExp,
    )
    if not isinstance(node, allowed_types):
        raise ValueError(f"Unsafe operation: {type(node).__name__}")
    for child in ast.iter_child_nodes(node):
        _validate_ast(child)


@router.post("/sessions/{session_id}/math-channels")
async def create_math_channel(session_id: str, req: MathChannelRequest):
    """
    Create a calculated channel from a formula.
    Formula can reference any channel name (use underscores or exact names).
    Supported: +, -, *, /, ^, sqrt, abs, sin, cos, tan, log, min, max, clip.
    """
    # Figure out which channels the formula references
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT name FROM channels WHERE session_id = ?",
            (session_id,),
        )
        all_channels = [row["name"] for row in await cursor.fetchall()]
    finally:
        await db.close()

    # Find referenced channels in formula
    formula_normalized = req.formula.replace("^", "**")
    referenced = []
    for ch in all_channels:
        safe = ch.replace(" ", "_").replace("/", "_")
        if ch in req.formula or safe in formula_normalized:
            referenced.append(ch)

    if not referenced:
        raise HTTPException(400, "Formula doesn't reference any known channels")

    # Get all laps
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT num FROM laps WHERE session_id = ? AND num > 0",
            (session_id,),
        )
        lap_nums = [row["num"] for row in await cursor.fetchall()]
    finally:
        await db.close()

    if not lap_nums:
        raise HTTPException(404, "No laps found")

    # Validate formula on first lap
    table = get_resampled_lap_data(session_id, referenced, lap_nums[0])
    if table is None:
        raise HTTPException(404, "Channel data not available")

    channel_data = {}
    for ch in referenced:
        if ch in table.column_names:
            channel_data[ch] = np.array(table.column(ch).to_pylist(), dtype=np.float64)

    try:
        result = _safe_eval_formula(req.formula, channel_data)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Now compute and cache for ALL laps
    for lap_num in lap_nums:
        lap_table = get_resampled_lap_data(session_id, referenced, lap_num)
        if lap_table is None:
            continue

        lap_data = {}
        for ch in referenced:
            if ch in lap_table.column_names:
                lap_data[ch] = np.array(lap_table.column(ch).to_pylist(), dtype=np.float64)

        try:
            lap_result = _safe_eval_formula(req.formula, lap_data)
        except ValueError:
            continue

        tc = lap_table.column("timecodes")

        # Save as Arrow IPC
        math_table = pa.table({
            "timecodes": tc,
            req.name: pa.array(lap_result, type=pa.float64()),
        })

        safe_name = req.name.replace(" ", "_").replace("/", "_")
        cache_dir = os.path.join(CACHE_DIR, session_id)
        os.makedirs(cache_dir, exist_ok=True)
        arrow_path = os.path.join(cache_dir, f"{safe_name}.arrow")

        with pa.OSFile(arrow_path, "wb") as f:
            writer = ipc.new_file(f, math_table.schema)
            writer.write_table(math_table)
            writer.close()

    # Register in database
    db = await get_db()
    try:
        await db.execute(
            "INSERT OR REPLACE INTO math_channels (session_id, name, formula, units) VALUES (?, ?, ?, ?)",
            (session_id, req.name, req.formula, req.units),
        )
        await db.execute(
            "INSERT OR REPLACE INTO channels (session_id, name, units, dec_pts, sample_count, interpolate, function_name, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, req.name, req.units, 2, len(result), True, req.formula, "Math"),
        )
        await db.commit()
    finally:
        await db.close()

    return {
        "name": req.name,
        "formula": req.formula,
        "units": req.units,
        "sample_count": len(result),
    }


@router.get("/sessions/{session_id}/math-channels")
async def list_math_channels(session_id: str):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT name, formula, units, created_at FROM math_channels WHERE session_id = ?",
            (session_id,),
        )
        return [dict(row) for row in await cursor.fetchall()]
    finally:
        await db.close()


@router.delete("/sessions/{session_id}/math-channels/{name}")
async def delete_math_channel(session_id: str, name: str):
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM math_channels WHERE session_id = ? AND name = ?",
            (session_id, name),
        )
        await db.execute(
            "DELETE FROM channels WHERE session_id = ? AND name = ?",
            (session_id, name),
        )
        await db.commit()
    finally:
        await db.close()

    # Clean up cached arrow file
    safe_name = name.replace(" ", "_").replace("/", "_")
    arrow_path = os.path.join(CACHE_DIR, session_id, f"{safe_name}.arrow")
    if os.path.exists(arrow_path):
        os.remove(arrow_path)

    return {"deleted": name}
