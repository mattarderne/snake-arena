"""
MLX-powered Kurve strategy using Qwen 3.5 35B (A3B MoE).

Uses mlx-lm to run the model locally on Apple Silicon.
Falls back to a strong heuristic if MLX is unavailable.

Install:
    pip install mlx-lm

Model (~6GB for A3B MoE variant):
    mlx-community/qwen3.5-35b-a3b
"""

import math
import time
from collections import defaultdict

SPEED = 3.0
TURN_RATE = 5.0
_GRID_CELL = 15.0

# Lazy-loaded MLX components
_model = None
_tokenizer = None
_mlx_available = None


def _ensure_mlx():
    global _model, _tokenizer, _mlx_available
    if _mlx_available is not None:
        return _mlx_available
    try:
        from mlx_lm import load
        print("Loading mlx-community/qwen3.5-35b-a3b ...")
        _model, _tokenizer = load("mlx-community/qwen3.5-35b-a3b")
        _mlx_available = True
        print("Model loaded successfully.")
        return True
    except ImportError:
        print("WARNING: mlx-lm not installed. Using heuristic fallback.")
        print("Install with: pip install mlx-lm")
        _mlx_available = False
        return False
    except Exception as e:
        print(f"WARNING: Failed to load MLX model: {e}")
        _mlx_available = False
        return False


class _QuickGrid:
    """Spatial hash for fast trail collision checks."""
    __slots__ = ('cells',)

    def __init__(self, trails, my_id=None, skip_recent=10):
        self.cells = defaultdict(list)
        for tid, points in trails.items():
            skip = skip_recent if tid == my_id else 0
            end = len(points) - skip if skip else len(points)
            for i in range(end - 1):
                x1, y1 = points[i][0], points[i][1]
                x2, y2 = points[i + 1][0], points[i + 1][1]
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


def _simulate(pos, direction, move, steps):
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


def _build_prompt(data: dict) -> str:
    me = data["you"]
    board = data["board"]
    pos = me["position"]
    direction = me["direction"]
    w, h = board["width"], board["height"]
    turn = data["turn"]
    my_id = me["id"]
    trails = board["trails"]
    grid = _QuickGrid(trails, my_id)

    wall_dists = {
        "left_wall": pos["x"],
        "right_wall": w - pos["x"],
        "bottom_wall": pos["y"],
        "top_wall": h - pos["y"],
    }
    min_wall_name = min(wall_dists, key=wall_dists.get)
    min_wall = wall_dists[min_wall_name]

    move_info = {}
    for move in ["left", "right", "straight"]:
        path = _simulate(pos, direction, move, 20)
        survived = 0
        hit = None
        for x, y, d in path:
            if not (0 < x < w and 0 < y < h):
                hit = "wall"
                break
            if grid.hits(x, y, 4.5):
                hit = "trail"
                break
            survived += 1
        end = path[min(survived, len(path) - 1)]
        move_info[move] = f"survives {survived}/20 ticks, ends at ({end[0]:.0f},{end[1]:.0f})"
        if hit:
            move_info[move] += f", HIT {hit}"

    opponents = []
    for p in board["players"]:
        if p["id"] != my_id and p["alive"]:
            opponents.append(f"  ({p['position']['x']:.0f},{p['position']['y']:.0f}) heading {p['direction']:.0f}")

    prompt = f"""Kurve game (Achtung die Kurve). {w}x{h} board, turn {turn}.

You: position=({pos['x']:.0f},{pos['y']:.0f}) heading={direction:.0f} speed={SPEED}
Nearest wall: {min_wall_name} at {min_wall:.0f}px
Opponents:
{chr(10).join(opponents) if opponents else '  None'}

Move analysis (20-tick lookahead):
  left:     {move_info['left']}
  right:    {move_info['right']}
  straight: {move_info['straight']}

Rules: +5/tick for left, -5/tick for right. Hit wall or any trail = death.
Trails have random gaps every ~70-100 ticks.

Pick the BEST move. Prioritize:
1. Survival (don't hit walls or trails)
2. Keep options open (avoid trail-dense areas)
3. Stay away from edges when safe

Reply with ONLY one word: left, right, or straight"""

    return prompt


def _parse_response(response: str) -> str | None:
    response = response.strip().lower()
    for move in ["left", "right", "straight"]:
        if move in response:
            return move
    return None


def _heuristic_fallback(data: dict) -> str:
    """Strong heuristic Kurve strategy with spatial grid."""
    me = data["you"]
    board = data["board"]
    pos = me["position"]
    direction = me["direction"]
    trails = board["trails"]
    my_id = me["id"]
    w, h = board["width"], board["height"]
    grid = _QuickGrid(trails, my_id)

    best_move = "straight"
    best_score = -9999

    for move in ["left", "right", "straight"]:
        score = 0.0

        for steps, weight in [(10, 3.0), (20, 1.5), (40, 0.7)]:
            path = _simulate(pos, direction, move, steps)
            survived = 0
            for x, y, d in path:
                if not (2 < x < w - 2 and 2 < y < h - 2):
                    score -= 500 * weight
                    break
                if grid.hits(x, y, 4.5):
                    score -= 300 * weight
                    break
                survived += 1
            score += survived * 2 * weight
            if survived == steps:
                fx, fy = path[-1][0], path[-1][1]
                wd = min(fx, fy, w - fx, h - fy)
                score += min(wd, 100) * 0.3 * weight

        # 2-level lookahead
        path15 = _simulate(pos, direction, move, 12)
        if len(path15) == 12:
            fx, fy, fd = path15[-1]
            if 5 < fx < w - 5 and 5 < fy < h - 5:
                opts = 0
                for m2 in ["left", "right", "straight"]:
                    p2 = _simulate({"x": fx, "y": fy}, fd, m2, 15)
                    ok = True
                    for x2, y2, _ in p2:
                        if not (3 < x2 < w - 3 and 3 < y2 < h - 3):
                            ok = False
                            break
                        if grid.hits(x2, y2, 4.5):
                            ok = False
                            break
                    if ok:
                        opts += 1
                score += opts * 20

        # Center preference
        cx, cy = w / 2, h / 2
        p10 = _simulate(pos, direction, move, 10)
        if p10:
            fx, fy = p10[-1][0], p10[-1][1]
            dist_c = math.sqrt((fx - cx) ** 2 + (fy - cy) ** 2)
            max_d = math.sqrt(cx ** 2 + cy ** 2)
            score += (1.0 - dist_c / max_d) * 15

        if score > best_score:
            best_score = score
            best_move = move

    return best_move


def decide_move(data: dict) -> str:
    if not _ensure_mlx():
        return _heuristic_fallback(data)

    from mlx_lm import generate

    prompt = _build_prompt(data)

    try:
        messages = [
            {"role": "system", "content": "You are a Kurve (Achtung die Kurve) AI. Reply with exactly one word: left, right, or straight."},
            {"role": "user", "content": prompt},
        ]

        if hasattr(_tokenizer, "apply_chat_template"):
            formatted = _tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            formatted = prompt

        response = generate(
            _model,
            _tokenizer,
            prompt=formatted,
            max_tokens=10,
            temp=0.1,
        )

        move = _parse_response(response)
        if move:
            return move

        return _heuristic_fallback(data)

    except Exception:
        return _heuristic_fallback(data)
