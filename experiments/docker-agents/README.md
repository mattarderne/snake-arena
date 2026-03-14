# Docker Agent Experiments

Run LLM models in isolated Docker containers to autonomously build snake-arena strategies. Each model gets a capped budget, full bash access, and the pi-coding-agent framework.

## Architecture

```
run.py                    # Orchestrator — launches models in parallel Docker containers
├── agent-preflight       # Infrastructure: preflight checks, budget tracking, Docker lifecycle
├── eject_policies.py     # Domain eject policies: no-test-eject, P25 leaderboard check
├── post_run.py           # Post-run: snapshot strategies, speed check, benchmark, submit
└── tasks/                # AGENTS.md prompt variants (control, competitive, slim)
```

**1308-line monolith → 761 lines + reusable library** by extracting infrastructure into [agent-preflight](https://github.com/seadotdev/agent-preflight).

## Prerequisites

```bash
pip install agent-preflight    # or: pip install git+https://github.com/seadotdev/agent-preflight
```

Environment variables:
- `OPENROUTER_API_KEY` — OpenRouter API key
- `OR_ADMIN_KEY` — OpenRouter admin key (for provisioning per-model sub-keys with budget caps)
- `SNAKE_ARENA_TOKEN` — (optional) for leaderboard submission

Docker image `snake-arena-pi-experiment` must be built separately (see Dockerfile note).

## Usage

```bash
# Run all 8 models with $0.50 budget each
python run.py

# Run specific models
python run.py --model glm5 kimi claude-haiku

# Lower budget for testing
python run.py --budget 0.10 --model deepseek-v32

# Iterate on a seed strategy instead of building from scratch
python run.py --seed-strategy baseline_strategy.py

# Use competitive framing prompt
python run.py --agents-md tasks/AGENTS_competitive_slim.md

# Detailed per-action cost breakdown in budget.txt
python run.py --budget-mode detailed

# Preflight checks only (validate keys, balance, models, Docker)
python run.py --preflight-only
```

## Models

| Alias | Model ID | Notes |
|-------|----------|-------|
| kimi | moonshotai/kimi-k2-thinking | Thinking model |
| glm5 | z-ai/glm-5 | |
| deepseek-v32 | deepseek/deepseek-v3.2 | |
| minimax | minimax/minimax-m2.5 | |
| gemini-flash | google/gemini-2.5-flash | |
| claude-haiku | anthropic/claude-haiku-4.5 | |
| claude-sonnet | anthropic/claude-sonnet-4.6 | |
| qwen397b | qwen/qwen3.5-397b-a17b | MoE |

## How It Works

1. **Preflight** — validates account balance, model availability, Docker image, key provisioning
2. **Per-model provisioning** — creates a capped OpenRouter sub-key for each model
3. **Docker launch** — starts pi-coding-agent in RPC mode with per-model mounts
4. **Budget injection** — polls OpenRouter every 30s, writes `budget.txt` into container
5. **Event streaming** — captures JSONL events, snapshots every `strategy.py` write
6. **Eject policies** — kills containers that waste budget (no test after 20% spent, below P25 at 25%)
7. **Post-run** — speed-checks all snapshots, benchmarks against top 5 opponents, submits best

## Research

See [BUDGET_EXPERIMENT.md](BUDGET_EXPERIMENT.md) for findings on whether budget visibility changes model behavior (spoiler: it doesn't).
