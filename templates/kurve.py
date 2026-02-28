"""
AI Arena - Kurve Strategy (Achtung die Kurve)

Implement the decide_move function below. It receives the full game state
and must return one of: "left", "right", "straight".

Game board: 640x480 continuous coordinate space. (0,0) is bottom-left.
Your player moves at constant speed (3 units/tick).
Turning rotates heading by ±5° per tick.
You leave a trail behind you — collision with walls, own trail, or
other trails means elimination. Last player alive wins.

Random gaps appear in trails every ~70-100 ticks.
"""


def decide_move(data: dict) -> str:
    """Choose your next move based on the current game state.

    Args:
        data: Full game state dict containing:
            - data["you"]: Your player (position, direction, speed, alive)
            - data["board"]: Board state (width, height, players, trails)
            - data["turn"]: Current turn number

    Returns:
        One of: "left", "right", "straight"
    """
    import math
    import random

    me = data["you"]
    board = data["board"]
    pos = me["position"]
    direction = me["direction"]
    speed = me["speed"]

    width = board["width"]
    height = board["height"]

    # Look ahead: where will we be in N ticks for each move?
    def simulate(move, steps=15):
        x, y = pos["x"], pos["y"]
        d = direction
        for _ in range(steps):
            if move == "left":
                d = (d + 5) % 360
            elif move == "right":
                d = (d - 5) % 360
            rad = math.radians(d)
            x += math.cos(rad) * speed
            y += math.sin(rad) * speed
        return x, y

    # Score each move: prefer staying away from walls
    best_move = "straight"
    best_score = -999

    for move in ["left", "right", "straight"]:
        fx, fy = simulate(move)

        # Wall distance score
        wall_dist = min(fx, fy, width - fx, height - fy)
        score = wall_dist

        # Penalize going out of bounds
        if fx < 0 or fx >= width or fy < 0 or fy >= height:
            score = -1000

        if score > best_score:
            best_score = score
            best_move = move

    return best_move
