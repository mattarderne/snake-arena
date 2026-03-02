"""
Submittable Battlesnake strategy for snake-arena.

This is the self-contained version that runs on the cloud (no MLX dependency).
Distilled from Qwen 3.5 35B testing - pure algorithmic strategy.

Submit with:
    npx snake-arena submit harness/submit_strategy.py \
        --name qwen-a3b --model qwen3.5-35b-a3b
"""

from collections import deque


def decide_move(data: dict) -> str:
    head = data["you"]["head"]
    body = data["you"]["body"]
    health = data["you"]["health"]
    length = data["you"]["length"]
    board = data["board"]
    my_id = data["you"]["id"]
    food = board["food"]
    snakes = board["snakes"]
    w, h = board["width"], board["height"]

    # Occupied cells - exclude tails that will move
    occupied = set()
    for snake in snakes:
        b = snake["body"]
        for i, seg in enumerate(b):
            if i == len(b) - 1 and b[-1] != b[-2]:
                continue
            occupied.add((seg["x"], seg["y"]))

    # Danger zones: cells adjacent to longer/equal opponent heads
    danger = set()
    for snake in snakes:
        if snake["id"] == my_id:
            continue
        if snake["length"] >= length:
            oh = snake["head"]
            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                danger.add((oh["x"] + dx, oh["y"] + dy))

    # Safe moves
    move_map = {
        "up":    (head["x"], head["y"] + 1),
        "down":  (head["x"], head["y"] - 1),
        "left":  (head["x"] - 1, head["y"]),
        "right": (head["x"] + 1, head["y"]),
    }
    safe = {m: p for m, p in move_map.items()
            if 0 <= p[0] < w and 0 <= p[1] < h and p not in occupied}

    if not safe:
        return "up"
    if len(safe) == 1:
        return list(safe.keys())[0]

    # Flood fill
    def ff(sx, sy):
        visited = {(sx, sy)}
        q = deque([(sx, sy)])
        while q:
            cx, cy = q.popleft()
            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in occupied and (nx, ny) not in visited:
                    visited.add((nx, ny))
                    q.append((nx, ny))
        return len(visited)

    scores = {}
    for move, (x, y) in safe.items():
        score = 0.0

        # Space analysis
        space = ff(x, y)
        if space < length:
            score -= 500
        elif space < length * 2:
            score -= 80
        score += min(space, 60)

        # Danger zone avoidance
        if (x, y) in danger:
            score -= 70

        # Multi-step lookahead
        future_occ = occupied | {(x, y)}
        exits = 0
        exit_space = 0
        for ddx, ddy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
            nx, ny = x + ddx, y + ddy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in future_occ:
                exits += 1
                # 3rd level
                for ddx2, ddy2 in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                    nx2, ny2 = nx + ddx2, ny + ddy2
                    if 0 <= nx2 < w and 0 <= ny2 < h and (nx2, ny2) not in future_occ:
                        exit_space += 1
        score += exits * 5
        score += exit_space * 0.5

        # Adaptive food seeking
        if food:
            cd = min(abs(x - f["x"]) + abs(y - f["y"]) for f in food)
            if health < 25:
                score += max(0, 20 - cd) * 6
            elif health < 50:
                score += max(0, 20 - cd) * 3
            elif health < 80:
                score += max(0, 15 - cd)

        # Aggression: hunt shorter snakes
        for snake in snakes:
            if snake["id"] == my_id:
                continue
            oh = snake["head"]
            dist = abs(x - oh["x"]) + abs(y - oh["y"])
            if length > snake["length"] + 1 and dist <= 4:
                score += max(0, 8 - dist) * 2
            elif snake["length"] >= length and dist <= 1:
                score -= 80

        # Edge avoidance
        if x == 0 or x == w - 1:
            score -= 10
        if y == 0 or y == h - 1:
            score -= 10

        # Corner avoidance
        for cx, cy in [(0, 0), (0, h-1), (w-1, 0), (w-1, h-1)]:
            if abs(x - cx) + abs(y - cy) <= 2:
                score -= 12

        # Center preference
        score -= (abs(x - w // 2) + abs(y - h // 2)) * 0.5

        # Tail chasing for safety loops
        tail = body[-1]
        td = abs(x - tail["x"]) + abs(y - tail["y"])
        if health > 50:
            score += max(0, 8 - td)

        scores[move] = score

    return max(scores, key=scores.get)
