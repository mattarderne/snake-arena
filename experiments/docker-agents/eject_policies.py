"""Domain-specific eject policies for snake-arena experiments.

These extend agent-preflight's base EjectPolicy with game-specific logic:
- NoTestEject: Kill models that spend budget without testing their strategy
- P25Eject: Kill models below the leaderboard 25th percentile at 25% budget
"""

from __future__ import annotations

import json
import re
import subprocess
import urllib.request
from pathlib import Path
from typing import Any

from agent_preflight.eject import EjectPolicy
from agent_preflight.models import EjectDecision

API_BASE = "https://arena-web-vinext.matt-15d.workers.dev"
TOP5_OPPONENTS = "v3-voronoi,deep-vortex-v6,skydiscover-v3,kurve-waller,deep-vortex-v3"


class NoTestEject(EjectPolicy):
    """Eject if the model hasn't run any tests after spending a fraction of budget.

    Detects tests by looking for "win_rate=", "Summary:", or "Queued benchmark"
    in bash tool output events.
    """

    def __init__(
        self,
        min_tool_calls: int = 25,
        budget_fraction: float = 0.20,
        min_budget_usd: float = 0.20,
    ) -> None:
        self.min_tool_calls = min_tool_calls
        self.budget_fraction = budget_fraction
        self.min_budget_usd = min_budget_usd

    def check(
        self,
        *,
        budget_status: Any,
        events: list[dict],
        context: dict,
        **_kwargs: Any,
    ) -> EjectDecision:
        if budget_status.limit < self.min_budget_usd:
            return EjectDecision(should_eject=False)

        tool_calls = context.get("tool_calls", 0)
        if tool_calls < self.min_tool_calls:
            return EjectDecision(should_eject=False)

        if budget_status.pct_spent < self.budget_fraction:
            return EjectDecision(should_eject=False)

        # Check if any test has been run
        has_tested = context.get("has_tested", False)
        if not has_tested:
            for event in events:
                if event.get("type") == "tool_execution_end":
                    result_text = str(event.get("result", ""))
                    if event.get("toolName") == "bash" and any(
                        x in result_text
                        for x in ["win_rate=", "Summary:", "Queued benchmark"]
                    ):
                        has_tested = True
                        context["has_tested"] = True
                        break

        if not has_tested:
            return EjectDecision(
                should_eject=True,
                reason=(
                    f"no test after {tool_calls} tool calls and "
                    f"${budget_status.used:.3f} spent "
                    f"({budget_status.pct_spent*100:.0f}% of budget)"
                ),
            )
        return EjectDecision(should_eject=False)


class P25Eject(EjectPolicy):
    """Eject if the model's best strategy is below leaderboard P25 at 25% budget spent.

    Pauses the container, speed-checks + benchmarks the best snapshot, then
    compares against the P25 win rate derived from leaderboard ELO scores.
    Fires only once.
    """

    def __init__(
        self,
        budget_fraction: float = 0.25,
        min_budget_usd: float = 0.20,
    ) -> None:
        self.budget_fraction = budget_fraction
        self.min_budget_usd = min_budget_usd
        self._fired = False

    def check(
        self,
        *,
        budget_status: Any,
        context: dict,
        **_kwargs: Any,
    ) -> EjectDecision:
        if self._fired:
            return EjectDecision(should_eject=False)
        if budget_status.limit < self.min_budget_usd:
            return EjectDecision(should_eject=False)
        if budget_status.pct_spent < self.budget_fraction:
            return EjectDecision(should_eject=False)

        self._fired = True

        run_dir = context.get("run_dir")
        container_name = context.get("container_name")
        if not run_dir or not container_name:
            return EjectDecision(should_eject=False)

        best_snap = _best_fast_snapshot(Path(run_dir))
        if not best_snap:
            return EjectDecision(should_eject=False)

        # Pause container while benchmarking
        subprocess.run(["docker", "pause", container_name], capture_output=True)
        try:
            wr = _test_strategy(best_snap)
            threshold = _fetch_leaderboard_p25_wr()

            if wr is not None and wr < threshold:
                return EjectDecision(
                    should_eject=True,
                    reason=(
                        f"below P25 ({wr*100:.0f}% < {threshold*100:.0f}%) "
                        f"after {budget_status.pct_spent*100:.0f}% budget spent"
                    ),
                )
        finally:
            subprocess.run(["docker", "unpause", container_name], capture_output=True)

        return EjectDecision(should_eject=False)


# ---------------------------------------------------------------------------
# Helpers (extracted from run_experiment_v2.py)
# ---------------------------------------------------------------------------

_SPEED_CHECK_SCRIPT = """
import time, sys
import importlib.util
spec = importlib.util.spec_from_file_location("strategy", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
data = {
    "you": {"id": "0", "position": {"x": 320.0, "y": 240.0}, "direction": 45.0, "speed": 3.0, "alive": True},
    "opponent": {"id": "1", "position": {"x": 100.0, "y": 100.0}, "direction": 90.0, "speed": 3.0, "alive": True},
    "board": {"width": 640, "height": 480, "trails": {"0": [[320,240],[319,239]], "1": [[100,100]]}},
}
N = 10
t0 = time.time()
for _ in range(N):
    mod.decide_move(data)
elapsed = (time.time() - t0) / N
print(f"{elapsed:.4f}")
"""


def _check_speed(path: Path, limit_s: float = 0.8) -> float | None:
    """Return avg seconds per decide_move call, or None if check fails."""
    try:
        r = subprocess.run(
            ["python3", "-c", _SPEED_CHECK_SCRIPT, str(path)],
            capture_output=True, text=True, timeout=30,
        )
        out = r.stdout.strip()
        if out:
            return float(out)
    except Exception:
        pass
    return None


def _test_strategy(path: Path) -> float | None:
    """Run snake-arena quick test. Returns win rate [0..1] or None."""
    try:
        result = subprocess.run(
            ["snake-arena", "test", str(path), "--game", "kurve",
             "--quick", "--vs", TOP5_OPPONENTS],
            capture_output=True, text=True, timeout=120,
        )
        output = result.stdout + result.stderr
        m = re.search(r"win_rate=([\d.]+)%", output)
        if m:
            return float(m.group(1)) / 100.0
        m = re.search(r"win_rate=([\d.]+)", output)
        if m:
            v = float(m.group(1))
            return v / 100.0 if v > 1.0 else v
        m = re.search(r"(\d+)W-(\d+)L", output)
        if m:
            w, l = int(m.group(1)), int(m.group(2))
            return w / (w + l) if (w + l) > 0 else 0.0
    except Exception:
        pass
    return None


def _fetch_leaderboard_p25_wr() -> float:
    """Fetch leaderboard P25 win rate. Falls back to 0.25."""
    try:
        req = urllib.request.Request(
            f"{API_BASE}/api/leaderboard?game=kurve",
            headers={"User-Agent": "snake-arena-harness/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        entries = data.get("strategies", data) if isinstance(data, dict) else data
        elos = sorted(float(e.get("elo", 1000)) for e in entries if e.get("elo"))
        if len(elos) < 4:
            return 0.25
        p25_elo = elos[len(elos) // 4]
        median_elo = elos[len(elos) // 2]
        wr = 1.0 / (1.0 + 10 ** ((median_elo - p25_elo) / 400.0))
        return round(wr, 3)
    except Exception:
        return 0.25


def _best_fast_snapshot(run_dir: Path) -> Path | None:
    """Return the fastest-passing snapshot with decide_move, or None."""
    workspace = run_dir / "workspace" if (run_dir / "workspace").exists() else run_dir
    snapshots = sorted(workspace.glob("snapshot_*.py"))
    final = workspace / "strategy.py"
    candidates = list(snapshots)
    if final.exists() and final.stat().st_size > 100:
        candidates.append(final)
    for path in reversed(candidates):
        speed = _check_speed(path)
        if speed is not None and speed <= 0.8:
            return path
    return None
