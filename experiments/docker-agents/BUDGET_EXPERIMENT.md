# Budget-Aware AI Agents: Does Cost Visibility Change Model Behavior?

## Research Question

When AI models are given a task with a fixed budget, does giving them visibility into their spending change their behavior or improve efficiency?

## Experiment Design

### Setup
- 7 LLM models run via OpenRouter in Docker containers with bash access
- Each model gets the same task: improve a snake game (Achtung die Kurve) strategy
- Models have access to `snake-arena test` to benchmark against opponents
- A `budget.txt` file is injected into each container every 30s with remaining balance
- OpenRouter sub-keys enforce per-model budget caps

### Three Conditions

1. **Control** — Simple one-line budget balance (`$0.086 remaining of $0.15 (57% left)`)
2. **Detailed** — Per-action cost breakdown with averages and estimated remaining actions
3. **Competitive** — Same as control but framed as: "You are one of 7 models competing head-to-head. Same task, same budget."

### Models Tested
minimax-m2.5, deepseek-v3.2, glm-5, gemini-2.5-flash, claude-haiku-4.5, kimi-k2-thinking, qwen3.5-397b, claude-sonnet-4.6

## Key Findings

### 1. Budget framing has no measurable effect on output quality

| Condition | Avg WR (old opponents) | Total Cost |
|-----------|----------------------|------------|
| Control | 54% | $0.78 |
| Detailed | 54% | $0.75 |
| Competitive | 51% | $0.52 |

All three conditions produced statistically identical results. The competitive condition was slightly lower, but two models crashed early due to Docker exec timeouts.

### 2. Model identity dominates everything

| Model | Control | Detailed | Competitive | Spread |
|-------|---------|----------|-------------|--------|
| deepseek-v32 | 40% | 40% | 40% | 0pp |
| kimi | 40% | 40% | 40% | 0pp |
| minimax | 60% | 60% | 60% | 0pp |
| glm5 | 80% | 40% | 100% | 60pp |
| claude-haiku | 40% | 80% | 40% | 40pp |

Some models (deepseek, kimi, minimax) are perfectly consistent across conditions. Others (glm5, haiku) show high variance, but it's random — not correlated with budget condition.

### 3. Most models never actively check their budget

Across 21 model runs, budget.txt was actively read 0-4 times per run. Most models read it once early and never again. Only in the competitive condition did minimax (3 reads) and kimi (3 reads) check multiple times.

**Zero models changed their pacing strategy based on budget information.** They iterate until the agent framework stops them or the budget is exhausted.

### 4. The testing signal was too coarse to detect improvement

The original top-5 opponent set included 2 weak opponents that self-destruct at turn 41, giving a 40% floor. With 5 games at 1 seed, the only possible WR values were 0/20/40/60/80/100%. Models ran 50-200 test iterations seeing `40% → 40% → 40%` with no useful gradient.

**This was the biggest problem in the experiment** — models couldn't tell if their changes were improvements.

## Experiment Improvements (v2)

### Harder opponent set
Replaced 2 self-destructing opponents with genuinely strong ones:
- **Before**: v3-voronoi, v4-deepsearch, harness_strategies_v5_str, skydiscover-v3, deep-vortex-v6
  - Baseline `return "straight"` → **40% WR** (2 free wins)
- **After**: v3-voronoi, deep-vortex-v6, skydiscover-v3, kurve-waller, deep-vortex-v3
  - Baseline `return "straight"` → **0% WR** (all 5 are hard)

### Survival turns as signal
Added guidance in AGENTS.md: "Even if you lose, surviving longer (more turns) means your strategy is improving." This gives models a continuous gradient rather than binary W/L.

### Explicit iteration instructions
Sonnet was doing one-shot (write strategy, test once, stop). Added explicit "ITERATE UNTIL BUDGET RUNS OUT" instructions in both the AGENTS.md and the seed prompt. This increased Sonnet from 1 iteration to 5+ with genuine iterative debugging.

### Claude Sonnet validation run
With improvements applied, Sonnet ($0.35 budget, detailed mode):
- **5 iterations** with genuine problem-solving (profiling, debugging timeouts, analyzing per-opponent losses)
- **60% WR** against hard opponents (from 0% baseline)
- Actively checked budget, referenced it in reasoning ("4% budget left, let me finalize")
- Survived 241-466 turns vs 139 for baseline
- Cost: ~$0.19 of $0.35 budget

## Technical Fixes Applied

| Issue | Impact | Fix |
|-------|--------|-----|
| `_test_strategy()` used `--count 3` with `--quick` | All post-run evaluations failed (`INVALID_QUICK_TEST_CONFIG`) | Removed `--count 3` |
| Preflight Modal test timeout 30s | Could fail on cold starts | Bumped to 60s |
| Error message referenced "240s" timeout | Confusing | Fixed to match actual 60s |
| OpenRouter key limits are soft | Models spent over budget | Added hard kill in event loop via `BudgetTracker.exceeded` |
| 2 weak opponents inflated baseline to 40% | No signal gradient | Replaced with hard opponents (0% baseline) |
| Sonnet stopped after 1 iteration | Wasted 86% of budget | Added explicit "ITERATE" in seed prompt and AGENTS.md |

## Cost Summary

| Run | Models | Budget/model | Total |
|-----|--------|-------------|-------|
| Control (old opponents) | 7 | $0.15 | $0.78 |
| Detailed (old opponents) | 7 | $0.15 | $0.75 |
| Competitive (old opponents) | 7 | $0.15 | $0.52 |
| Sonnet validation (new opponents) | 1 | $0.35 | $0.19 |
| **Total experiment cost** | | | **~$2.24** |

## Next Steps

1. **Rerun all 3 conditions with hard opponents** — The original runs used the inflated 40% baseline. Need clean data with the 0% baseline and iteration-forcing prompt.

2. **Add Sonnet to the model roster** — Higher-reasoning models show qualitatively different behavior (active profiling, per-opponent analysis, regression debugging). Worth comparing against the cheaper models.

3. **Increase test games** — Consider using benchmark mode with 10-20 games instead of `--quick` (5 games). The WR granularity (0/20/40/60/80/100%) may still be too coarse for detecting small improvements.

4. **Track survival turns as a metric** — Parse per-game turn counts from test output and store in summary.json. This gives a continuous signal even when WR doesn't change.

5. **Budget-aware pacing test** — Try a condition where the budget is much larger ($1-2) but the task is harder. At $0.15-0.35, most models finish in 3-5 minutes — not enough time for pacing to matter. A longer runway might reveal whether models that check budget actually pace differently.

6. **Conversation-level analysis** — Look at whether models that reference budget in their reasoning make different kinds of changes (conservative vs. exploratory) compared to models that ignore it entirely.
