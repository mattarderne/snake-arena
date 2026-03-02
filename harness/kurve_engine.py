"""
Local Kurve (Achtung die Kurve) game engine for testing strategies.

Rules:
- 640x480 continuous coordinate space, (0,0) = bottom-left
- Speed: 3 units/tick (constant)
- Turning: ±5° per tick
- Moves: "left", "right", "straight"
- Players leave trails — collision with walls or any trail = death
- Random gaps in trails every ~70-100 ticks, lasting 5-8 ticks
- Last player alive wins, max 2000 ticks
"""

import math
import random
import copy
from typing import Callable
from collections import defaultdict

MoveFunc = Callable[[dict], str]

SPEED = 3.0
TURN_RATE = 5.0  # degrees per tick
TRAIL_RADIUS = 1.5  # collision radius for trail segments
GAP_INTERVAL_MIN = 70
GAP_INTERVAL_MAX = 100
GAP_DURATION_MIN = 5
GAP_DURATION_MAX = 8
WIDTH = 640
HEIGHT = 480
MAX_TURNS = 2000

# Spatial grid cell size for fast trail collision
GRID_CELL = 10.0


class TrailGrid:
    """Spatial hash grid for fast trail collision detection."""

    def __init__(self):
        self.cells = defaultdict(list)  # (cx, cy) -> list of (x1, y1, x2, y2)

    def _cell(self, x, y):
        return (int(x // GRID_CELL), int(y // GRID_CELL))

    def add_segment(self, x1, y1, x2, y2):
        """Add a trail segment to the grid."""
        # Insert into all cells the segment passes through
        min_cx = int(min(x1, x2) // GRID_CELL) - 1
        max_cx = int(max(x1, x2) // GRID_CELL) + 1
        min_cy = int(min(y1, y2) // GRID_CELL) - 1
        max_cy = int(max(y1, y2) // GRID_CELL) + 1
        seg = (x1, y1, x2, y2)
        for cx in range(min_cx, max_cx + 1):
            for cy in range(min_cy, max_cy + 1):
                self.cells[(cx, cy)].append(seg)

    def check_collision(self, px, py, radius=TRAIL_RADIUS):
        """Check if point (px, py) collides with any trail segment."""
        cx, cy = self._cell(px, py)
        r_sq = radius * radius
        # Check neighboring cells
        for dx in range(-1, 2):
            for dy in range(-1, 2):
                for x1, y1, x2, y2 in self.cells.get((cx + dx, cy + dy), ()):
                    # Point-to-segment distance squared
                    sdx, sdy = x2 - x1, y2 - y1
                    seg_sq = sdx * sdx + sdy * sdy
                    if seg_sq < 0.001:
                        if (px - x1) ** 2 + (py - y1) ** 2 < r_sq:
                            return True
                        continue
                    t = max(0.0, min(1.0, ((px - x1) * sdx + (py - y1) * sdy) / seg_sq))
                    proj_x = x1 + t * sdx
                    proj_y = y1 + t * sdy
                    if (px - proj_x) ** 2 + (py - proj_y) ** 2 < r_sq:
                        return True
        return False


def create_player(player_id: str, x: float, y: float, direction: float) -> dict:
    return {
        "id": player_id,
        "position": {"x": x, "y": y},
        "direction": direction,
        "speed": SPEED,
        "alive": True,
    }


def make_game_state(board: dict, player: dict, turn: int) -> dict:
    return {
        "game": {"id": "local-test", "timeout": 50},
        "turn": turn,
        "you": copy.deepcopy(player),
        "board": copy.deepcopy(board),
    }


def run_game(
    strategies: dict[str, MoveFunc],
    width: int = WIDTH,
    height: int = HEIGHT,
    max_turns: int = MAX_TURNS,
    seed: int | None = None,
    verbose: bool = False,
) -> dict:
    if seed is not None:
        random.seed(seed)

    player_ids = list(strategies.keys())

    spawn_configs = [
        (width * 0.25, height * 0.25, 45),
        (width * 0.75, height * 0.75, 225),
        (width * 0.75, height * 0.25, 135),
        (width * 0.25, height * 0.75, 315),
        (width * 0.5, height * 0.25, 90),
        (width * 0.5, height * 0.75, 270),
        (width * 0.25, height * 0.5, 0),
        (width * 0.75, height * 0.5, 180),
    ]

    players = {}
    trails = {}  # player_id -> list of [x, y]
    trail_grid = TrailGrid()
    # Per-player grid excluding recent segments (for self-collision)
    player_grids = {}  # player_id -> TrailGrid (excluding last N points)
    gap_timers = {}
    recent_points = {}  # player_id -> deque of recent trail points

    for i, pid in enumerate(player_ids):
        cfg = spawn_configs[i % len(spawn_configs)]
        players[pid] = create_player(pid, cfg[0], cfg[1], cfg[2])
        trails[pid] = [[cfg[0], cfg[1]]]
        gap_timers[pid] = {
            "next_gap": random.randint(GAP_INTERVAL_MIN, GAP_INTERVAL_MAX),
            "gap_end": 0,
            "in_gap": False,
        }

    board = {
        "width": width,
        "height": height,
        "players": [],
        "trails": {},
    }

    death_reasons = {}
    turn_log = []

    for turn in range(max_turns):
        alive = [pid for pid in player_ids if pid not in death_reasons]
        if len(alive) <= 1:
            break

        # Build board state (send compact trail data to strategies)
        board["players"] = [copy.deepcopy(players[pid]) for pid in alive]
        # Send trails sampled for performance (every 3rd point for strategies)
        board["trails"] = {}
        for pid in player_ids:
            t = trails[pid]
            if len(t) > 300:
                board["trails"][pid] = t[::3] + t[-10:]
            else:
                board["trails"][pid] = list(t)

        # Collect moves
        moves = {}
        for pid in alive:
            state = make_game_state(board, players[pid], turn)
            try:
                move = strategies[pid](state)
                if move not in ("left", "right", "straight"):
                    move = "straight"
            except Exception as e:
                if verbose:
                    print(f"  [{pid}] error: {e}")
                move = "straight"
            moves[pid] = move

        if verbose and turn % 200 == 0:
            positions = {pid: f"{players[pid]['position']['x']:.0f},{players[pid]['position']['y']:.0f}"
                         for pid in alive}
            print(f"Turn {turn}: alive={alive} pos={positions}")

        # Apply moves
        for pid in alive:
            p = players[pid]
            move = moves[pid]

            if move == "left":
                p["direction"] = (p["direction"] + TURN_RATE) % 360
            elif move == "right":
                p["direction"] = (p["direction"] - TURN_RATE) % 360

            rad = math.radians(p["direction"])
            old_x, old_y = p["position"]["x"], p["position"]["y"]
            p["position"]["x"] += math.cos(rad) * SPEED
            p["position"]["y"] += math.sin(rad) * SPEED
            new_x, new_y = p["position"]["x"], p["position"]["y"]

            # Gap timer
            gt = gap_timers[pid]
            if turn >= gt["next_gap"] and not gt["in_gap"]:
                gt["in_gap"] = True
                gt["gap_end"] = turn + random.randint(GAP_DURATION_MIN, GAP_DURATION_MAX)
            if gt["in_gap"] and turn >= gt["gap_end"]:
                gt["in_gap"] = False
                gt["next_gap"] = turn + random.randint(GAP_INTERVAL_MIN, GAP_INTERVAL_MAX)

            # Add trail
            if not gt["in_gap"]:
                trails[pid].append([new_x, new_y])
                trail_grid.add_segment(old_x, old_y, new_x, new_y)

        # Check deaths using spatial grid
        for pid in alive:
            if pid in death_reasons:
                continue
            px = players[pid]["position"]["x"]
            py = players[pid]["position"]["y"]

            # Wall collision
            if px < 0 or px >= width or py < 0 or py >= height:
                death_reasons[pid] = f"wall collision (turn {turn})"
                continue

            # Trail collision - use grid but skip own recent segments
            # Build a quick check: is the point near any trail?
            cx_key = int(px // GRID_CELL)
            cy_key = int(py // GRID_CELL)
            r_sq = TRAIL_RADIUS * TRAIL_RADIUS
            collided = False
            collided_with = None

            for dx in range(-1, 2):
                if collided:
                    break
                for dy in range(-1, 2):
                    if collided:
                        break
                    for x1, y1, x2, y2 in trail_grid.cells.get((cx_key + dx, cy_key + dy), ()):
                        # Skip own very recent segments
                        own_trail = trails[pid]
                        is_own_recent = False
                        if len(own_trail) >= 2:
                            last = own_trail[-1]
                            prev = own_trail[-2] if len(own_trail) > 1 else last
                            # Check if this segment is one of our last few
                            if (abs(x2 - last[0]) < 0.01 and abs(y2 - last[1]) < 0.01):
                                is_own_recent = True
                            if len(own_trail) > 2:
                                pp = own_trail[-3]
                                if (abs(x2 - prev[0]) < 0.01 and abs(y2 - prev[1]) < 0.01):
                                    is_own_recent = True
                                if (abs(x2 - pp[0]) < 0.01 and abs(y2 - pp[1]) < 0.01):
                                    is_own_recent = True
                        if is_own_recent:
                            continue

                        sdx, sdy = x2 - x1, y2 - y1
                        seg_sq = sdx * sdx + sdy * sdy
                        if seg_sq < 0.001:
                            if (px - x1) ** 2 + (py - y1) ** 2 < r_sq:
                                collided = True
                                break
                            continue
                        t = max(0.0, min(1.0, ((px - x1) * sdx + (py - y1) * sdy) / seg_sq))
                        proj_x = x1 + t * sdx
                        proj_y = y1 + t * sdy
                        if (px - proj_x) ** 2 + (py - proj_y) ** 2 < r_sq:
                            collided = True
                            break

            if collided:
                death_reasons[pid] = f"trail collision (turn {turn})"

        turn_log.append({
            "turn": turn,
            "moves": dict(moves),
            "alive": [pid for pid in player_ids if pid not in death_reasons],
            "deaths": {k: v for k, v in death_reasons.items() if f"turn {turn}" in v},
        })

    alive = [pid for pid in player_ids if pid not in death_reasons]
    if len(alive) == 1:
        winner = alive[0]
    elif len(alive) > 1:
        winner = alive[0]
    else:
        winner = None

    final_turn = turn_log[-1]["turn"] if turn_log else 0
    return {
        "winner": winner,
        "turns": final_turn + 1,
        "death_reasons": death_reasons,
        "turn_log": turn_log,
    }


def run_match(
    strategies: dict[str, MoveFunc],
    games: int = 5,
    seed_base: int | None = None,
    verbose: bool = False,
    **kwargs,
) -> dict:
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
