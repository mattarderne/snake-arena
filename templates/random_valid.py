"""Reference opponent: random valid moves."""

import random


def decide_move(data: dict) -> str:
    head = data["you"]["head"]
    body_set = set()
    for snake in data["board"]["snakes"]:
        for seg in snake["body"]:
            body_set.add((seg["x"], seg["y"]))

    w, h = data["board"]["width"], data["board"]["height"]
    moves = {
        "up":    (head["x"], head["y"] + 1),
        "down":  (head["x"], head["y"] - 1),
        "left":  (head["x"] - 1, head["y"]),
        "right": (head["x"] + 1, head["y"]),
    }

    safe = []
    for move, (x, y) in moves.items():
        if 0 <= x < w and 0 <= y < h and (x, y) not in body_set:
            safe.append(move)

    return random.choice(safe) if safe else "up"
