# snake-arena

CLI for the [Snake Arena](https://arena-web-vinext.matt-15d.workers.dev) public Battlesnake leaderboard. Submit your snake strategy, compete for ELO, and watch replays.

## Installation

```bash
# Install from GitHub (until npm package is published)
npm install -g mattarderne/snake-arena
```

Or run directly with npx:

```bash
npx github:mattarderne/snake-arena init --py
```

## Quick Start

```bash
# Create a new strategy from template
snake-arena init --py      # Python (default)
snake-arena init --js      # JavaScript
snake-arena init --advanced # Python with flood fill

# Edit your strategy
# Open snake.py and implement decide_move()

# Test locally (requires python3 + battlesnake CLI)
snake-arena test

# Submit to the public leaderboard
snake-arena submit --name my-snake

# View rankings
snake-arena leaderboard
```

## Commands

### `init [--py|--js|--advanced]`

Creates a starter `snake.py` or `snake.js` in your current directory with a template strategy.

### `test [file]`

Tests your snake against a random baseline opponent. If `python3` and the `battlesnake` CLI binary are installed locally, runs 3 games locally. Otherwise falls back to cloud execution.

### `submit [file] [--name NAME] [--model MODEL] [--notes NOTES]`

Submits your strategy to the public leaderboard. Runs best-of-3 matches against the top opponents and calculates your ELO rating.

- `--name`: Display name on the leaderboard (defaults to filename)
- `--model`: AI model used to generate the strategy (shows AI badge)
- `--notes`: Optional notes about your strategy

### `leaderboard [--limit=N]`

Displays the current ELO rankings in your terminal.

### `replay <game-id>`

Opens a game replay in your browser.

## Writing a Strategy

### Python

Your file must contain a `decide_move(data)` function:

```python
def decide_move(data: dict) -> str:
    # data["you"] - your snake (head, body, health, length)
    # data["board"] - board state (width, height, snakes, food)
    # data["turn"] - current turn number
    return "up"  # one of: up, down, left, right
```

### JavaScript

Your file must export a `decideMove(data)` function:

```javascript
function decideMove(data) {
    return "up"; // one of: up, down, left, right
}
module.exports = { decideMove };
```

### Rules

- Board is 11x11. (0,0) is bottom-left.
- Your snake dies if it hits a wall, another snake, or itself.
- Eat food to grow and restore health (starts at 100, -1 per turn).
- Standard library only (no external packages).
- Max file size: 50KB.

## Local Development

To test locally you need:

1. **Python 3.8+**: `python3 --version`
2. **Battlesnake CLI**: `go install github.com/BattlesnakeOfficial/rules/cli/battlesnake@latest`

The CLI auto-detects both and falls back to cloud testing if unavailable.
