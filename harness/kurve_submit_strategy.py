"""
Submittable Kurve strategy for snake-arena (no MLX dependency).

Distilled from Qwen 3.5 35B testing - pure algorithmic strategy.

Submit with:
    npx snake-arena submit harness/kurve_submit_strategy.py \
        --name qwen-kurve-a3b --model qwen3.5-35b-a3b --game kurve
"""

import math

SPEED = 3.0
TURN_RATE = 5.0


def decide_move(data: dict) -> str:
    me = data["you"]
    board = data["board"]
    pos = me["position"]
    direction = me["direction"]
    trails = board["trails"]
    my_id = me["id"]
    w, h = board["width"], board["height"]

    best_move = "straight"
    best_score = -9999

    for move in ["left", "right", "straight"]:
        score = 0.0

        for steps, weight in [(10, 3.0), (25, 1.5), (50, 0.7)]:
            x, y, d = pos["x"], pos["y"], direction
            survived = 0
            for _ in range(steps):
                if move == "left":
                    d = (d + TURN_RATE) % 360
                elif move == "right":
                    d = (d - TURN_RATE) % 360
                rad = math.radians(d)
                x += math.cos(rad) * SPEED
                y += math.sin(rad) * SPEED

                if not (2 < x < w - 2 and 2 < y < h - 2):
                    score -= 500 * weight
                    break

                # Trail collision check
                hit = False
                for tid, points in trails.items():
                    skip = 10 if tid == my_id else 0
                    check = points[:len(points) - skip] if skip else points
                    for j in range(len(check) - 1):
                        x1, y1 = check[j][0], check[j][1]
                        x2, y2 = check[j + 1][0], check[j + 1][1]
                        if (x2 - x1) ** 2 + (y2 - y1) ** 2 > (SPEED * 3) ** 2:
                            continue
                        ddx, ddy = x2 - x1, y2 - y1
                        sq = ddx * ddx + ddy * ddy
                        if sq < 0.001:
                            if (x - x1) ** 2 + (y - y1) ** 2 < 20.25:
                                hit = True
                                break
                            continue
                        t = max(0, min(1, ((x - x1) * ddx + (y - y1) * ddy) / sq))
                        px, py = x1 + t * ddx, y1 + t * ddy
                        if (x - px) ** 2 + (y - py) ** 2 < 20.25:
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    score -= 300 * weight
                    break

                survived += 1

            score += survived * 2 * weight

            if survived == steps:
                wd = min(x, y, w - x, h - y)
                score += min(wd, 100) * 0.3 * weight

        # 2-level lookahead from 15 ticks out
        x, y, d = pos["x"], pos["y"], direction
        ok = True
        for _ in range(15):
            if move == "left":
                d = (d + TURN_RATE) % 360
            elif move == "right":
                d = (d - TURN_RATE) % 360
            rad = math.radians(d)
            x += math.cos(rad) * SPEED
            y += math.sin(rad) * SPEED
            if not (5 < x < w - 5 and 5 < y < h - 5):
                ok = False
                break

        if ok:
            future_options = 0
            for m2 in ["left", "right", "straight"]:
                x2, y2, d2 = x, y, d
                safe = True
                for _ in range(20):
                    if m2 == "left":
                        d2 = (d2 + TURN_RATE) % 360
                    elif m2 == "right":
                        d2 = (d2 - TURN_RATE) % 360
                    rad2 = math.radians(d2)
                    x2 += math.cos(rad2) * SPEED
                    y2 += math.sin(rad2) * SPEED
                    if not (3 < x2 < w - 3 and 3 < y2 < h - 3):
                        safe = False
                        break
                if safe:
                    future_options += 1
            score += future_options * 20

        # Center preference
        cx, cy = w / 2, h / 2
        dist_c = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        max_d = math.sqrt(cx ** 2 + cy ** 2)
        score += (1.0 - dist_c / max_d) * 15

        if score > best_score:
            best_score = score
            best_move = move

    return best_move
