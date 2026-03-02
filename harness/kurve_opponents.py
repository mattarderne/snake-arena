"""
Top-tier Kurve opponent strategies for local testing.

Three dominant archetypes in competitive Achtung die Kurve:
1. WallHugger - Stays near walls, maximizes interior space for opponents to die in
2. TrailDodger - Aggressive trail avoidance with deep lookahead + gap exploitation
3. CenterSpiral - Controls center with gradual spiraling, forces opponents to edges
"""

import math
from collections import defaultdict

SPEED = 3.0
TURN_RATE = 5.0
_GRID_CELL = 15.0


# ── Fast trail grid (rebuilt per move call from board data) ───────

class _QuickGrid:
    """Lightweight spatial hash built from trail point lists."""
    __slots__ = ('cells',)

    def __init__(self, trails, my_id=None, skip_recent=10):
        self.cells = defaultdict(list)
        for tid, points in trails.items():
            skip = skip_recent if tid == my_id else 0
            end = len(points) - skip if skip else len(points)
            for i in range(end - 1):
                x1, y1 = points[i][0], points[i][1]
                x2, y2 = points[i + 1][0], points[i + 1][1]
                # Skip gap jumps
                if (x2 - x1) ** 2 + (y2 - y1) ** 2 > (SPEED * 4) ** 2:
                    continue
                cx = int((x1 + x2) / 2 // _GRID_CELL)
                cy = int((y1 + y2) / 2 // _GRID_CELL)
                self.cells[(cx, cy)].append((x1, y1, x2, y2))

    def hits(self, px, py, radius=5.0):
        r_sq = radius * radius
        cx = int(px // _GRID_CELL)
        cy = int(py // _GRID_CELL)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for x1, y1, x2, y2 in self.cells.get((cx + dx, cy + dy), ()):
                    sdx, sdy = x2 - x1, y2 - y1
                    sq = sdx * sdx + sdy * sdy
                    if sq < 0.001:
                        if (px - x1) ** 2 + (py - y1) ** 2 < r_sq:
                            return True
                        continue
                    t = ((px - x1) * sdx + (py - y1) * sdy) / sq
                    if t < 0:
                        t = 0.0
                    elif t > 1:
                        t = 1.0
                    qx = x1 + t * sdx
                    qy = y1 + t * sdy
                    if (px - qx) ** 2 + (py - qy) ** 2 < r_sq:
                        return True
        return False


# ── Shared utilities ──────────────────────────────────────────────

def simulate_path(pos, direction, move, steps):
    x, y, d = pos["x"], pos["y"], direction
    path = []
    for _ in range(steps):
        if move == "left":
            d = (d + TURN_RATE) % 360
        elif move == "right":
            d = (d - TURN_RATE) % 360
        rad = math.radians(d)
        x += math.cos(rad) * SPEED
        y += math.sin(rad) * SPEED
        path.append((x, y, d))
    return path


def wall_distance(x, y, width, height):
    return min(x, y, width - x, height - y)


# ── Strategy 1: Wall Hugger ───────────────────────────────────────

def wall_hugger(data: dict) -> str:
    me = data["you"]
    board = data["board"]
    pos = me["position"]
    direction = me["direction"]
    w, h = board["width"], board["height"]
    grid = _QuickGrid(board["trails"], me["id"])

    target_wall_dist = 50
    best_move = "straight"
    best_score = -9999

    for move in ["left", "right", "straight"]:
        path = simulate_path(pos, direction, move, 20)
        score = 0.0

        for i, (x, y, d) in enumerate(path):
            wt = 1.0 - i * 0.03
            if not (0 < x < w and 0 < y < h):
                score -= 600 * wt
                break
            wd = wall_distance(x, y, w, h)
            score -= abs(wd - target_wall_dist) * 0.5 * wt
            if wd < 15:
                score -= (15 - wd) * 8 * wt
            if grid.hits(x, y):
                score -= 400 * wt
                break
        else:
            score += 30

        if score > best_score:
            best_score = score
            best_move = move

    return best_move


# ── Strategy 2: Trail Dodger ─────────────────────────────────────

def trail_dodger(data: dict) -> str:
    me = data["you"]
    board = data["board"]
    pos = me["position"]
    direction = me["direction"]
    w, h = board["width"], board["height"]
    grid = _QuickGrid(board["trails"], me["id"])

    best_move = "straight"
    best_score = -9999

    for move in ["left", "right", "straight"]:
        score = 0.0

        for steps, weight in [(10, 3.0), (20, 1.5), (40, 0.5)]:
            path = simulate_path(pos, direction, move, steps)
            survived = 0
            for x, y, d in path:
                if not (3 < x < w - 3 and 3 < y < h - 3):
                    score -= 500 * weight
                    break
                if grid.hits(x, y, 4.5):
                    score -= 300 * weight
                    break
                survived += 1
            score += survived * 2 * weight
            if survived == steps:
                wd = wall_distance(path[-1][0], path[-1][1], w, h)
                score += min(wd, 100) * 0.3 * weight

        # 2-level lookahead
        path15 = simulate_path(pos, direction, move, 12)
        if len(path15) == 12:
            fx, fy, fd = path15[-1]
            if 5 < fx < w - 5 and 5 < fy < h - 5:
                opts = 0
                for m2 in ["left", "right", "straight"]:
                    p2 = simulate_path({"x": fx, "y": fy}, fd, m2, 12)
                    ok = True
                    for x2, y2, _ in p2:
                        if not (5 < x2 < w - 5 and 5 < y2 < h - 5):
                            ok = False
                            break
                        if grid.hits(x2, y2, 4.5):
                            ok = False
                            break
                    if ok:
                        opts += 1
                score += opts * 15

        if score > best_score:
            best_score = score
            best_move = move

    return best_move


# ── Strategy 3: Center Spiral ────────────────────────────────────

def center_spiral(data: dict) -> str:
    me = data["you"]
    board = data["board"]
    pos = me["position"]
    direction = me["direction"]
    w, h = board["width"], board["height"]
    grid = _QuickGrid(board["trails"], me["id"])

    cx, cy = w / 2, h / 2
    best_move = "straight"
    best_score = -9999

    for move in ["left", "right", "straight"]:
        path = simulate_path(pos, direction, move, 25)
        score = 0.0
        alive = True

        for i, (x, y, d) in enumerate(path):
            wt = 1.0 - i * 0.02
            if not (2 < x < w - 2 and 2 < y < h - 2):
                score -= 600 * wt
                alive = False
                break
            if grid.hits(x, y, 5.0):
                score -= 400 * wt
                alive = False
                break
            dist_c = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            max_d = math.sqrt(cx ** 2 + cy ** 2)
            score += (1.0 - dist_c / max_d) * 30 * wt
            wd = wall_distance(x, y, w, h)
            if wd < 20:
                score -= (20 - wd) * 3 * wt

        if alive:
            score += 40
            if move == "straight":
                score += 5
            else:
                angle_to_c = math.degrees(math.atan2(cy - pos["y"], cx - pos["x"])) % 360
                diff = (angle_to_c - direction) % 360
                if diff > 180:
                    diff -= 360
                if (move == "left" and diff > 0) or (move == "right" and diff < 0):
                    score += 8

        if score > best_score:
            best_score = score
            best_move = move

    return best_move


KURVE_TOP_STRATEGIES = {
    "wall-hugger": wall_hugger,
    "trail-dodger": trail_dodger,
    "center-spiral": center_spiral,
}
