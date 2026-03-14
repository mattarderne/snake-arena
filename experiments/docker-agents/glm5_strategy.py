"""
Achtung die Kurve strategy - Vortex-style with deep search
"""

import math

BOARD_WIDTH = 640
BOARD_HEIGHT = 480
SPEED = 3.0
TURN_ANGLE = 5.0
COLLISION_RADIUS = 3.0
WALL_MARGIN = 10

def normalize_angle(angle):
    """Normalize angle to [0, 360)"""
    return angle % 360

def get_direction_vector(direction_deg):
    """Get unit vector from direction in degrees"""
    rad = math.radians(direction_deg)
    return math.cos(rad), math.sin(rad)

def move_point(x, y, direction, distance):
    """Move from (x,y) in direction by distance"""
    rad = math.radians(direction)
    return x + math.cos(rad) * distance, y + math.sin(rad) * distance

def point_to_segment_distance(px, py, ax, ay, bx, by):
    """Distance from point (px,py) to line segment (ax,ay)-(bx,by)"""
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq < 1e-10:
        return math.sqrt((px - ax) ** 2 + (py - ay) ** 2)

    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_len_sq))
    proj_x = ax + t * dx
    proj_y = ay + t * dy
    return math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)

def check_collision(x, y, trails, own_id, skip_recent=5):
    """Check if position (x,y) collides with walls or trails"""
    # Wall collision
    if x < COLLISION_RADIUS or x >= BOARD_WIDTH - COLLISION_RADIUS:
        return True
    if y < COLLISION_RADIUS or y >= BOARD_HEIGHT - COLLISION_RADIUS:
        return True

    # Trail collision
    for pid, trail in trails.items():
        if len(trail) < 2:
            continue

        # Skip recent segments of own trail
        if pid == own_id:
            start_idx = max(0, len(trail) - skip_recent)
            check_trail = trail[:start_idx]
        else:
            check_trail = trail

        for i in range(len(check_trail) - 1):
            ax, ay = check_trail[i]
            bx, by = check_trail[i + 1]
            dist = point_to_segment_distance(x, y, ax, ay, bx, by)
            if dist <= COLLISION_RADIUS:
                return True

    return False

def simulate_path(x, y, direction, turn, steps, trails, own_id):
    """Simulate path for N steps with given turn direction. Returns (survived, final_pos)"""
    dir_change = TURN_ANGLE if turn == "left" else (-TURN_ANGLE if turn == "right" else 0)

    for _ in range(steps):
        direction = normalize_angle(direction + dir_change)
        x, y = move_point(x, y, direction, SPEED)

        if check_collision(x, y, trails, own_id):
            return False, (x, y)

    return True, (x, y)

def count_survival_ticks(x, y, direction, turn, max_ticks, trails, own_id):
    """Count how many ticks we can survive with given turn"""
    dir_change = TURN_ANGLE if turn == "left" else (-TURN_ANGLE if turn == "right" else 0)

    for tick in range(1, max_ticks + 1):
        direction = normalize_angle(direction + dir_change)
        x, y = move_point(x, y, direction, SPEED)

        if check_collision(x, y, trails, own_id):
            return tick

    return max_ticks

def get_open_space_direction(x, y, direction, trails, own_id):
    """Estimate which turn direction leads to more open space"""
    # Check multiple angles ahead
    best_turn = "straight"
    best_dist = 0

    for turn in ["left", "right", "straight"]:
        dir_change = TURN_ANGLE if turn == "left" else (-TURN_ANGLE if turn == "right" else 0)

        # Cast rays at different angles
        total_dist = 0
        for angle_offset in [-15, 0, 15]:
            check_dir = normalize_angle(direction + angle_offset)
            dist = ray_cast(x, y, check_dir, trails, own_id)
            total_dist += dist

        if total_dist > best_dist:
            best_dist = total_dist
            best_turn = turn

    return best_turn

def build_trail_grid(trails, own_id, cell=6):
    """Build a set of occupied grid cells for fast collision lookup."""
    occupied = set()
    for pid, trail in trails.items():
        pts = trail[:-5] if pid == own_id else trail
        for px, py in pts:
            occupied.add((int(px // cell), int(py // cell)))
    return occupied, cell

def ray_cast(x, y, direction, trails, own_id, max_dist=120):
    """Cast a ray and return distance to first obstacle."""
    dx, dy = get_direction_vector(direction)
    grid, cell = build_trail_grid(trails, own_id)

    for dist in range(1, int(max_dist), 5):
        check_x = x + dx * dist
        check_y = y + dy * dist

        if check_x < 0 or check_x >= BOARD_WIDTH or check_y < 0 or check_y >= BOARD_HEIGHT:
            return dist

        gx, gy = int(check_x // cell), int(check_y // cell)
        for nx in (gx - 1, gx, gx + 1):
            for ny in (gy - 1, gy, gy + 1):
                if (nx, ny) in grid:
                    return dist

    return max_dist

def decide_move(data):
    """Main decision function"""
    you = data["you"]
    opp = data.get("opponent", {})

    x = you["position"]["x"]
    y = you["position"]["y"]
    direction = you["direction"]
    own_id = you["id"]

    trails = data["board"]["trails"]

    # Check immediate survival for each turn option
    survival_ticks = {}
    for turn in ["left", "right", "straight"]:
        survival_ticks[turn] = count_survival_ticks(x, y, direction, turn, 30, trails, own_id)

    # If one option is much better, take it
    max_survival = max(survival_ticks.values())

    # If only one option lets us survive, take it
    viable = [t for t, s in survival_ticks.items() if s == max_survival]

    if len(viable) == 1:
        return viable[0]

    # Among viable options, pick the one that leads to more open space
    best_turn = viable[0]
    best_space = 0

    for turn in viable:
        # Simulate a few ticks then check open space
        survived, (new_x, new_y) = simulate_path(x, y, direction, turn, 5, trails, own_id)
        if survived:
            new_dir = direction
            dir_change = TURN_ANGLE if turn == "left" else (-TURN_ANGLE if turn == "right" else 0)
            new_dir = normalize_angle(new_dir + dir_change * 5)

            space = 0
            for angle in [-30, -15, 0, 15, 30]:
                check_dir = normalize_angle(new_dir + angle)
                space += ray_cast(new_x, new_y, check_dir, trails, own_id)

            if space > best_space:
                best_space = space
                best_turn = turn

    return best_turn
