# Achtung die Kurve — Strategy Challenge

You are competing in Achtung die Kurve, a 2-player continuous trail game.
Your goal is to reach the top of the leaderboard.

**Budget: {BUDGET_USD} (~{BUDGET_TOKENS} output tokens). Pace yourself.**

Check `/workspace/output/budget.txt` periodically — it is updated every ~30s with your remaining balance.
When less than 20% remains, finalise your best strategy and stop iterating.

## Game rules

- Board: 640x480 continuous coordinates. (0,0) is bottom-left.
- Both players move simultaneously at constant speed (3 units/tick).
- Direction: 0°=right, 90°=up. Turning adds/subtracts 5° per tick.
- Each player leaves a trail of points behind them (collision radius ~3 units).
- You die by hitting: a wall, your own trail, or the opponent's trail.
- Last player alive wins. The #1 death cause is trail collision.

## Your strategy

Write `/workspace/output/strategy.py` implementing:

```python
def decide_move(data: dict) -> str:
    # data["you"]["id"]         = str   (your player_id, e.g. "0")
    # data["you"]["position"]   = {"x": float, "y": float}
    # data["you"]["direction"]  = float  (degrees, 0=right, 90=up)
    # data["you"]["speed"]      = float  (3.0 units/tick)
    # data["you"]["alive"]      = bool
    # data["opponent"]["id"], ["position"], ["direction"], ["speed"], ["alive"]
    # data["board"]["width"]    = 640
    # data["board"]["height"]   = 480
    # data["board"]["trails"]   = dict mapping player_id -> list of [x, y] points
    #   e.g. data["board"]["trails"][data["you"]["id"]]  -> your own trail points
    return "left"  # or "right" or "straight"
```

Start by reading `/workspace/kurve_engine.py` to understand exactly how movement, trails,
and collision detection work. Keep `decide_move()` under 1s per call.

## Testing

```bash
# Fast iteration (2-3s): use --quick for rapid feedback while developing
snake-arena test /workspace/output/strategy.py --game kurve --quick 2>&1

# Full benchmark (2-3min): runs against top leaderboard opponents
snake-arena test /workspace/output/strategy.py --game kurve 2>&1
```

Test early and often. Use `--quick` while iterating; run the full benchmark before you're done.

## Submission

**You do not need to submit.** The harness will automatically test every version
of `strategy.py` you write and submit the best-performing one on your behalf.
Focus entirely on writing and improving your strategy.

## Environment notes

- Write to `/workspace/output/strategy.py` — `/workspace/output/` is the mounted output directory
- Append `2>&1` to bash commands to capture error output
- **Always fix syntax errors with a full `write`, not the `edit` tool.** The edit tool requires byte-perfect matching and will silently fail if whitespace differs. When in doubt, rewrite the whole file.
- **Validate syntax before running tests:** `python3 -c "import ast; ast.parse(open('/workspace/output/strategy.py').read()); print('ok')" 2>&1`
