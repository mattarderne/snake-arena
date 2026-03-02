"""
MLX-powered Battlesnake strategy using Qwen 3.5 35B (A3B MoE).

Uses mlx-lm to run the model locally on Apple Silicon.
Falls back to a strong heuristic if MLX is unavailable.

Install:
    pip install mlx-lm

First run will download the model (~6GB for A3B variant):
    mlx-community/qwen3.5-35b-a3b
"""

import json
import time

# Lazy-loaded MLX components
_model = None
_tokenizer = None
_mlx_available = None


def _ensure_mlx():
    """Load MLX model on first call. Returns True if available."""
    global _model, _tokenizer, _mlx_available
    if _mlx_available is not None:
        return _mlx_available
    try:
        from mlx_lm import load, generate  # noqa: F401
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
        print("Using heuristic fallback.")
        _mlx_available = False
        return False


def _build_prompt(data: dict) -> str:
    """Build a concise prompt for the LLM from game state."""
    head = data["you"]["head"]
    body = data["you"]["body"]
    health = data["you"]["health"]
    length = data["you"]["length"]
    board = data["board"]
    my_id = data["you"]["id"]
    w, h = board["width"], board["height"]
    turn = data["turn"]

    # Build compact board representation
    # Identify occupied cells
    occupied = {}
    for snake in board["snakes"]:
        marker = "M" if snake["id"] == my_id else "E"
        for i, seg in enumerate(snake["body"]):
            key = (seg["x"], seg["y"])
            if i == 0:
                occupied[key] = marker.upper()  # Head
            else:
                occupied[key] = marker.lower()

    food_set = {(f["x"], f["y"]) for f in board["food"]}

    # Check which moves are immediately safe
    moves = {
        "up":    (head["x"], head["y"] + 1),
        "down":  (head["x"], head["y"] - 1),
        "left":  (head["x"] - 1, head["y"]),
        "right": (head["x"] + 1, head["y"]),
    }

    all_occupied = set()
    for snake in board["snakes"]:
        for seg in snake["body"]:
            all_occupied.add((seg["x"], seg["y"]))

    safe = []
    unsafe = []
    for m, (x, y) in moves.items():
        if 0 <= x < w and 0 <= y < h and (x, y) not in all_occupied:
            safe.append(m)
        else:
            unsafe.append(m)

    # Opponent info
    opponents = []
    for snake in board["snakes"]:
        if snake["id"] != my_id:
            opponents.append(
                f"  len={snake['length']} head=({snake['head']['x']},{snake['head']['y']})"
            )

    # Food list
    food_str = ", ".join(f"({f['x']},{f['y']})" for f in board["food"][:5])

    prompt = f"""You are playing Battlesnake on an {w}x{h} grid. Turn {turn}.

Your snake: head=({head['x']},{head['y']}) length={length} health={health}
Your body: {', '.join(f"({s['x']},{s['y']})" for s in body[:6])}
Opponents:
{chr(10).join(opponents) if opponents else '  None'}
Food: {food_str}
Safe moves: {', '.join(safe)}
Unsafe moves: {', '.join(unsafe)}

Rules:
- (0,0)=bottom-left, y+ is up
- Die if hit wall, any body, or head-to-head with longer/equal snake
- Eat food to grow and restore health (health decreases by 1/turn)

Pick the BEST move considering:
1. Don't trap yourself (flood fill - prefer more open space)
2. Seek food if health < 40
3. Avoid head-to-head with longer snakes
4. Control center territory

Reply with ONLY one word: up, down, left, or right"""

    return prompt


def _parse_llm_response(response: str) -> str | None:
    """Extract a valid move from LLM response."""
    response = response.strip().lower()
    for move in ["up", "down", "left", "right"]:
        if move in response:
            return move
    return None


def _heuristic_fallback(data: dict) -> str:
    """Strong heuristic fallback when MLX isn't available."""
    from collections import deque

    head = data["you"]["head"]
    body = data["you"]["body"]
    health = data["you"]["health"]
    length = data["you"]["length"]
    board = data["board"]
    my_id = data["you"]["id"]
    food = board["food"]
    snakes = board["snakes"]
    w, h = board["width"], board["height"]

    # Occupied cells (exclude moving tails)
    occupied = set()
    for snake in snakes:
        for i, seg in enumerate(snake["body"]):
            if i == len(snake["body"]) - 1 and snake["body"][-1] != snake["body"][-2]:
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

    moves_map = {
        "up":    (head["x"], head["y"] + 1),
        "down":  (head["x"], head["y"] - 1),
        "left":  (head["x"] - 1, head["y"]),
        "right": (head["x"] + 1, head["y"]),
    }

    safe = {m: pos for m, pos in moves_map.items()
            if 0 <= pos[0] < w and 0 <= pos[1] < h and pos not in occupied}

    if not safe:
        return "up"
    if len(safe) == 1:
        return list(safe.keys())[0]

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
        space = ff(x, y)
        if space < length:
            score -= 500
        elif space < length * 2:
            score -= 100
        score += min(space, 60)

        if (x, y) in danger:
            score -= 70

        if food:
            cd = min(abs(x - f["x"]) + abs(y - f["y"]) for f in food)
            if health < 30:
                score += max(0, 20 - cd) * 5
            elif health < 60:
                score += max(0, 15 - cd) * 2

        # Lookahead
        future_occ = occupied | {(x, y)}
        exits = 0
        for d in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
            nx, ny = x + d[0], y + d[1]
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in future_occ:
                exits += 1
        score += exits * 4

        if x == 0 or x == w - 1:
            score -= 8
        if y == 0 or y == h - 1:
            score -= 8

        cd = abs(x - w // 2) + abs(y - h // 2)
        score -= cd * 0.5

        # Tail chase
        tail = body[-1]
        td = abs(x - tail["x"]) + abs(y - tail["y"])
        if health > 50:
            score += max(0, 8 - td)

        scores[move] = score

    return max(scores, key=scores.get)


def decide_move(data: dict) -> str:
    """
    Main entry point. Uses Qwen 3.5 via MLX if available,
    otherwise falls back to heuristic.
    """
    if not _ensure_mlx():
        return _heuristic_fallback(data)

    from mlx_lm import generate

    prompt = _build_prompt(data)

    try:
        # Use chat template for Qwen
        messages = [
            {"role": "system", "content": "You are a Battlesnake AI. Reply with exactly one word: up, down, left, or right."},
            {"role": "user", "content": prompt},
        ]

        if hasattr(_tokenizer, "apply_chat_template"):
            formatted = _tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            formatted = prompt

        start = time.time()
        response = generate(
            _model,
            _tokenizer,
            prompt=formatted,
            max_tokens=10,
            temp=0.1,
        )
        elapsed = time.time() - start

        move = _parse_llm_response(response)
        if move:
            # Verify it's safe
            head = data["you"]["head"]
            board = data["board"]
            dx, dy = {"up": (0, 1), "down": (0, -1), "left": (-1, 0), "right": (1, 0)}[move]
            nx, ny = head["x"] + dx, head["y"] + dy
            occ = set()
            for s in board["snakes"]:
                for seg in s["body"]:
                    occ.add((seg["x"], seg["y"]))
            if 0 <= nx < board["width"] and 0 <= ny < board["height"] and (nx, ny) not in occ:
                return move

        # LLM gave unsafe move, fall back
        return _heuristic_fallback(data)

    except Exception as e:
        return _heuristic_fallback(data)
