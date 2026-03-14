"""Post-run processing: speed check, benchmark, and submit best strategy.

Called after each model's Docker container finishes. Finds the best
snapshot that passes the speed check, benchmarks it against top opponents,
and submits to the leaderboard.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from agent_preflight.models import RunResult

from eject_policies import TOP5_OPPONENTS, _check_speed, _test_strategy


def snapshot_on_event(event: dict, context: dict) -> None:
    """Event callback: snapshot strategy.py on every write tool completion."""
    if event.get("type") != "tool_execution_end":
        return
    if event.get("toolName") != "write":
        return
    if "strategy.py" not in str(event.get("result", "")):
        return

    run_dir = context.get("run_dir")
    if not run_dir:
        return

    workspace = Path(run_dir) / "workspace"
    strategy_out = workspace / "strategy.py"
    if not strategy_out.exists() or strategy_out.stat().st_size <= 100:
        return

    content = strategy_out.read_text()
    if "decide_move" not in content:
        return

    tool_calls = context.get("tool_calls", 0)
    snap = workspace / f"snapshot_{tool_calls:03d}.py"
    snap.write_text(content)


def detect_test_on_event(event: dict, context: dict) -> None:
    """Event callback: detect when a model has run snake-arena test."""
    if event.get("type") != "tool_execution_end":
        return
    if event.get("toolName") != "bash":
        return
    result_text = str(event.get("result", ""))
    if any(x in result_text for x in ["win_rate=", "Summary:", "Queued benchmark"]):
        context["has_tested"] = True


def test_and_submit_best(
    run_dir: Path,
    result: RunResult,
    log_fn=print,
) -> None:
    """Speed-check, benchmark, and submit the best snapshot.

    Args:
        run_dir: The per-model run directory (contains workspace/).
        result: The RunResult from agent-preflight.
        log_fn: Logging function.
    """
    model_dir = run_dir / result.alias
    workspace = model_dir / "workspace"

    snapshots = sorted(workspace.glob("snapshot_*.py"))
    final = workspace / "strategy.py"
    candidates = list(snapshots)
    if final.exists() and final.stat().st_size > 100:
        candidates.append(final)

    if not candidates:
        log_fn("  No strategies to test.")
        return

    # Speed-check: discard slow candidates
    log_fn(f"  Speed-checking {len(candidates)} candidate(s)...")
    fast_candidates = []
    for path in candidates:
        avg_s = _check_speed(path)
        if avg_s is None:
            log_fn(f"    {path.name}: speed check failed -- skipping")
        elif avg_s > 0.8:
            log_fn(f"    {path.name}: TOO SLOW ({avg_s:.3f}s/call) -- skipping")
        else:
            log_fn(f"    {path.name}: {avg_s*1000:.0f}ms/call -- ok")
            fast_candidates.append(path)

    if not fast_candidates:
        log_fn("  All candidates too slow or broken -- nothing to submit.")
        return

    # Benchmark
    log_fn(f"  Benchmarking {len(fast_candidates)} fast candidate(s)...")
    best_path, best_wr = None, -1.0

    for path in fast_candidates:
        wr = _test_strategy(path)
        if wr is not None:
            log_fn(f"    {path.name}: {wr*100:.0f}% WR")
            if wr > best_wr:
                best_wr, best_path = wr, path
        else:
            log_fn(f"    {path.name}: test failed")

    if best_path and best_wr >= 0:
        log_fn(f"  Best: {best_path.name} ({best_wr*100:.0f}% WR) -- submitting as '{result.alias}'...")
        try:
            r = subprocess.run(
                ["snake-arena", "submit", str(best_path), "--game", "kurve",
                 "--name", result.alias, "--model", result.model_id],
                capture_output=True, text=True, timeout=300,
            )
            output = (r.stdout + r.stderr).strip()
            log_fn(f"  {output[:300]}")
        except subprocess.TimeoutExpired as e:
            partial = ""
            if e.stdout:
                partial += e.stdout if isinstance(e.stdout, str) else e.stdout.decode("utf-8", errors="replace")
            if "Submitted" in partial:
                log_fn("  Submitted (match results still playing out)")
            else:
                log_fn(f"  Submit timed out: {partial[:200]}")
        except Exception as e:
            log_fn(f"  Submit error: {e}")
    else:
        log_fn("  No testable strategy found -- nothing submitted.")
