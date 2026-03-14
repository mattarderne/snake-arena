#!/usr/bin/env python3
"""Snake-arena Docker agent experiment runner.

Runs LLM models in Docker containers via pi-coding-agent in RPC mode.
Each model gets a capped budget, full bash access, and builds a kurve
strategy from scratch (or iterates on a seed).

Uses agent-preflight for:
- Preflight validation (balance, models, Docker image, key provisioning)
- Per-model key provisioning with budget caps
- Budget tracking with periodic injection into containers
- Event streaming with structured JSONL logging
- Eject policies (budget exceeded, idle timeout)

Domain-specific logic lives in eject_policies.py and post_run.py.

Usage:
    python run.py                          # run all models
    python run.py --model glm5 kimi        # run specific aliases
    python run.py --budget 0.10            # override per-model budget
    python run.py --preflight-only         # just run preflight checks
    python run.py --seed-strategy baseline_strategy.py
    python run.py --agents-md tasks/AGENTS_competitive_slim.md
"""

import argparse
import json
import os
import shutil
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from agent_preflight import (
    image_exists,
    preflight,
    PreflightError,
    run_container,
)
from agent_preflight.eject import CompositeEject, BudgetExceededEject, IdleTimeoutEject
from agent_preflight.models import RunResult

from eject_policies import NoTestEject, P25Eject
from post_run import detect_test_on_event, snapshot_on_event, test_and_submit_best

# Thread-local logger (same pattern as agent-preflight's runner)
_thread_log = threading.local()


def _make_logger(log_path: Path, alias: str):
    lock = threading.Lock()
    def log(*args, **kwargs):
        msg = " ".join(str(a) for a in args)
        with lock:
            with open(log_path, "a") as f:
                f.write(msg + "\n")
            print(f"[{alias}] {msg}", flush=True)
    return log

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODELS = [
    ("moonshotai/kimi-k2-thinking",  "kimi"),
    ("z-ai/glm-5",                   "glm5"),
    ("deepseek/deepseek-v3.2",       "deepseek-v32"),
    ("minimax/minimax-m2.5",         "minimax"),
    ("google/gemini-2.5-flash",      "gemini-flash"),
    ("anthropic/claude-haiku-4.5",   "claude-haiku"),
    ("anthropic/claude-sonnet-4.6",  "claude-sonnet"),
    ("qwen/qwen3.5-397b-a17b",      "qwen397b"),
]

IMAGE_NAME = "snake-arena-pi-experiment"
EXPERIMENT_DIR = Path(__file__).parent
RUNS_DIR = EXPERIMENT_DIR / ".runs"
MAX_IDLE_SECS = 300

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

FULL_PROMPT = """\
Read /workspace/AGENTS.md to understand the task.
Then read /workspace/kurve_engine.py to understand the game engine.
Build the best kurve strategy you can.
Start by exploring — run commands, read files, understand the environment.
"""

SEED_PROMPT = """\
Read /workspace/AGENTS.md to understand the task.
There's already a working baseline strategy at /workspace/output/strategy.py.
Test it, understand it, then improve it. Focus on beating the leaderboard opponents.

IMPORTANT: Do NOT stop after one attempt. You must iterate multiple times:
test → analyze failures → improve → test again → repeat.
Keep going until your budget is nearly spent (<20% remaining).
Check /workspace/output/budget.txt to see how much budget you have left.
"""


# ---------------------------------------------------------------------------
# Env helpers
# ---------------------------------------------------------------------------

def _load_env_key(var: str) -> str:
    val = os.environ.get(var, "")
    if val:
        return val
    for env_path in [EXPERIMENT_DIR / ".env", Path.home() / ".env"]:
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith(f"{var}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def _load_snake_arena_token() -> str:
    token = os.environ.get("SNAKE_ARENA_TOKEN", "")
    if token:
        return token
    config_path = Path.home() / ".snake-arena" / "config.json"
    if config_path.exists():
        try:
            return json.loads(config_path.read_text()).get("token", "")
        except Exception:
            pass
    return ""


# ---------------------------------------------------------------------------
# Per-model event handler
# ---------------------------------------------------------------------------

def _make_event_handler(model_dir: Path):
    """Return an on_event callback that chains snapshot + test detection."""
    context = {"run_dir": str(model_dir), "tool_calls": 0, "has_tested": False}

    def handler(event: dict) -> None:
        if event.get("type") == "tool_execution_end":
            context["tool_calls"] = context.get("tool_calls", 0) + 1
        snapshot_on_event(event, context)
        detect_test_on_event(event, context)

    return handler


# ---------------------------------------------------------------------------
# AGENTS.md preparation
# ---------------------------------------------------------------------------

def _prepare_agents_md(
    agents_md_src: Path,
    model_dir: Path,
    budget_usd: float,
) -> Path:
    """Inject budget into AGENTS.md template and write to model's run dir."""
    content = agents_md_src.read_text()
    content = content.replace("{BUDGET_USD}", f"${budget_usd:.2f}")
    budget_tokens = int(budget_usd * 1_000_000)
    content = content.replace("{BUDGET_TOKENS}", f"{budget_tokens:,}")
    out_path = model_dir / "AGENTS.md"
    out_path.write_text(content)
    return out_path


# ---------------------------------------------------------------------------
# Single model run (uses agent-preflight's run_container directly)
# ---------------------------------------------------------------------------

def _run_one_model(
    model_id: str,
    alias: str,
    *,
    admin_key: str,
    budget_usd: float,
    budget_mode: str,
    run_dir: Path,
    run_id: str,
    agents_md_src: Path,
    seed_strategy: str | None,
    idle_timeout: float,
    token: str,
) -> RunResult:
    """Run a single model in a Docker container with per-model mounts."""
    model_dir = run_dir / alias
    (model_dir / "workspace").mkdir(parents=True, exist_ok=True)

    # Set up per-model logging
    log_fn = _make_logger(model_dir / "run.log", alias)
    _thread_log.fn = log_fn

    # Prepare per-model AGENTS.md with budget injected
    agents_md_path = _prepare_agents_md(agents_md_src, model_dir, budget_usd)

    # Pre-seed strategy if provided
    if seed_strategy:
        src = Path(seed_strategy)
        if src.exists():
            shutil.copy2(src, model_dir / "workspace" / "strategy.py")
            log_fn(f"[seed] Pre-seeded strategy from {src.name}")

    # Per-model mounts
    mounts = [
        (str(agents_md_path), "/workspace/AGENTS.md", "ro"),
        (str(model_dir / "workspace"), "/workspace/output", "rw"),
    ]

    # Env vars
    env = {}
    if token:
        env["SNAKE_ARENA_TOKEN"] = token

    # Build eject policy (domain-specific + infra)
    eject_policy = CompositeEject([
        BudgetExceededEject(),
        IdleTimeoutEject(timeout_s=idle_timeout),
        NoTestEject(),
        P25Eject(),
    ])

    # Choose prompt
    prompt = SEED_PROMPT if seed_strategy else FULL_PROMPT

    # Run via agent-preflight
    result = run_container(
        image_name=IMAGE_NAME,
        model_id=model_id,
        alias=alias,
        admin_key=admin_key,
        budget_usd=budget_usd,
        run_dir=run_dir,
        run_id=run_id,
        env=env,
        mounts=mounts,
        initial_prompt=prompt,
        container_args=["--model", model_id],
        eject_policy=eject_policy,
        on_event=_make_event_handler(model_dir),
        budget_mode=budget_mode,
        idle_timeout_s=idle_timeout,
        log_fn=log_fn,
    )

    # Post-run: test and submit best strategy
    if not result.error or "eject" in (result.error or ""):
        test_and_submit_best(run_dir, result, log_fn=log_fn)

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Snake-arena Docker agent experiment runner")
    parser.add_argument("--model", nargs="+", help="Run only these aliases")
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--skip-preflight", action="store_true")
    parser.add_argument("--budget", type=float, default=0.50,
                        help="USD budget per model (default 0.50)")
    parser.add_argument("--budget-mode", choices=["simple", "detailed"], default="simple")
    parser.add_argument("--agents-md", type=str, default=None,
                        help="Path to AGENTS.md template (default: tasks/AGENTS.md)")
    parser.add_argument("--seed-strategy", type=str, default=None,
                        help="Pre-seed workspace with this strategy file")
    parser.add_argument("--max-workers", type=int, default=8)
    parser.add_argument("--idle-timeout", type=float, default=MAX_IDLE_SECS)
    args = parser.parse_args()

    # Check Docker image
    if not image_exists(IMAGE_NAME):
        print(f"Docker image '{IMAGE_NAME}' not found.")
        print("Build it from the snake-arena-backend repo:")
        print(f"  docker build -t {IMAGE_NAME} -f experiments/pi-docker/Dockerfile .")
        sys.exit(1)

    # Load keys
    or_key = _load_env_key("OPENROUTER_API_KEY")
    admin_key = _load_env_key("OR_ADMIN_KEY")
    if not or_key:
        print("Error: OPENROUTER_API_KEY not set")
        sys.exit(1)
    if not admin_key:
        print("Error: OR_ADMIN_KEY not set (required for key provisioning)")
        sys.exit(1)

    # Select models
    models = MODELS
    if args.model:
        wanted = set(args.model)
        models = [(m, a) for m, a in MODELS if a in wanted]
        missing = wanted - {a for _, a in models}
        if missing:
            print(f"Unknown alias(es): {missing}. Options: {[a for _, a in MODELS]}")
            sys.exit(1)

    # Preflight checks via agent-preflight
    if not args.skip_preflight:
        try:
            preflight(
                admin_key=admin_key,
                or_key=or_key,
                models=[m for m, _ in models],
                budget_per_model=args.budget,
                docker_image=IMAGE_NAME,
            )
        except PreflightError as e:
            print(f"\nPreflight failed: {e}")
            print("Use --skip-preflight to override.\n")
            sys.exit(1)

    if args.preflight_only:
        return

    # Set up run
    run_id = f"pi-docker-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    agents_md_src = Path(args.agents_md) if args.agents_md else EXPERIMENT_DIR / "tasks" / "AGENTS.md"
    token = _load_snake_arena_token()

    print(f"\nStarting {len(models)} model(s) in parallel.")
    print(f"Run dir : {run_dir}")
    print(f"Budget  : ${args.budget:.2f} per model")
    print(f"Monitor : python3 -m agent_preflight status {run_id}\n")

    # Run all models in parallel using run_container directly (per-model mounts)
    results: list[RunResult] = []
    workers = min(len(models), args.max_workers)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                _run_one_model, model_id, alias,
                admin_key=admin_key,
                budget_usd=args.budget,
                budget_mode=args.budget_mode,
                run_dir=run_dir,
                run_id=run_id,
                agents_md_src=agents_md_src,
                seed_strategy=args.seed_strategy,
                idle_timeout=args.idle_timeout,
                token=token,
            ): alias
            for model_id, alias in models
        }
        for future in as_completed(futures):
            alias = futures[future]
            try:
                r = future.result()
                results.append(r)
                cost = r.cost_usd or 0
                dur = f"{r.duration_s // 60}m{r.duration_s % 60:02d}s"
                cache_str = f" cache={r.cache.hit_rate*100:.0f}%" if r.cache.request_count else ""
                status = r.error or "ok"
                print(f"  [done] {alias:<14} ${cost:.3f}  {dur}  tools={r.tool_calls}{cache_str}  {status}")
            except Exception as exc:
                print(f"  [done] {alias:<14} EXCEPTION: {exc}")

    # Final summary
    print(f"\n{'='*72}")
    print(f"  RUN COMPLETE: {run_id}")
    print(f"{'='*72}")
    print(f"  {'alias':<16}  {'cost':>7}  {'time':>7}  {'tools':>5}  {'cache':>6}  status")
    print(f"  {'-'*64}")
    total_cost = 0.0
    for r in sorted(results, key=lambda x: x.alias):
        cost = r.cost_usd or 0.0
        total_cost += cost
        dur = f"{r.duration_s // 60}m{r.duration_s % 60:02d}s"
        cache_str = f"{r.cache.hit_rate*100:.0f}%" if r.cache.request_count else "n/a"
        status = r.error or "ok"
        print(f"  {r.alias:<16}  ${cost:>6.3f}  {dur:>7}  {r.tool_calls:>5}  {cache_str:>6}  {status}")
    print(f"  {'TOTAL':<16}  ${total_cost:>6.3f}")
    print(f"\nArtifacts: {run_dir}\n")


if __name__ == "__main__":
    main()
