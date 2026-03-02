"""
Top-tier opponent strategies for local testing.

These represent the three dominant archetypes in competitive Battlesnake:
1. AggressiveHunter - head-to-head combat + flood fill
2. SpaceController - territory control + tail chasing
3. SurvivorPro - adaptive food/survival with deep lookahead
"""

from collections import deque
import random


# ── Shared utilities ──────────────────────────────────────────────

def get_occupied(board, exclude_tails=True):
    """Return set of occupied cells."""
    occupied = set()
    for snake in board["snakes"]:
        body = snake["body"]
        for i, seg in enumerate(body):
            if exclude_tails and i == len(body) - 1 and body[-1] != body[-2]:
                continue
            occupied.add((seg["x"], seg["y"]))
    return occupied


def safe_moves(head, board, occupied):
    """Return dict of move -> (x,y) for safe moves."""
    w, h = board["width"], board["height"]
    moves = {
        "up":    (head["x"], head["y"] + 1),
        "down":  (head["x"], head["y"] - 1),
        "left":  (head["x"] - 1, head["y"]),
        "right": (head["x"] + 1, head["y"]),
    }
    return {m: pos for m, pos in moves.items()
            if 0 <= pos[0] < w and 0 <= pos[1] < h and pos not in occupied}


def flood_fill(start_x, start_y, board, occupied):
    """Count reachable cells from a position."""
    w, h = board["width"], board["height"]
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


def manhattan(a, b):
    """Manhattan distance between two points (dicts with x,y)."""
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def opponent_heads(snakes, my_id):
    """Return list of (head, length) for other snakes."""
    return [(s["head"], s["length"]) for s in snakes if s["id"] != my_id]


# ── Strategy 1: Aggressive Hunter ─────────────────────────────────
# Wins by eliminating opponents through head-to-head when longer.
# Uses flood fill to avoid traps, seeks food to maintain size advantage.

def aggressive_hunter(data: dict) -> str:
    head = data["you"]["head"]
    body = data["you"]["body"]
    health = data["you"]["health"]
    length = data["you"]["length"]
    board = data["board"]
    my_id = data["you"]["id"]
    food = board["food"]
    snakes = board["snakes"]

    occupied = get_occupied(board)
    safe = safe_moves(head, board, occupied)

    if not safe:
        return "up"
    if len(safe) == 1:
        return list(safe.keys())[0]

    scores = {}
    for move, (x, y) in safe.items():
        score = 0.0

        # Flood fill - never go into tiny spaces
        space = flood_fill(x, y, board, occupied)
        if space < length * 2:
            score -= 200
        elif space < length:
            score -= 500
        score += min(space, 50)  # Cap benefit

        # AGGRESSIVE: hunt smaller snakes' heads
        for opp_head, opp_len in opponent_heads(snakes, my_id):
            dist = abs(x - opp_head["x"]) + abs(y - opp_head["y"])
            if length > opp_len + 1:
                # We're longer - chase their head
                score += max(0, 15 - dist) * 3
            elif length <= opp_len:
                # They're longer or equal - avoid
                if dist <= 2:
                    score -= 80
                elif dist <= 4:
                    score -= 20

        # Food seeking - be aggressive about growing
        if food:
            closest_dist = min(abs(x - f["x"]) + abs(y - f["y"]) for f in food)
            if health < 50 or length <= min((s["length"] for s in snakes), default=length):
                score += max(0, 20 - closest_dist) * 3
            else:
                score += max(0, 15 - closest_dist)

        # Center control when healthy
        w, h = board["width"], board["height"]
        center_dist = abs(x - w // 2) + abs(y - h // 2)
        score -= center_dist * 0.5

        # Avoid edges
        if x == 0 or x == w - 1 or y == 0 or y == h - 1:
            score -= 5

        scores[move] = score

    return max(scores, key=scores.get)


# ── Strategy 2: Space Controller ──────────────────────────────────
# Wins by controlling territory. Chases own tail to stay safe,
# cuts off opponents into smaller spaces.

def space_controller(data: dict) -> str:
    head = data["you"]["head"]
    body = data["you"]["body"]
    health = data["you"]["health"]
    length = data["you"]["length"]
    board = data["board"]
    my_id = data["you"]["id"]
    food = board["food"]
    snakes = board["snakes"]
    w, h = board["width"], board["height"]

    occupied = get_occupied(board)
    safe = safe_moves(head, board, occupied)

    if not safe:
        return "up"
    if len(safe) == 1:
        return list(safe.keys())[0]

    # Find my tail
    my_tail = body[-1]

    scores = {}
    for move, (x, y) in safe.items():
        score = 0.0

        # PRIMARY: flood fill score (maximize reachable space)
        space = flood_fill(x, y, board, occupied)
        if space < length:
            score -= 300
        score += space * 2  # Heavy weight on space

        # Tail chasing - stay near your tail for safety
        tail_dist = abs(x - my_tail["x"]) + abs(y - my_tail["y"])
        if health > 40:
            score += max(0, 15 - tail_dist) * 2

        # Cut off opponents - prefer moves that reduce their flood fill
        for snake in snakes:
            if snake["id"] == my_id:
                continue
            opp_head = snake["head"]
            # If we're adjacent to their possible moves, we might cut them off
            dist = abs(x - opp_head["x"]) + abs(y - opp_head["y"])
            if dist <= 3 and length > snake["length"]:
                # Try to be between them and open space
                score += 10

        # Food - only when needed
        if food and health < 35:
            closest_dist = min(abs(x - f["x"]) + abs(y - f["y"]) for f in food)
            score += max(0, 20 - closest_dist) * 4
        elif food and health < 70:
            closest_dist = min(abs(x - f["x"]) + abs(y - f["y"]) for f in food)
            score += max(0, 15 - closest_dist)

        # Avoid edges - territory controllers hate edges
        edge_penalty = 0
        if x == 0 or x == w - 1:
            edge_penalty += 8
        if y == 0 or y == h - 1:
            edge_penalty += 8
        if x <= 1 or x >= w - 2:
            edge_penalty += 3
        if y <= 1 or y >= h - 2:
            edge_penalty += 3
        score -= edge_penalty

        # Head-to-head avoidance
        for opp_head, opp_len in opponent_heads(snakes, my_id):
            dist = abs(x - opp_head["x"]) + abs(y - opp_head["y"])
            if dist <= 1 and opp_len >= length:
                score -= 100

        scores[move] = score

    return max(scores, key=scores.get)


# ── Strategy 3: Survivor Pro ─────────────────────────────────────
# Wins by outlasting opponents. Deep 3-move lookahead, adaptive
# food/survival balance, avoids all risky positions.

def _simulate_move(head, direction):
    """Return new head position after a move."""
    dx, dy = {"up": (0, 1), "down": (0, -1), "left": (-1, 0), "right": (1, 0)}[direction]
    return (head["x"] + dx, head["y"] + dy)


def survivor_pro(data: dict) -> str:
    head = data["you"]["head"]
    body = data["you"]["body"]
    health = data["you"]["health"]
    length = data["you"]["length"]
    board = data["board"]
    my_id = data["you"]["id"]
    food = board["food"]
    snakes = board["snakes"]
    w, h = board["width"], board["height"]

    occupied = get_occupied(board)

    # Also mark cells adjacent to longer snake heads as dangerous
    danger_zones = set()
    for snake in snakes:
        if snake["id"] == my_id:
            continue
        if snake["length"] >= length:
            oh = snake["head"]
            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                danger_zones.add((oh["x"] + dx, oh["y"] + dy))

    safe = safe_moves(head, board, occupied)

    if not safe:
        return "up"
    if len(safe) == 1:
        return list(safe.keys())[0]

    scores = {}
    for move, (x, y) in safe.items():
        score = 0.0

        # Flood fill
        space = flood_fill(x, y, board, occupied)
        if space < length:
            score -= 500
        elif space < length * 2:
            score -= 100
        score += min(space, 60)

        # Danger zone penalty
        if (x, y) in danger_zones:
            score -= 60

        # 2-step lookahead: from (x,y), check which moves are safe
        future_occupied = occupied | {(x, y)}
        future_safe_count = 0
        for d2 in ["up", "down", "left", "right"]:
            dx2, dy2 = {"up": (0, 1), "down": (0, -1), "left": (-1, 0), "right": (1, 0)}[d2]
            nx, ny = x + dx2, y + dy2
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in future_occupied:
                future_safe_count += 1
                # 3rd step
                for d3 in ["up", "down", "left", "right"]:
                    dx3, dy3 = {"up": (0, 1), "down": (0, -1), "left": (-1, 0), "right": (1, 0)}[d3]
                    nx2, ny2 = nx + dx3, ny + dy3
                    if 0 <= nx2 < w and 0 <= ny2 < h and (nx2, ny2) not in future_occupied:
                        score += 0.5
        score += future_safe_count * 5

        # Adaptive food seeking
        if food:
            closest_dist = min(abs(x - f["x"]) + abs(y - f["y"]) for f in food)
            if health < 25:
                score += max(0, 20 - closest_dist) * 6  # Desperate
            elif health < 50:
                score += max(0, 20 - closest_dist) * 3
            elif health < 80:
                score += max(0, 15 - closest_dist) * 1

        # Strong edge avoidance
        if x == 0 or x == w - 1:
            score -= 10
        if y == 0 or y == h - 1:
            score -= 10

        # Corner avoidance
        corners = [(0, 0), (0, h - 1), (w - 1, 0), (w - 1, h - 1)]
        for cx, cy in corners:
            if abs(x - cx) + abs(y - cy) <= 2:
                score -= 15

        # Center preference
        center_dist = abs(x - w // 2) + abs(y - h // 2)
        score -= center_dist * 0.3

        # Tail chasing for safety
        my_tail = body[-1]
        tail_dist = abs(x - my_tail["x"]) + abs(y - my_tail["y"])
        if health > 50:
            score += max(0, 10 - tail_dist)

        scores[move] = score

    return max(scores, key=scores.get)


# Registry for easy access
TOP_STRATEGIES = {
    "aggressive-hunter": aggressive_hunter,
    "space-controller": space_controller,
    "survivor-pro": survivor_pro,
}
