"""
Snake Arena - Advanced Strategy Template

This template includes flood fill for space analysis and smarter
food/opponent handling. Customize it to build a competitive snake.
"""

from collections import deque


def decide_move(data: dict) -> str:
    head = data["you"]["head"]
    body = data["you"]["body"]
    health = data["you"]["health"]
    length = data["you"]["length"]
    board = data["board"]
    w, h = board["width"], board["height"]
    food = board["food"]
    snakes = board["snakes"]
    my_id = data["you"]["id"]

    # Build occupied set (exclude tail tips since they'll move)
    occupied = set()
    for snake in snakes:
        for i, seg in enumerate(snake["body"]):
            # Tail tip will move unless snake just ate
            if i == len(snake["body"]) - 1 and snake["body"][-1] != snake["body"][-2]:
                continue
            occupied.add((seg["x"], seg["y"]))

    # Possible moves
    moves = {
        "up":    (head["x"], head["y"] + 1),
        "down":  (head["x"], head["y"] - 1),
        "left":  (head["x"] - 1, head["y"]),
        "right": (head["x"] + 1, head["y"]),
    }

    # Filter safe moves
    safe = {}
    for move, (x, y) in moves.items():
        if 0 <= x < w and 0 <= y < h and (x, y) not in occupied:
            safe[move] = (x, y)

    if not safe:
        return "up"
    if len(safe) == 1:
        return list(safe.keys())[0]

    # Flood fill: count reachable cells from each safe move
    def flood_fill(start_x, start_y):
        visited = set()
        queue = deque([(start_x, start_y)])
        visited.add((start_x, start_y))
        while queue:
            cx, cy = queue.popleft()
            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in occupied and (nx, ny) not in visited:
                    visited.add((nx, ny))
                    queue.append((nx, ny))
        return len(visited)

    move_scores = {}
    for move, (x, y) in safe.items():
        space = flood_fill(x, y)
        # Penalize moves that lead to small spaces
        if space < length:
            score = -100 + space
        else:
            score = space

        # Bonus for moving toward food when hungry
        if health < 30 and food:
            closest_food_dist = min(abs(x - f["x"]) + abs(y - f["y"]) for f in food)
            score += max(0, 20 - closest_food_dist) * 2

        # Avoid head-to-head with longer snakes
        for snake in snakes:
            if snake["id"] == my_id:
                continue
            opp_head = snake["head"]
            dist = abs(x - opp_head["x"]) + abs(y - opp_head["y"])
            if dist <= 1 and snake["length"] >= length:
                score -= 50

        # Prefer center of board
        center_dist = abs(x - w // 2) + abs(y - h // 2)
        score -= center_dist

        move_scores[move] = score

    return max(move_scores, key=move_scores.get)
