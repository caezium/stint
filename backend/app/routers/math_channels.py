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

# ----- Filter / timing helpers (Phase 18.1 + 18.2) --------------------------
# These extend the safe formula namespace with RaceStudio-3-style helpers.


def _roll_avg(arr: np.ndarray, window: int) -> np.ndarray:
    """Simple rolling mean, same-length output (edges padded with input value)."""
    w = int(max(1, window))
    if w == 1 or arr.size < 2:
        return np.asarray(arr, dtype=np.float64)
    x = np.asarray(arr, dtype=np.float64)
    # Reflect-pad to keep output length == input length.
    pad = w // 2
    padded = np.pad(x, (pad, w - pad - 1), mode="edge")
    kernel = np.ones(w) / w
    return np.convolve(padded, kernel, mode="valid")


def _ema(arr: np.ndarray, alpha: float) -> np.ndarray:
    """First-order exponential moving average with smoothing factor alpha."""
    a = float(max(1e-6, min(1.0, alpha)))
    x = np.asarray(arr, dtype=np.float64)
    if x.size == 0:
        return x
    out = np.empty_like(x)
    out[0] = x[0]
    for i in range(1, x.size):
        out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out


def _fir(arr: np.ndarray, coeffs) -> np.ndarray:
    """FIR filter via convolution with a user-provided coefficient vector."""
    x = np.asarray(arr, dtype=np.float64)
    c = np.asarray(coeffs, dtype=np.float64)
    if x.size == 0 or c.size == 0:
        return x
    c = c / c.sum() if c.sum() != 0 else c
    pad = c.size // 2
    padded = np.pad(x, (pad, c.size - pad - 1), mode="edge")
    return np.convolve(padded, c, mode="valid")


def _median_filt(arr: np.ndarray, window: int) -> np.ndarray:
    """Rolling median (pure NumPy, no SciPy dependency)."""
    w = int(max(1, window))
    if w == 1:
        return np.asarray(arr, dtype=np.float64)
    x = np.asarray(arr, dtype=np.float64)
    if x.size < w:
        return x
    pad = w // 2
    padded = np.pad(x, (pad, w - pad - 1), mode="edge")
    out = np.empty_like(x)
    for i in range(x.size):
        out[i] = np.median(padded[i : i + w])
    return out


def _time_shift(arr: np.ndarray, offset_ms: int) -> np.ndarray:
    """Phase-shift a channel by whole samples. Positive → delayed (lookback
    becomes available one sample earlier); negative → advance. This is
    approximate — it assumes uniform sample spacing from the resampled
    table, which is the convention in the rest of the math evaluator."""
    x = np.asarray(arr, dtype=np.float64)
    # Use a simple sample-shift heuristic: ms / 10 (sample rate ~100Hz). If
    # the true dt is available via `ts` we recommend `np.roll` directly.
    n = int(round(offset_ms / 10.0))
    if n == 0 or x.size == 0:
        return x
    return np.roll(x, n)


# Safe math functions allowed in formulas
SAFE_FUNCTIONS = {
    "sqrt": np.sqrt,
    "abs": np.abs,
    "sin": np.sin,
    "cos": np.cos,
    "tan": np.tan,
    "asin": np.arcsin,
    "acos": np.arccos,
    "atan": np.arctan,
    "atan2": np.arctan2,
    "log": np.log,
    "log10": np.log10,
    "log2": np.log2,
    "exp": np.exp,
    "sign": np.sign,
    "floor": np.floor,
    "ceil": np.ceil,
    "round": np.round,
    "min": np.minimum,
    "max": np.maximum,
    "clip": np.clip,
    # Rolling helpers — accept scalar window size
    "diff": np.diff,
    "pi": math.pi,
    "e": math.e,
    # Phase 18: filter functions
    "ROLL_AVG": _roll_avg,
    "EMA": _ema,
    "FIR": _fir,
    "MEDIAN_FILT": _median_filt,
    # Phase 18: timing functions
    "TIME_SHIFT": _time_shift,
    # Lowercase aliases for convenience
    "roll_avg": _roll_avg,
    "ema": _ema,
    "fir": _fir,
    "median_filt": _median_filt,
    "time_shift": _time_shift,
}
SAFE_FUNCTION_NAMES = set(SAFE_FUNCTIONS.keys())


class MathChannelRequest(BaseModel):
    name: str
    formula: str
    units: str = ""


def _normalize_formula(formula: str, channel_names: list[str]) -> str:
    """Replace channel names containing spaces with their underscore variant,
    and `^` with `**`. Longer names are replaced first so we don't half-match
    (e.g. `GPS Speed Accuracy` before `GPS Speed`).
    """
    formula = formula.replace("^", "**")
    spaced = sorted(
        (n for n in channel_names if " " in n or "/" in n),
        key=len,
        reverse=True,
    )
    for name in spaced:
        safe = name.replace(" ", "_").replace("/", "_")
        formula = formula.replace(name, safe)
    return formula


def _safe_eval_formula(formula: str, channel_data: dict[str, np.ndarray]) -> np.ndarray:
    """
    Safely evaluate a math formula against channel data using AST parsing.
    Only allows math operations, no arbitrary code execution.
    """
    # Pre-process: spaces → underscores for channel names, ^ → **
    formula = _normalize_formula(formula, list(channel_data.keys()))

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
        ast.Compare, ast.Gt, ast.Lt, ast.GtE, ast.LtE, ast.Eq, ast.NotEq,
        ast.BoolOp, ast.And, ast.Or, ast.IfExp,
        # Expression contexts — harmless markers on Name/Attribute/Subscript.
        # `Load` is the only one we'll actually see here since we parse in
        # mode="eval"; Store/Del would require a stmt which eval mode rejects.
        ast.Load, ast.Store, ast.Del,
        # Tuple for slicing like x[a:b]
        ast.Tuple, ast.Slice,
    )
    if not isinstance(node, allowed_types):
        raise ValueError(f"Unsafe operation: {type(node).__name__}")
    # Disallow calls to anything that isn't a plain name we whitelist later.
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise ValueError("Only direct function calls are allowed")
        if node.func.id not in SAFE_FUNCTION_NAMES:
            raise ValueError(f"Function '{node.func.id}' is not allowed")
    # Prevent attribute drilling (e.g. ().__class__.__bases__…).
    if isinstance(node, ast.Attribute):
        raise ValueError("Attribute access is not allowed")
    for child in ast.iter_child_nodes(node):
        _validate_ast(child)


# ---------------------------------------------------------------------------
# Math channel presets (Phase 26.2)
# ---------------------------------------------------------------------------

MATH_PRESETS = [
    {
        "name": "UWA",
        "units": "ratio",
        "formula": "ABS(LAT_ACCEL) / (GPS_SPEED * GPS_SPEED / 400 + 0.001)",
        "description": (
            "Understeer Warning Angle — ratio of actual lateral acceleration "
            "to the cornering force expected from speed (v²/400). Values > 1 "
            "suggest over-grip / oversteer; values much below 1 suggest "
            "understeer. Pairs well with the 'in-corner' channels report "
            "filter."
        ),
    },
    {
        "name": "ThrottleSmoothed",
        "units": "%",
        "formula": "EMA(Throttle, 0.2)",
        "description": "Exponentially smoothed throttle. Useful when coaching "
                        "pedal consistency through long corners.",
    },
    {
        "name": "BrakeRolling",
        "units": "%",
        "formula": "ROLL_AVG(Brake, 5)",
        "description": "5-sample rolling average of brake pressure to see "
                        "sustained braking events without sample-level noise.",
    },
    {
        "name": "SpeedDerivative",
        "units": "m/s²",
        "formula": "(GPS_SPEED - TIME_SHIFT(GPS_SPEED, 100)) / 3.6 / 0.1",
        "description": "100ms finite-difference longitudinal acceleration "
                        "derived from GPS speed.",
    },
]


@router.get("/math-channels/presets")
async def list_math_presets():
    """Named math-channel templates the UI can offer in one click."""
    return MATH_PRESETS


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

    # Find referenced channels in formula (against the same normalized form
    # that _safe_eval_formula will compile, so a spaced channel name like
    # "GPS Speed" matches whether the LLM passed it with a space or an
    # underscore).
    formula_normalized = _normalize_formula(req.formula, all_channels)
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
        n_ts = len(tc)
        n_r = len(lap_result)
        if n_r != n_ts:
            # Pad or truncate to match. `diff` loses one sample at the front;
            # repeat the first to preserve alignment with the rest.
            if n_r == n_ts - 1:
                lap_result = np.concatenate([[lap_result[0]], lap_result]) if n_r else np.zeros(n_ts)
            elif n_r > n_ts:
                lap_result = lap_result[:n_ts]
            else:
                lap_result = np.concatenate([lap_result, np.zeros(n_ts - n_r)])

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


@router.post("/sessions/{session_id}/math-channels/{name}/recompute")
async def recompute_math_channel(session_id: str, name: str):
    """Re-evaluate an existing math channel's formula against the current
    session data. Useful after a filter-function tweak or when upstream
    data changed. Phase 18.6.
    """
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT formula, units FROM math_channels "
            "WHERE session_id = ? AND name = ?",
            (session_id, name),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, f"math channel '{name}' not found")
        formula = row["formula"]
        units = row["units"]
    finally:
        await db.close()

    # Reuse the create path's body by calling it with the same formula.
    # This re-evaluates and rewrites the cached arrow file.
    req = MathChannelRequest(name=name, formula=formula, units=units)
    return await create_math_channel(session_id, req)
