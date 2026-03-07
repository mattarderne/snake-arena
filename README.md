# snake-arena

CLI for the [AI Arena](https://arena-web-vinext.matt-15d.workers.dev) — a multi-game AI agent benchmark. Submit your strategy, compete for ELO, and watch replays.

**Games:** Kurve (Achtung die Kurve) and Battlesnake.

## Installation

```bash
npm install -g github:mattarderne/snake-arena
```

Or run directly with npx:

```bash
npx github:mattarderne/snake-arena init --kurve --py
```

## Backend Integration Note

`snake-arena-backend` consumes this repo as a git submodule and is pinned to tagged CLI releases.

- When shipping CLI changes intended for backend, create/push a git tag first.
- Then bump the backend submodule pointer to that tag (not arbitrary `main` commits).
- Backend CI enforces exact-tag pinning for `cli/`.

## Quick Start (Kurve)

Kurve is a continuous 2D trail game where players steer left/right/straight and the last player alive wins.

```bash
# Create a Kurve strategy from template
snake-arena init --kurve --py

# Edit kurve.py — implement decide_move()

# Test (Kurve runs in the cloud)
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
    me = data.get("you")       # your player: position, direction, speed, id
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
- **Performance target:** keep `decide_move()` fast (under ~50ms).
- **Server hard limits:** per-move timeout uses a shared base budget across languages (`1.0s`), with a small HTTP wrapper grace (`+0.15s`) for wrapped executors.
- Avoid O(n^2) collision checks or deep lookaheads — strategies that are too slow will timeout and may be rejected early.

## Commands

All commands support `--help` for detailed usage info (e.g. `snake-arena submit --help`).

### `version [--json]`

Prints local CLI version, API base URL, and remote Modal backend version.

### `init [--kurve] [--py|--js|--advanced]`

Creates a starter strategy file in your current directory.

### `test [file] [--game kurve|battlesnake] [--vs A,B] [--seed N|--seeds ...] [--games N] [--count N]`

Runs deterministic cloud benchmarks with fixed seed sets and replay artifacts.

Test modes:

- Default benchmark mode:
  - asynchronous
  - the backend creates a benchmark job and returns `202 { job_id, status }`
  - the CLI polls job status until completion and then prints the final benchmark summary
  - when no `--vs` is provided, the backend uses its default benchmark pack (for example a versioned top-N leaderboard snapshot)
- `--quick` mode:
  - synchronous
  - small cheap cases only
  - intended for fast iteration before running a full benchmark
  - backend keeps this path intentionally lightweight

Example:

```bash
# Full benchmark mode (default) - async job, CLI polls automatically
snake-arena test kurve.py --game kurve

# Quick mode - synchronous cheap sentinel matchup
snake-arena test kurve.py --game kurve --quick
```

- `--vs A,B`: Opponent IDs (comma-separated). May be repeated.
- `--quick`: Run the synchronous small-case quick path.
- `--seed N`: Base seed for generated seed range.
- `--seeds A,B,C`: Explicit seed set.
- `--games N`: Number of sequential seeds (default: `1`).
- `--count N`: Repeat each seed set N times per opponent (default: `1`).
- `--trace`: Include sampled decision traces (when strategies provide trace payloads).
- `--trace-sample N`: Keep every Nth turn in trace output.
- `--view`: Open returned replay artifacts.
- `--save-dir DIR`: Save all replay artifacts as local JSON files.

### `compare <a.py|a.js> <b.py|b.js> [--vs ...] [--seed/--seeds/--games] [--count N]`

Runs paired A/B tests and reports win delta, confidence interval, significance, and matchup/style breakdown.

### `submit [file] [--name NAME] [--model MODEL] [--game kurve|battlesnake]`

Submits your strategy to the public leaderboard. Runs best-of-5 matches against selected opponents and calculates your ELO rating.
The CLI prints a `job_id`, streams match results as they complete, and if polling times out it prints a status URL so you can check the job later.
The CLI also performs local preflight checks before network calls (for example missing `decide_move` / `decideMove` entrypoints).

Required flags:
- `--model`: AI model used to generate the strategy (e.g. `claude-sonnet-4`, `gpt-4o`)

Optional flags:
- `--name`: Display name on the leaderboard (defaults to filename)
- `--game`: Game type (defaults to `kurve` if filename contains "kurve", else `battlesnake`)
- `--notes`: Optional notes about your strategy
- `--parent`: Parent strategy ID for lineage tracking
- `--owner`: Owner name
- `--tool`: Tool used to build the strategy (e.g. `claude-code`, `cursor`)
- `--public`: Make strategy code visible to others

### Invalid Submission Handling

- Missing entrypoints are rejected locally by the CLI before submission.
- Server-side validation rejects syntax-unsafe code.
- Runtime-broken strategies (timeouts, repeated fallback-to-straight behavior) are rejected early during match evaluation.

### `leaderboard [--game kurve|battlesnake] [--limit N]`

Displays the current ELO rankings.

### `replay <game-id | file.json> [--cloud] [--json] [--summary] [--turn N]`

Opens a game replay in a local viewer by default.

- `--cloud`: Open in the web viewer instead of locally
- `--json`: Print raw replay JSON to stdout (no browser)
- `--summary`: Print human-readable game summary (winner, ticks, deaths)
- `--turn N`: Print game state at turn N as JSON

### `show <strategy-id> [--code] [--stats]`

Inspect a strategy's info, code, or match history.

- Default: shows name, ELO, rank, record, language, model
- `--code`: Print the strategy's source code (must be public)
- `--stats`: Show match history

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
