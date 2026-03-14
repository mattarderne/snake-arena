# Achtung die Kurve — Improve the Strategy

You have a working baseline strategy at `/workspace/output/strategy.py`. Your job: make it better.

**Budget: {BUDGET_USD} (~{BUDGET_TOKENS} output tokens). Pace yourself.**
Check `/workspace/output/budget.txt` for remaining balance. Finalise when <20% remains.

## Game rules

640x480 board. (0,0)=bottom-left. Both players move at 3 units/tick. Turning: +/-5°/tick.
Each player leaves a trail. Hit a wall, your trail, or opponent's trail = death. Last alive wins.

## decide_move(data) -> "left" | "right" | "straight"

```python
data["you"]["position"]    = {"x": float, "y": float}
data["you"]["direction"]   = float  # degrees, 0=right, 90=up
data["you"]["speed"]       = float  # 3.0
data["you"]["id"]          = str
data["opponent"]           # same fields as "you"
data["board"]["width"]     = 640
data["board"]["height"]    = 480
data["board"]["trails"]    = {player_id: [[x,y], ...]}  # all trail points
```

## Testing — IMPORTANT

**Always test against these 5 hard opponents.** This is the only test that matters:

```bash
snake-arena test /workspace/output/strategy.py --game kurve --quick \
  --vs v3-voronoi,deep-vortex-v6,skydiscover-v3,kurve-waller,deep-vortex-v3 2>&1
```

This runs 5 synchronous games (~5 seconds). The baseline gets **0% win rate** — all 5 opponents are strong.
Do NOT test against `random` or use `--quick` without `--vs` — those opponents are too weak to give useful signal.

**Your goal: maximize win rate AND survival turns against these 5.** Even if you lose, surviving longer (more turns) means your strategy is improving. Look at the per-game turn counts to measure progress.

## Workflow — ITERATE UNTIL BUDGET RUNS OUT

**Do NOT stop after one attempt.** Keep improving until your budget is nearly spent (<20% remaining).

1. Read the current strategy and test it against the 5 opponents
2. Analyze the per-game results: which opponents beat you? At what turn? How did you die (wall/trail)?
3. Write an improved strategy targeting the specific weaknesses you found
4. Test again — compare turn counts and wins to your previous version
5. **Repeat steps 2-4** until budget < 20%. Each iteration should target a specific failure mode.
6. For deeper understanding, read `/workspace/kurve_engine.py`

Check `/workspace/output/budget.txt` periodically to track spending.

**Always rewrite the full file** — don't use the edit tool, it fails on whitespace mismatches.
