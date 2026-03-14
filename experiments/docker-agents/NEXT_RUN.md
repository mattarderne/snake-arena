# Next Run Improvements

## 1. Parallelise models
Run all models concurrently instead of sequentially. Each model gets its own container.
- Use `concurrent.futures.ThreadPoolExecutor` — one thread per model
- Preflight still runs serially first
- Post-run (test + submit) can also be parallel
- Saves ~6× wall time

## 2. Pareto output
Auto-generate ELO vs cost Pareto plot at end of run.
- Fetch final ELO from leaderboard by submitted name
- Pull actual cost from OR sub-key usage (already measured)
- Plot with matplotlib: ELO on y-axis, cost on x-axis, Pareto frontier in red
- Save to run dir as `pareto.png` and print path

## 3. Smarter eject: performance vs leaderboard quartile
Replace "no test after 20% budget" with "strategy below leaderboard P25 after 25% budget".

Current logic: ejects if no test has been run at all after 20% spend.
New logic:
- At 25% budget spent, check best snapshot WR via full benchmark
- Fetch leaderboard, compute P25 ELO (bottom quartile)
- If model's best WR maps to below-P25 ELO → kill container
- This catches models that test but never improve (e.g. gemini-flash in run 1)

Implementation sketch:
```python
def _leaderboard_p25_win_rate() -> float:
    # fetch leaderboard, compute WR equivalent of P25 ELO
    ...

# In event loop, when spent >= 0.25 * KEY_LIMIT:
best_wr = max(_test_strategy(s) for s in snapshots)
if best_wr < _leaderboard_p25_win_rate():
    eject("below P25 after 25% budget")
```

---

# Run 2 Results (pi-docker-20260307-180745)

## Summary

7 models, $0.50 budget each, sequential execution (v1 harness).
Total cost: **$0.391** (11% of $3.50 total budget).
Run date: 2026-03-07 18:07–22:42 UTC (~4.5h wall time).

## Results Table

| Model | Cost | ELO | Rank | Snaps | Calls | Bench WR | $/ELO | Duration |
|---|---|---|---|---|---|---|---|---|
| claude-haiku-4.5 | $0.132 | 1216 | #28 | 13 | 62 | 80% | 0.109 | 20min |
| kimi-k2-thinking | $0.064 | 1165 | #35 | 13 | 81 | 20% | 0.055 | 41min |
| minimax-m2.5 | $0.047 | 1143 | #38 | 25 | 67 | 60% | 0.041 | 59min |
| glm-5 | $0.054 | 1108 | #43 | 10 | 39 | 40% | 0.049 | 38min |
| deepseek-v3.2 | $0.019 | 1096 | #47 | 16 | 66 | 60% | 0.017 | 53min |
| qwen3.5-397b | $0.071 | 1024 | #59 | 13 | 35 | 60% | 0.069 | 63min |
| gemini-2.5-flash | $0.004 | — | — | 0 | 2 | — | — | <1min |

## Cost Efficiency

Best $/ELO: **deepseek-v3.2** ($0.017/ELO point) — cheapest model, 16 snapshots, but weak strategies.
Best absolute: **claude-haiku** (ELO 1216, rank #28) — most expensive but highest quality.
Best value: **minimax** ($0.041/ELO) — 25 snapshots on low budget, solid iteration.

## Comparison: Run 1 vs Run 2

| Model | Run 1 ELO | Run 1 Rank | Run 2 ELO | Run 2 Rank | Delta |
|---|---|---|---|---|---|
| glm5 | 1457 | #1 | 1108 | #43 | -349 (wrong snap submitted) |
| minimax | 1372 | #9 | 1143 | #38 | -229 |
| qwen397b | 1271 | #23 | 1024 | #59 | -247 (too slow for server) |
| kimi | 1074 | #50 | 1165 | #35 | +91 |
| deepseek-v32 | 972 | #65 | 1096 | #47 | +124 |
| claude-haiku | — | — | 1216 | #28 | new |
| gemini-flash | — | — | — | — | failed both runs |

## Bugs Found (Fixed)

### 1. Speed check missing `id` and `speed` fields
The harness speed check used test data without `data["you"]["id"]` or `data["you"]["speed"]`.
The actual game engine includes both fields. haiku and glm5 wrote correct strategies using
`data["you"]["id"]` to look up their own trail, but the speed check rejected them as broken.
**Impact:** haiku (80% WR) and glm5 v9 (100% WR) were not submitted during the run.
**Fix:** Added `id` and `speed` to speed check test data in both v1 and v2.

### 2. Submit timeout too short (120s)
`snake-arena submit` queues the strategy quickly but then polls for match results against ~8
opponents. This takes 2-5 minutes. The harness used `timeout=120` which killed the process
before results returned. The strategy was already submitted server-side, but the harness
didn't record it.
**Impact:** deepseek, minimax, qwen397b all failed to record submission.
**Fix:** Timeout raised to 300s. Added `TimeoutExpired` handler that checks partial output
for "Submitted" confirmation.

### 3. AGENTS.md missing `id`/`speed` field documentation
Models that read the kurve_engine.py discovered the `id` field and used it correctly.
Models that relied only on AGENTS.md didn't know about it.
**Fix:** Added `id`, `speed`, and trail lookup example to AGENTS.md.

### 4. glm5 submitted wrong strategy
glm5 iterated 10 versions. v6-v10 scored 60-100% WR in-container but were all rejected by
the harness due to bug #1. The harness fell back to v5 (40% WR benchmark, 28% ELO WR).
glm5's best strategy (v9: "efficient collision detection", 100% in-container WR) was never
submitted.

### 5. Benchmark WR ≠ ELO WR
The `snake-arena test` benchmark runs 5 games against a fixed pack of ~5 opponents.
This gives noisy signal: deepseek got 60% benchmark but 22% ELO WR. kimi got 20% benchmark
but 47% ELO WR. The benchmark is useful as a sanity check but not a reliable predictor of
competitive performance.

## Timeout Analysis

Run 2 strategies are **not affected** by the 180s series timeout or 120s match timeout.
Draw counts across all run 2 strategies: 0-1 per model (negligible).

Strategies most affected by timeouts on the leaderboard:
- **kurve-waller**: 14 draws (15% draw rate), esp. vs deep-vortex variants
- **deep-vortex v2-v7**: 10-12 draws each (11-13%), mostly against each other
- **test-error-check / test-vortex-error**: 12 draws each (13%)
- **broken_cli_smoke**: 35 draws (100%) — broken strategy, all series 0-0-5D

These strategies' ELOs are contaminated by the 180s series timeout. After removing it
and raising the 120s match fuse, their rankings will shift. Our run 2 results are clean.

### Server timeout architecture
- Per-move: 1s SIGALRM per `decide_move()` call (executor-level, isolated per player)
- Per-match: `MATCH_FUNCTION_TIMEOUT_SECONDS=120` (Modal function timeout, 0.25 vCPU)
- Per-series: 180s (being removed)
- The 120s match timeout on 0.25 vCPU is tight for O(N) strategies in long games.
  At 2000 ticks × 2 players, each player gets ~30ms average budget per move.
  Strategies are fine locally but the 4x CPU reduction pushes cumulative time over the limit.

## Key Observations

1. **Budget injection worked.** All 6 models read budget.txt and referenced it in reasoning.
   haiku was most disciplined (8 reads, finalized at 10%: "I should finalize my best strategy").
   kimi paced itself (16 reads: "With 41% remaining, let me create one final strategy").
   qwen was least aware (1 read at 79%, never adapted). No model used >27% of its $0.50 budget.

2. **Models don't test speed locally** — all testing goes through `snake-arena test` (remote).
   They have no way to benchmark their own `decide_move()` performance. The AGENTS.md should
   add guidance on keeping strategies O(1) or O(log N) in trail length.

3. **Snapshot count ≠ quality.** minimax wrote 25 snapshots but scored lower than haiku (13
   snapshots). More iteration doesn't guarantee better results.

4. **`--quick` test is misleading.** It runs 1 game against a random opponent (always 100% WR).
   Models that rely on it for signal waste time iterating on noise. The full benchmark (5 games
   vs leaderboard pack) gives real signal but costs ~3min per run.

5. **gemini-flash failed both runs.** Needs investigation — likely a prompt or API format issue
   specific to the Gemini model on OpenRouter.
