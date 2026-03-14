#!/usr/bin/env python3
"""
Compare agent performance across budget tiers.

Usage:
    python3 analyze_budget_tiers.py .runs/pi-docker-BASELINE .runs/pi-docker-010 .runs/pi-docker-005
    python3 analyze_budget_tiers.py .runs/pi-docker-*   # auto-detect budget from summaries
"""
import json, sys, re
from pathlib import Path
from collections import defaultdict


def load_run(run_dir: Path) -> dict:
    """Extract per-model metrics from a completed run directory."""
    models = {}
    for alias_dir in sorted(run_dir.iterdir()):
        if not alias_dir.is_dir():
            continue
        alias = alias_dir.name
        summary_path = alias_dir / "summary.json"
        events_path = alias_dir / "events.jsonl"
        if not summary_path.exists():
            continue

        summary = json.loads(summary_path.read_text())
        budget_limit = None
        cost = summary.get("cost", {})
        measured = cost.get("measured_usd") or cost.get("estimated_usd", 0)

        # Try to get budget limit from AGENTS.md in the run
        agents_md = alias_dir / "AGENTS.md"
        if agents_md.exists():
            m = re.search(r"Budget:\s*\$([0-9.]+)", agents_md.read_text())
            if m:
                budget_limit = float(m.group(1))

        # Parse events for behavioral metrics
        strategy_writes = 0
        quick_tests = 0
        full_tests = 0
        budget_reads = 0
        total_tool_calls = 0
        first_test_offset = None
        start_ts = None

        if events_path.exists():
            for line in events_path.read_text().splitlines():
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue

                ts = e.get("ts") or e.get("timestamp")
                if start_ts is None and ts:
                    start_ts = ts

                if e.get("type") == "tool_execution_start":
                    total_tool_calls += 1
                    tool = e.get("toolName", "")
                    args = e.get("args", {})

                    if tool == "write":
                        path = args.get("filePath", "") or args.get("path", "")
                        if "strategy.py" in path:
                            strategy_writes += 1

                    if tool == "bash":
                        cmd = args.get("command", "")
                        if "snake-arena test" in cmd or "snake-arena  test" in cmd:
                            if "--quick" in cmd:
                                quick_tests += 1
                            else:
                                full_tests += 1
                            if first_test_offset is None and ts and start_ts:
                                first_test_offset = ts - start_ts

                    if tool == "read":
                        path = args.get("filePath", "") or args.get("path", "")
                        if "budget" in path.lower():
                            budget_reads += 1

                if e.get("type") == "tool_execution_end":
                    tool = e.get("toolName", "")
                    if tool == "bash":
                        result_text = ""
                        for block in e.get("result", {}).get("content", []):
                            if isinstance(block, dict):
                                result_text += block.get("text", "")
                        if "budget" in result_text.lower() and "remaining" in result_text.lower():
                            budget_reads += 1

        # Win rate from summary
        win_rate = summary.get("win_rate")
        if win_rate is None:
            bench = summary.get("benchmark", {})
            wins = bench.get("wins", 0)
            total = bench.get("total", 0)
            win_rate = (wins / total * 100) if total > 0 else None

        models[alias] = {
            "budget_limit": budget_limit,
            "cost": measured,
            "utilization": (measured / budget_limit * 100) if budget_limit and measured else None,
            "win_rate": win_rate,
            "quality_per_dollar": (win_rate / measured) if win_rate and measured else None,
            "strategy_writes": strategy_writes,
            "quick_tests": quick_tests,
            "full_tests": full_tests,
            "budget_reads": budget_reads,
            "total_tool_calls": total_tool_calls,
            "first_test_offset_s": first_test_offset,
            "duration_s": summary.get("duration_s"),
        }

    return models


def print_comparison(runs: list[tuple[str, dict]]):
    """Print side-by-side comparison table."""
    # Collect all model aliases
    all_aliases = sorted(set(a for _, models in runs for a in models))

    # Header
    print(f"\n{'='*90}")
    print("BUDGET TIER COMPARISON")
    print(f"{'='*90}")

    for alias in all_aliases:
        print(f"\n--- {alias} ---")
        print(f"  {'Tier':<12} {'Budget':>7} {'Cost':>7} {'Util%':>6} {'WinR%':>6} "
              f"{'Q/$ ':>7} {'Writes':>6} {'Tests':>6} {'BudRd':>5} {'Calls':>5}")

        for run_name, models in runs:
            m = models.get(alias)
            if not m:
                print(f"  {run_name:<12} {'—':>7}")
                continue

            budget = f"${m['budget_limit']:.2f}" if m['budget_limit'] else "?"
            cost = f"${m['cost']:.3f}" if m['cost'] else "—"
            util = f"{m['utilization']:.0f}" if m['utilization'] else "—"
            wr = f"{m['win_rate']:.1f}" if m['win_rate'] is not None else "—"
            qpd = f"{m['quality_per_dollar']:.0f}" if m['quality_per_dollar'] else "—"
            tests = m['quick_tests'] + m['full_tests']

            print(f"  {run_name:<12} {budget:>7} {cost:>7} {util:>6} {wr:>6} "
                  f"{qpd:>7} {m['strategy_writes']:>6} {tests:>6} {m['budget_reads']:>5} {m['total_tool_calls']:>5}")

    # Summary: average quality/dollar per tier
    print(f"\n{'='*90}")
    print("TIER AVERAGES")
    print(f"{'='*90}")
    print(f"  {'Tier':<12} {'Avg WinR%':>10} {'Avg Cost':>10} {'Avg Q/$':>10} {'Avg Util%':>10}")

    for run_name, models in runs:
        wrs = [m['win_rate'] for m in models.values() if m['win_rate'] is not None]
        costs = [m['cost'] for m in models.values() if m['cost']]
        qpds = [m['quality_per_dollar'] for m in models.values() if m['quality_per_dollar']]
        utils = [m['utilization'] for m in models.values() if m['utilization'] is not None]

        avg_wr = f"{sum(wrs)/len(wrs):.1f}" if wrs else "—"
        avg_cost = f"${sum(costs)/len(costs):.3f}" if costs else "—"
        avg_qpd = f"{sum(qpds)/len(qpds):.0f}" if qpds else "—"
        avg_util = f"{sum(utils)/len(utils):.0f}" if utils else "—"

        print(f"  {run_name:<12} {avg_wr:>10} {avg_cost:>10} {avg_qpd:>10} {avg_util:>10}")

    print()


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 analyze_budget_tiers.py <run_dir> [run_dir2] ...")
        print("       python3 analyze_budget_tiers.py .runs/pi-docker-*")
        sys.exit(1)

    runs = []
    for arg in sys.argv[1:]:
        p = Path(arg)
        if not p.is_dir():
            print(f"Skipping {arg} (not a directory)")
            continue
        models = load_run(p)
        if not models:
            print(f"Skipping {arg} (no model results found)")
            continue
        # Infer tier label from budget limits
        budgets = [m['budget_limit'] for m in models.values() if m['budget_limit']]
        if budgets:
            label = f"${budgets[0]:.2f}"
        else:
            label = p.name[-6:]  # fallback to timestamp suffix
        runs.append((label, models))

    if not runs:
        print("No valid runs found.")
        sys.exit(1)

    # Sort by budget tier descending
    runs.sort(key=lambda r: next(
        (m['budget_limit'] for m in r[1].values() if m['budget_limit']), 0
    ), reverse=True)

    print_comparison(runs)


if __name__ == "__main__":
    main()
