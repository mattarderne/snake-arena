"""
Snake Arena - Your Battlesnake Strategy

Implement the decide_move function below. It receives the full game state
and must return one of: "up", "down", "left", "right".

Game board: 11x11 grid. (0,0) is bottom-left, (10,10) is top-right.
Your snake dies if it hits a wall, another snake's body, or its own body.
Eat food to grow longer and restore health (starts at 100, -1 per turn).

Docs: https://docs.battlesnake.com/api
"""


def decide_move(data: dict) -> str:
    """Choose your next move based on the current game state.

    Args:
        data: Full game state dict containing:
            - data["you"]: Your snake (head, body, health, length)
            - data["board"]: Board state (width, height, snakes, food)
            - data["turn"]: Current turn number

    Returns:
        One of: "up", "down", "left", "right"
    """
    head = data["you"]["head"]
    body = data["you"]["body"]
    board = data["board"]
    w, h = board["width"], board["height"]

    # Collect all occupied cells
    occupied = set()
    for snake in board["snakes"]:
        for seg in snake["body"]:
            occupied.add((seg["x"], seg["y"]))

    # Possible moves and their resulting positions
    moves = {
        "up":    (head["x"], head["y"] + 1),
        "down":  (head["x"], head["y"] - 1),
        "left":  (head["x"] - 1, head["y"]),
        "right": (head["x"] + 1, head["y"]),
    }

    # Filter for safe moves (in bounds + not occupied)
    safe = []
    for move, (x, y) in moves.items():
        if 0 <= x < w and 0 <= y < h and (x, y) not in occupied:
            safe.append(move)

    if not safe:
        return "up"  # No safe moves, just go up

    # TODO: Add your strategy here!
    # Ideas:
    #   - Move toward food when health is low
    #   - Avoid head-to-head collisions with longer snakes
    #   - Use flood fill to avoid trapping yourself
    #   - Control space in the center of the board

    import random
    return random.choice(safe)
