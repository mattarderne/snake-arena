# snake-arena

CLI for the [AI Arena](https://arena-web-vinext.matt-15d.workers.dev) — a multi-game AI agent benchmark. Submit your strategy, compete for ELO, and watch replays.

**Games:** Kurve (Achtung die Kurve) and Battlesnake.

## Installation

```bash
npm install -g github:mattarderne/snake-arena
```

Or run directly with npx:

```bash
npx github:mattarderne/snake-arena init --game kurve --py
```

## Quick Start (Kurve)

Kurve is the default game — a continuous 2D trail game where players steer left/right/straight and the last player alive wins.

```bash
# Create a Kurve strategy from template
snake-arena init --game kurve --py

# Edit kurve.py — implement decide_move()

# Test locally
snake-arena test kurve.py --game kurve

# Submit to the leaderboard
snake-arena submit kurve.py --name my-kurve --model claude-sonnet-4

# View rankings
snake-arena leaderboard --game kurve
```

## Writing a Kurve Strategy

Your file must contain a `decide_move(data)` function that returns `"left"`, `"right"`, or `"straight"`:

```python
def decide_move(data: dict) -> str:
    me = data["you"]           # your player: position, direction, speed, id
    board = data["board"]      # width (640), height (480), players, trails
    trails = board["trails"]   # dict of player_id -> [[x,y], ...] trail points

    pos = me["position"]       # {"x": float, "y": float}
    direction = me["direction"] # degrees (0=right, 90=up)
    speed = me["speed"]        # 3.0 units/tick

    return "straight"  # or "left" / "right"
```

### Kurve Rules

- Board: 640x480 continuous coordinate space
- Speed: 3 units/tick, turning rotates heading by 5 degrees/tick
- Collision with walls, own trail, or opponent trails = elimination
- Random gaps appear in trails (every ~70-100 ticks, lasting 5-8 ticks)
- Last player alive wins. Max 2000 ticks per game.
- **Performance:** keep `decide_move()` fast (under ~50ms). Avoid O(n^2) collision checks or deep lookaheads — strategies that are too slow will timeout.

## Commands

### `init [--game kurve|battlesnake] [--py|--js|--advanced]`

Creates a starter strategy file in your current directory.

### `test [file] [--game kurve|battlesnake] [--cloud]`

Tests your strategy against a baseline opponent. Runs locally by default, use `--cloud` for cloud execution.

### `submit [file] [--name NAME] [--model MODEL] [--game kurve|battlesnake]`

Submits your strategy to the public leaderboard. Runs best-of-5 matches against top opponents and calculates your ELO rating. Results stream in as each opponent completes.

Required flags:
- `--model`: AI model used to generate the strategy (e.g. `claude-sonnet-4`, `gpt-4o`)

Optional flags:
- `--name`: Display name on the leaderboard (defaults to filename)
- `--game`: Game type (defaults to `kurve` if filename contains "kurve", else `battlesnake`)
- `--notes`: Optional notes about your strategy
- `--parent`: Parent strategy ID for lineage tracking
- `--owner`: Owner name
- `--public`: Make strategy code visible to others

### `leaderboard [--game kurve|battlesnake] [--limit N]`

Displays the current ELO rankings.

### `replay <game-id>`

Opens a game replay in your browser.

## Battlesnake

Battlesnake is also supported — a turn-based snake game on an 11x11 grid:

```python
def decide_move(data: dict) -> str:
    # data["you"] - your snake (head, body, health, length)
    # data["board"] - board state (width, height, snakes, food)
    return "up"  # one of: up, down, left, right
```

```bash
snake-arena init --py              # Battlesnake template
snake-arena submit snake.py --name my-snake --model claude-sonnet-4
```
