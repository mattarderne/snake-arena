"""
Local Battlesnake game engine for testing strategies.

Simulates the standard Battlesnake rules:
- 11x11 board, (0,0) = bottom-left
- Health starts at 100, decreases by 1 per turn
- Eating food restores health to 100 and grows the snake
- Death on wall collision, body collision, or head-to-head with longer/equal snake
- Last snake alive wins
"""

import random
import copy
import json
from typing import Callable


MoveFunc = Callable[[dict], str]

DIRECTIONS = {
    "up": (0, 1),
    "down": (0, -1),
    "left": (-1, 0),
    "right": (1, 0),
}


def create_snake(snake_id: str, start_x: int, start_y: int) -> dict:
    """Create a new snake at the given position."""
    head = {"x": start_x, "y": start_y}
    return {
        "id": snake_id,
        "name": snake_id,
        "head": copy.deepcopy(head),
        "body": [copy.deepcopy(head), copy.deepcopy(head), copy.deepcopy(head)],
        "health": 100,
        "length": 3,
        "shout": "",
    }


def spawn_food(board: dict, count: int = 1) -> None:
    """Spawn food on unoccupied squares."""
    w, h = board["width"], board["height"]
    occupied = set()
    for snake in board["snakes"]:
        for seg in snake["body"]:
            occupied.add((seg["x"], seg["y"]))
    for f in board["food"]:
        occupied.add((f["x"], f["y"]))

    free = [(x, y) for x in range(w) for y in range(h) if (x, y) not in occupied]
    for _ in range(min(count, len(free))):
        if not free:
            break
        pos = random.choice(free)
        free.remove(pos)
        board["food"].append({"x": pos[0], "y": pos[1]})


def make_game_state(board: dict, snake: dict, turn: int) -> dict:
    """Build the game state dict that gets passed to decide_move."""
    return {
        "game": {"id": "local-test", "timeout": 500},
        "turn": turn,
        "you": copy.deepcopy(snake),
        "board": copy.deepcopy(board),
    }


def run_game(
    strategies: dict[str, MoveFunc],
    width: int = 11,
    height: int = 11,
    max_turns: int = 500,
    seed: int | None = None,
    food_spawn_chance: float = 0.15,
    initial_food: int = 1,
    verbose: bool = False,
) -> dict:
    """
    Run a full Battlesnake game.

    Args:
        strategies: dict mapping snake_id -> decide_move function
        width, height: board dimensions
        max_turns: turn limit
        seed: random seed for reproducibility
        food_spawn_chance: probability of spawning food each turn
        initial_food: number of food to spawn at start
        verbose: print turn-by-turn state

    Returns:
        dict with winner, turns, death_reasons, turn_log
    """
    if seed is not None:
        random.seed(seed)

    snake_ids = list(strategies.keys())

    # Spawn snakes in standard positions
    spawn_points = [
        (1, 1), (width - 2, height - 2),
        (1, height - 2), (width - 2, 1),
        (width // 2, 1), (width // 2, height - 2),
        (1, height // 2), (width - 2, height // 2),
    ]

    board = {
        "width": width,
        "height": height,
        "snakes": [],
        "food": [],
        "hazards": [],
    }

    for i, sid in enumerate(snake_ids):
        sp = spawn_points[i % len(spawn_points)]
        board["snakes"].append(create_snake(sid, sp[0], sp[1]))

    # Spawn initial food (center + random)
    board["food"].append({"x": width // 2, "y": height // 2})
    spawn_food(board, initial_food)

    death_reasons = {}
    turn_log = []

    for turn in range(max_turns):
        alive_snakes = [s for s in board["snakes"] if s["id"] not in death_reasons]

        if len(alive_snakes) <= 1:
            break

        # Collect moves
        moves = {}
        for snake in alive_snakes:
            state = make_game_state(board, snake, turn)
            try:
                move = strategies[snake["id"]](state)
                if move not in DIRECTIONS:
                    move = "up"
            except Exception as e:
                if verbose:
                    print(f"  [{snake['id']}] error: {e}")
                move = "up"
            moves[snake["id"]] = move

        if verbose:
            print(f"Turn {turn}: {moves}")

        # Apply moves - update head positions
        for snake in alive_snakes:
            move = moves[snake["id"]]
            dx, dy = DIRECTIONS[move]
            new_head = {"x": snake["head"]["x"] + dx, "y": snake["head"]["y"] + dy}
            snake["body"].insert(0, new_head)
            snake["head"] = copy.deepcopy(new_head)
            snake["health"] -= 1

        # Check food consumption
        eaten = set()
        for snake in alive_snakes:
            hx, hy = snake["head"]["x"], snake["head"]["y"]
            for i, f in enumerate(board["food"]):
                if f["x"] == hx and f["y"] == hy:
                    snake["health"] = 100
                    snake["length"] += 1
                    eaten.add(i)
                    break
            else:
                # Remove tail if didn't eat
                snake["body"].pop()

        # Remove eaten food
        board["food"] = [f for i, f in enumerate(board["food"]) if i not in eaten]

        # Check deaths
        # 1. Out of bounds
        for snake in alive_snakes:
            hx, hy = snake["head"]["x"], snake["head"]["y"]
            if not (0 <= hx < width and 0 <= hy < height):
                death_reasons[snake["id"]] = f"wall collision (turn {turn})"

        # 2. Starvation
        for snake in alive_snakes:
            if snake["health"] <= 0:
                death_reasons[snake["id"]] = f"starvation (turn {turn})"

        # 3. Body collisions (hit any snake's body, not head)
        for snake in alive_snakes:
            if snake["id"] in death_reasons:
                continue
            hx, hy = snake["head"]["x"], snake["head"]["y"]
            for other in alive_snakes:
                # Check body segments (skip head at index 0)
                for seg in other["body"][1:]:
                    if seg["x"] == hx and seg["y"] == hy:
                        death_reasons[snake["id"]] = f"body collision with {other['id']} (turn {turn})"
                        break
                if snake["id"] in death_reasons:
                    break

        # 4. Head-to-head collisions
        head_positions = {}
        for snake in alive_snakes:
            if snake["id"] in death_reasons:
                continue
            pos = (snake["head"]["x"], snake["head"]["y"])
            head_positions.setdefault(pos, []).append(snake)

        for pos, snakes_at_pos in head_positions.items():
            if len(snakes_at_pos) > 1:
                max_len = max(s["length"] for s in snakes_at_pos)
                for snake in snakes_at_pos:
                    if snake["length"] < max_len:
                        death_reasons[snake["id"]] = f"head-to-head loss vs longer snake (turn {turn})"
                # If all same length, all die
                same_len = [s for s in snakes_at_pos if s["length"] == max_len]
                if len(same_len) > 1:
                    for snake in same_len:
                        death_reasons[snake["id"]] = f"head-to-head tie (turn {turn})"

        # Remove dead snakes from board
        board["snakes"] = [s for s in board["snakes"] if s["id"] not in death_reasons]

        # Spawn food
        if eaten or random.random() < food_spawn_chance:
            spawn_food(board, 1)

        # Log turn
        turn_log.append({
            "turn": turn,
            "moves": dict(moves),
            "alive": [s["id"] for s in board["snakes"]],
            "deaths": {k: v for k, v in death_reasons.items() if f"turn {turn}" in v},
        })

    # Determine winner
    alive = [s for s in board["snakes"] if s["id"] not in death_reasons]
    if len(alive) == 1:
        winner = alive[0]["id"]
    elif len(alive) > 1:
        # Longest snake wins on timeout
        winner = max(alive, key=lambda s: s["length"])["id"]
    else:
        winner = None  # All dead

    final_turn = turn_log[-1]["turn"] if turn_log else 0
    return {
        "winner": winner,
        "turns": final_turn + 1,
        "death_reasons": death_reasons,
        "turn_log": turn_log,
        "final_snakes": {s["id"]: {"length": s["length"], "health": s["health"]} for s in board["snakes"]},
    }


def run_match(
    strategies: dict[str, MoveFunc],
    games: int = 5,
    seed_base: int | None = None,
    verbose: bool = False,
    **kwargs,
) -> dict:
    """
    Run a best-of-N match between strategies.

    Returns dict with per-strategy win counts, game results, and match winner.
    """
    wins = {sid: 0 for sid in strategies}
    results = []

    for i in range(games):
        seed = (seed_base + i) if seed_base is not None else None
        result = run_game(strategies, seed=seed, verbose=verbose, **kwargs)
        results.append(result)
        if result["winner"]:
            wins[result["winner"]] = wins.get(result["winner"], 0) + 1

    match_winner = max(wins, key=wins.get) if any(wins.values()) else None
    return {
        "match_winner": match_winner,
        "wins": wins,
        "games": results,
        "total_games": games,
    }
