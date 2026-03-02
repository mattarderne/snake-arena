#!/usr/bin/env python3
"""
Test harness runner - pit your Qwen strategy against the top 3 opponents.

Supports both Battlesnake and Kurve games.

Usage:
    # Kurve (default)
    python harness/run_tests.py                                # Kurve, best-of-5
    python harness/run_tests.py --game kurve --games 10        # Kurve, best-of-10
    python harness/run_tests.py --opponent trail-dodger        # Single opponent

    # Battlesnake
    python harness/run_tests.py --game battlesnake             # Battlesnake, best-of-5
    python harness/run_tests.py --game battlesnake --opponent aggressive-hunter

    # Common options
    python harness/run_tests.py --verbose                      # Turn-by-turn output
    python harness/run_tests.py --seed 42                      # Reproducible games
    python harness/run_tests.py --heuristic-only               # Skip MLX model
    python harness/run_tests.py --1v1v1v1                      # Free-for-all
"""

import argparse
import sys
import os
import time

# Add harness dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


# ── Game configs ──────────────────────────────────────────────────

GAME_CONFIGS = {
    "kurve": {
        "label": "Kurve (Achtung die Kurve)",
        "engine_module": "kurve_engine",
        "opponents_module": "kurve_opponents",
        "opponents_attr": "KURVE_TOP_STRATEGIES",
        "strategy_module": "qwen_kurve_strategy",
        "submit_file": "harness/kurve_submit_strategy.py",
        "submit_flag": "--game kurve",
    },
    "battlesnake": {
        "label": "Battlesnake",
        "engine_module": "engine",
        "opponents_module": "opponents",
        "opponents_attr": "TOP_STRATEGIES",
        "strategy_module": "qwen_strategy",
        "submit_file": "harness/submit_strategy.py",
        "submit_flag": "",
    },
}


def load_game(game_name: str):
    """Dynamically load engine, opponents, and strategy for a game."""
    import importlib
    cfg = GAME_CONFIGS[game_name]

    engine = importlib.import_module(cfg["engine_module"])
    opponents_mod = importlib.import_module(cfg["opponents_module"])
    strategy_mod = importlib.import_module(cfg["strategy_module"])

    opponents = getattr(opponents_mod, cfg["opponents_attr"])
    qwen_move = strategy_mod.decide_move
    heuristic = strategy_mod._heuristic_fallback

    return engine, opponents, qwen_move, heuristic


# ── Display helpers ───────────────────────────────────────────────

def print_banner(game_name: str):
    cfg = GAME_CONFIGS[game_name]
    print("=" * 65)
    print(f"  SNAKE ARENA - Qwen 3.5 35B (A3B) Test Harness")
    print(f"  Game: {cfg['label']}")
    print(f"  Model: mlx-community/qwen3.5-35b-a3b")
    print("=" * 65)
    print()


def print_match_result(opponent_name: str, result: dict, qwen_id: str):
    qwen_wins = result["wins"].get(qwen_id, 0)
    opp_wins = result["wins"].get(opponent_name, 0)
    total = result["total_games"]

    if qwen_wins > opp_wins:
        status, color = "WIN", "\033[92m"
    elif qwen_wins < opp_wins:
        status, color = "LOSS", "\033[91m"
    else:
        status, color = "DRAW", "\033[93m"
    reset = "\033[0m"

    print(f"\n  vs {opponent_name}")
    print(f"  {color}{status}{reset}  Qwen {qwen_wins} - {opp_wins} {opponent_name}  ({total} games)")

    for i, game in enumerate(result["games"]):
        winner = game["winner"] or "draw"
        turns = game["turns"]
        deaths = game.get("death_reasons", {})
        death_info = "".join(f" [{sid}: {reason}]" for sid, reason in deaths.items())
        print(f"    Game {i+1}: winner={winner:20s} turns={turns:4d}{death_info}")

    return qwen_wins, opp_wins


def run_ffa(engine, strategies: dict, games: int, seed_base, verbose: bool):
    print("\n" + "-" * 65)
    print("  FREE-FOR-ALL: All strategies battle simultaneously")
    print("-" * 65)

    wins = {sid: 0 for sid in strategies}

    for i in range(games):
        seed = (seed_base + i) if seed_base is not None else None
        result = engine.run_game(strategies, seed=seed, verbose=verbose)
        if result["winner"]:
            wins[result["winner"]] += 1
        w = result["winner"] or "none"
        print(f"  Game {i+1}: winner={w:20s}  turns={result['turns']:4d}")
        for sid, reason in result["death_reasons"].items():
            print(f"           {sid}: {reason}")

    print(f"\n  FFA Results ({games} games):")
    ranked = sorted(wins.items(), key=lambda x: -x[1])
    for rank, (sid, w) in enumerate(ranked, 1):
        pct = w / games * 100
        bar = "#" * int(pct / 5)
        print(f"    {rank}. {sid:20s}  {w:2d} wins ({pct:5.1f}%)  {bar}")


# ── Main ──────────────────────────────────────────────────────────

def main():
    # Build choices from all games
    all_opponents = []
    for cfg in GAME_CONFIGS.values():
        import importlib
        try:
            mod = importlib.import_module(cfg["opponents_module"])
            all_opponents.extend(getattr(mod, cfg["opponents_attr"]).keys())
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="Qwen Test Harness (Battlesnake + Kurve)")
    parser.add_argument("--game", type=str, default="kurve",
                        choices=list(GAME_CONFIGS.keys()),
                        help="Game to test (default: kurve)")
    parser.add_argument("--games", type=int, default=5, help="Games per match (default: 5)")
    parser.add_argument("--opponent", type=str, default=None,
                        help="Test against a single opponent")
    parser.add_argument("--verbose", "-v", action="store_true", help="Turn-by-turn output")
    parser.add_argument("--seed", type=int, default=None, help="Random seed")
    parser.add_argument("--heuristic-only", action="store_true",
                        help="Use heuristic fallback instead of MLX model")
    parser.add_argument("--1v1v1v1", dest="ffa", action="store_true",
                        help="Free-for-all with all strategies")
    args = parser.parse_args()

    game_name = args.game
    cfg = GAME_CONFIGS[game_name]

    print_banner(game_name)

    # Load game components
    engine, opponents, qwen_move, heuristic = load_game(game_name)

    # Validate opponent choice
    if args.opponent and args.opponent not in opponents:
        print(f"  ERROR: Unknown opponent '{args.opponent}' for {game_name}")
        print(f"  Available: {', '.join(opponents.keys())}")
        sys.exit(1)

    # Select strategy
    if args.heuristic_only:
        print("  Mode: Heuristic fallback (no MLX)")
        strategy_fn = heuristic
    else:
        print("  Mode: MLX Qwen 3.5 35B (A3B)")
        print("  Loading model on first game...")
        strategy_fn = qwen_move

    qwen_id = "qwen-3.5-35b"

    # Select opponents
    if args.opponent:
        opp_dict = {args.opponent: opponents[args.opponent]}
    else:
        opp_dict = dict(opponents)

    print(f"  Games per match: {args.games}")
    print(f"  Opponents: {', '.join(opp_dict.keys())}")
    if args.seed is not None:
        print(f"  Seed: {args.seed}")
    print()

    # FFA mode
    if args.ffa:
        all_strats = {qwen_id: strategy_fn}
        all_strats.update(opp_dict)
        run_ffa(engine, all_strats, args.games, args.seed, args.verbose)
        return

    # 1v1 matches
    total_qwen_wins = 0
    total_opp_wins = 0
    match_results = {}

    for opp_name, opp_fn in opp_dict.items():
        strategies = {qwen_id: strategy_fn, opp_name: opp_fn}

        print(f"\n{'─' * 65}")
        print(f"  Match: {qwen_id} vs {opp_name}")
        print(f"{'─' * 65}")

        start = time.time()
        result = engine.run_match(
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
        flag = f" {cfg['submit_flag']}" if cfg['submit_flag'] else ""
        print(f"  Run: npx snake-arena submit {cfg['submit_file']} --model qwen3.5-35b-a3b --name qwen-a3b{flag}")
    elif win_rate >= 0.4:
        print("  Recommendation: Strategy needs tuning. Adjust the prompt or heuristic weights.")
    else:
        print("  Recommendation: Strategy needs significant improvement.")
        print("  Try adjusting the LLM prompt or improving the heuristic fallback.")
    print()


if __name__ == "__main__":
    main()
