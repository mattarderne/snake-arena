#!/usr/bin/env python3
"""
Test harness runner - pit your Qwen strategy against the top 3 opponents.

Usage:
    python harness/run_tests.py                    # Run all matchups (best-of-5)
    python harness/run_tests.py --games 10         # Best-of-10
    python harness/run_tests.py --opponent aggressive-hunter  # Single opponent
    python harness/run_tests.py --verbose          # Show turn-by-turn
    python harness/run_tests.py --seed 42          # Reproducible games
    python harness/run_tests.py --heuristic-only   # Skip MLX, use fallback
    python harness/run_tests.py --1v1v1v1          # Free-for-all (all 4 snakes)
"""

import argparse
import sys
import os
import time

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine import run_match, run_game
from opponents import TOP_STRATEGIES, aggressive_hunter, space_controller, survivor_pro
from qwen_strategy import decide_move as qwen_move, _heuristic_fallback


def print_banner():
    print("=" * 65)
    print("  SNAKE ARENA - Qwen 3.5 35B (A3B) Test Harness")
    print("  Model: mlx-community/qwen3.5-35b-a3b")
    print("=" * 65)
    print()


def print_match_result(opponent_name: str, result: dict, qwen_id: str):
    """Pretty-print match results."""
    qwen_wins = result["wins"].get(qwen_id, 0)
    opp_wins = result["wins"].get(opponent_name, 0)
    total = result["total_games"]

    # Win/loss indicator
    if qwen_wins > opp_wins:
        status = "WIN"
        color = "\033[92m"  # green
    elif qwen_wins < opp_wins:
        status = "LOSS"
        color = "\033[91m"  # red
    else:
        status = "DRAW"
        color = "\033[93m"  # yellow
    reset = "\033[0m"

    print(f"\n  vs {opponent_name}")
    print(f"  {color}{status}{reset}  Qwen {qwen_wins} - {opp_wins} {opponent_name}  ({total} games)")

    # Per-game details
    for i, game in enumerate(result["games"]):
        winner = game["winner"] or "draw"
        turns = game["turns"]
        deaths = game.get("death_reasons", {})
        death_info = ""
        for sid, reason in deaths.items():
            death_info += f" [{sid}: {reason}]"
        w_marker = "*" if winner == qwen_id else " "
        print(f"    Game {i+1}: winner={winner:20s} turns={turns:3d}{death_info}")

    return qwen_wins, opp_wins


def run_ffa(strategies: dict, games: int, seed_base: int | None, verbose: bool):
    """Run free-for-all games with all strategies."""
    print("\n" + "-" * 65)
    print("  FREE-FOR-ALL: All strategies battle simultaneously")
    print("-" * 65)

    wins = {sid: 0 for sid in strategies}

    for i in range(games):
        seed = (seed_base + i) if seed_base is not None else None
        result = run_game(strategies, seed=seed, verbose=verbose)
        if result["winner"]:
            wins[result["winner"]] += 1
        w = result["winner"] or "none"
        print(f"  Game {i+1}: winner={w:20s}  turns={result['turns']:3d}")
        for sid, reason in result["death_reasons"].items():
            print(f"           {sid}: {reason}")

    print(f"\n  FFA Results ({games} games):")
    ranked = sorted(wins.items(), key=lambda x: -x[1])
    for rank, (sid, w) in enumerate(ranked, 1):
        pct = w / games * 100
        bar = "#" * int(pct / 5)
        print(f"    {rank}. {sid:20s}  {w:2d} wins ({pct:5.1f}%)  {bar}")


def main():
    parser = argparse.ArgumentParser(description="Qwen Battlesnake Test Harness")
    parser.add_argument("--games", type=int, default=5, help="Games per match (default: 5)")
    parser.add_argument("--opponent", type=str, default=None,
                        choices=list(TOP_STRATEGIES.keys()),
                        help="Test against a single opponent")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show turn-by-turn output")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility")
    parser.add_argument("--heuristic-only", action="store_true",
                        help="Use heuristic fallback instead of MLX model")
    parser.add_argument("--1v1v1v1", dest="ffa", action="store_true",
                        help="Run free-for-all with all strategies")
    args = parser.parse_args()

    print_banner()

    # Select strategy
    if args.heuristic_only:
        print("  Mode: Heuristic fallback (no MLX)")
        strategy_fn = _heuristic_fallback
    else:
        print("  Mode: MLX Qwen 3.5 35B (A3B)")
        print("  Loading model on first game...")
        strategy_fn = qwen_move

    qwen_id = "qwen-3.5-35b"

    # Select opponents
    if args.opponent:
        opponents = {args.opponent: TOP_STRATEGIES[args.opponent]}
    else:
        opponents = dict(TOP_STRATEGIES)

    print(f"  Games per match: {args.games}")
    print(f"  Opponents: {', '.join(opponents.keys())}")
    if args.seed is not None:
        print(f"  Seed: {args.seed}")
    print()

    # FFA mode
    if args.ffa:
        all_strats = {qwen_id: strategy_fn}
        all_strats.update(opponents)
        run_ffa(all_strats, args.games, args.seed, args.verbose)
        return

    # 1v1 matches
    total_qwen_wins = 0
    total_opp_wins = 0
    match_results = {}

    for opp_name, opp_fn in opponents.items():
        strategies = {
            qwen_id: strategy_fn,
            opp_name: opp_fn,
        }

        print(f"\n{'─' * 65}")
        print(f"  Match: {qwen_id} vs {opp_name}")
        print(f"{'─' * 65}")

        start = time.time()
        result = run_match(
            strategies,
            games=args.games,
            seed_base=args.seed,
            verbose=args.verbose,
        )
        elapsed = time.time() - start

        qw, ow = print_match_result(opp_name, result, qwen_id)
        total_qwen_wins += qw
        total_opp_wins += ow
        match_results[opp_name] = result
        print(f"  Time: {elapsed:.1f}s")

    # Summary
    total_games = total_qwen_wins + total_opp_wins
    print(f"\n{'=' * 65}")
    print(f"  OVERALL RESULTS")
    print(f"{'=' * 65}")
    print(f"  Qwen wins: {total_qwen_wins}/{total_games}  ({total_qwen_wins/max(total_games,1)*100:.1f}%)")

    for opp_name, result in match_results.items():
        qw = result["wins"].get(qwen_id, 0)
        ow = result["wins"].get(opp_name, 0)
        if qw > ow:
            s = "\033[92mWIN\033[0m"
        elif qw < ow:
            s = "\033[91mLOSS\033[0m"
        else:
            s = "\033[93mDRAW\033[0m"
        print(f"    vs {opp_name:20s}: {s}  ({qw}-{ow})")

    # Recommendation
    win_rate = total_qwen_wins / max(total_games, 1)
    print()
    if win_rate >= 0.7:
        print("  Recommendation: Strategy is competitive! Consider submitting.")
        print("  Run: npx snake-arena submit harness/qwen_strategy.py --model qwen3.5-35b-a3b --name qwen-a3b")
    elif win_rate >= 0.4:
        print("  Recommendation: Strategy needs tuning. Adjust the prompt or heuristic weights.")
    else:
        print("  Recommendation: Strategy needs significant improvement.")
        print("  Try adjusting the LLM prompt or improving the heuristic fallback.")
    print()


if __name__ == "__main__":
    main()
