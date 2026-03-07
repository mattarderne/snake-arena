/**
 * `snake-arena test` - Deterministic benchmark testing against fixed seeds/opponents.
 */

const fs = require("fs");
const path = require("path");
const { API_BASE, API_MODE, testStrategy, getReplay, getStatus } = require("../lib/api");
const { CLI_VERSION } = require("../lib/version");
const { openReplayViewer, openMatchViewer } = require("../lib/viewer");

const USAGE = `
  Usage: snake-arena test [file] [flags]

  Run deterministic benchmark tests in the cloud.

  Flags:
    --game TYPE         Game type: battlesnake or kurve
    --vs A,B            Opponent IDs (comma-separated). May be repeated.
    --quick             Run a small synchronous quick test instead of async benchmark mode
    --count N           Repeat each seed set N times per opponent (default: 1)
    --seed N            Base seed (used when --seeds omitted)
    --seeds A,B,C       Explicit seed set
    --games N           Number of sequential seeds from --seed (default: 1)
    --trace             Include per-turn decision traces (if strategy provides them)
    --trace-sample N    Keep every Nth turn in trace output (default: 1)
    --view              Open returned replay artifacts in local viewer
    --save-dir DIR      Save replay artifacts as local JSON files
    --json              Print raw benchmark response
`;

function detectLanguage(filePath) {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".js")) return "javascript";
  return null;
}

function validateEntrypoint(code, language) {
  if (language === "python") {
    if (!/^\s*def\s+decide_move\s*\(/m.test(code)) {
      return "Python strategy must define: def decide_move(data: dict) -> str";
    }
    return null;
  }
  if (language === "javascript") {
    if (!/\bdecideMove\s*\(/m.test(code)) {
      return "JavaScript strategy must define/export decideMove(data)";
    }
    return null;
  }
  return "Unsupported language";
}

function parseIntFlag(args, name, fallback) {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) {
    const n = parseInt(args[idx + 1], 10);
    return Number.isFinite(n) ? n : fallback;
  }
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    const n = parseInt(eq.split("=")[1], 10);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseSeeds(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
}

function parseArgs(args) {
  let filePath = null;
  let game = null;
  let view = false;
  let saveDir = null;
  let json = false;
  let trace = false;
  let quick = false;
  const opponents = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--game" && args[i + 1]) {
      game = args[++i];
    } else if (arg === "--vs" && args[i + 1]) {
      opponents.push(...args[++i].split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith("--vs=")) {
      opponents.push(...arg.slice("--vs=".length).split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg === "--view") {
      view = true;
    } else if (arg === "--quick") {
      quick = true;
    } else if (arg === "--cloud" || arg === "--no-open") {
      // Legacy no-op flags kept for ergonomics during migration.
    } else if (arg === "--save-dir" && args[i + 1]) {
      saveDir = args[++i];
    } else if (
      (arg === "--count" ||
        arg === "--seed" ||
        arg === "--games" ||
        arg === "--trace-sample" ||
        arg === "--seeds") &&
      args[i + 1]
    ) {
      // Consume value flags so they aren't mis-read as file path positionals.
      i++;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--trace") {
      trace = true;
    } else if (!arg.startsWith("-") && !filePath) {
      filePath = arg;
    }
  }

  const seedsArg = (() => {
    const idx = args.indexOf("--seeds");
    if (idx >= 0 && args[idx + 1]) return args[idx + 1];
    const eq = args.find((a) => a.startsWith("--seeds="));
    return eq ? eq.split("=")[1] : null;
  })();

  return {
    filePath,
    game,
    opponents: Array.from(new Set(opponents)),
    count: parseIntFlag(args, "--count", 1),
    seed: parseIntFlag(args, "--seed", null),
    seeds: parseSeeds(seedsArg),
    games: parseIntFlag(args, "--games", 1),
    trace,
    traceSample: parseIntFlag(args, "--trace-sample", 1),
    quick,
    view,
    saveDir,
    json,
  };
}

function pickDefaultFile(game) {
  if (game === "kurve") {
    if (fs.existsSync("kurve.py")) return "kurve.py";
    if (fs.existsSync("kurve.js")) return "kurve.js";
  }
  if (fs.existsSync("snake.py")) return "snake.py";
  if (fs.existsSync("snake.js")) return "snake.js";
  if (fs.existsSync("kurve.py")) return "kurve.py";
  if (fs.existsSync("kurve.js")) return "kurve.js";
  return null;
}

function resolveGame(filePath, explicitGame) {
  if (explicitGame) return explicitGame;
  return filePath.toLowerCase().includes("kurve") ? "kurve" : "battlesnake";
}

function toPercent(v) {
  return `${Math.round(v * 100)}%`;
}

function modalVersionFrom(data) {
  return data?.versions?.modal_backend || "unknown";
}

function printLossDiagnostics(row) {
  const diag = row.loss_diagnostics?.p0 || row.loss_diagnostics?.sub;
  if (!diag || !diag.reason) return;
  const pos = diag.position ? ` @ (${diag.position.x}, ${diag.position.y})` : "";
  const heading = diag.heading != null ? ` heading ${diag.heading}` : "";
  console.log(
    `      loss: ${diag.reason} turn ${diag.turn ?? "?"}${pos}${heading}`
  );
}

async function loadReplayArtifacts(ids) {
  const replays = [];
  for (const id of ids) {
    try {
      const resp = await getReplay(id);
      const data = resp.data;
      if (
        data &&
        !data.error &&
        (Array.isArray(data.turns) || Array.isArray(data.frames))
      ) {
        replays.push(data);
      }
    } catch {
      // ignore individual failures
    }
  }
  return replays;
}

async function saveReplayArtifacts(ids, saveDir) {
  fs.mkdirSync(saveDir, { recursive: true });
  let saved = 0;
  for (const id of ids) {
    try {
      const resp = await getReplay(id);
      if (resp.data && !resp.data.error) {
        const outPath = path.join(saveDir, `${id}.json`);
        fs.writeFileSync(outPath, JSON.stringify(resp.data, null, 2));
        saved++;
      }
    } catch {
      // ignore individual failures
    }
  }
  return saved;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBenchmarkFailure(data) {
  if (data?.ok === false) return data;
  const rawError = data?.error;
  if (typeof rawError === "string") {
    return { ok: false, error: { code: "BENCHMARK_FAILED", message: rawError } };
  }
  if (rawError && typeof rawError === "object") {
    return { ok: false, error: rawError, versions: data?.versions };
  }
  return {
    ok: false,
    error: { code: "BENCHMARK_FAILED", message: "Benchmark job failed" },
    versions: data?.versions,
  };
}

async function waitForBenchmarkJob(jobId) {
  let lastProgress = "";

  while (true) {
    const response = await getStatus(jobId);
    const data = response.data;

    if (!data || typeof data !== "object") {
      return normalizeBenchmarkFailure({ error: "Benchmark status returned malformed data" });
    }

    if (data.status === "complete") {
      return data.result || data;
    }
    if (data.status === "failed") {
      return normalizeBenchmarkFailure(data);
    }

    const completedCases = data.completed_cases || 0;
    const totalCases = data.total_cases || 0;
    const summary = data.summary || {};
    const progress = `  Progress: ${completedCases}/${totalCases} cases | `
      + `${summary.wins || 0}W-${summary.losses || 0}L-${summary.draws || 0}D`
      + ` | errors=${summary.non_game_errors || 0}`;
    if (progress !== lastProgress) {
      console.log(progress);
      lastProgress = progress;
    }

    await sleep(1500);
  }
}

async function test(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const parsed = parseArgs(args);
  let filePath = parsed.filePath || pickDefaultFile(parsed.game);

  if (!filePath) {
    console.error("No strategy file found. Specify a file or run `snake-arena init` first.");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const language = detectLanguage(filePath);
  if (!language) {
    console.error("Could not detect language. File must end with .py or .js");
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf-8");
  const entryErr = validateEntrypoint(code, language);
  if (entryErr) {
    console.error(`Error: ${entryErr}`);
    process.exit(1);
  }

  const game = resolveGame(filePath, parsed.game);
  const gameName = game === "kurve" ? "Kurve" : "Battlesnake";
  const seeds = parsed.seeds.length > 0 ? parsed.seeds : undefined;

  if (parsed.count < 1 || parsed.games < 1 || parsed.traceSample < 1) {
    console.error("Error: --count, --games, and --trace-sample must be >= 1");
    process.exit(1);
  }

  console.log(`Benchmarking ${filePath} (${language}, ${gameName})...`);

  const opts = {
    opponentIds: parsed.opponents.length > 0 ? parsed.opponents : undefined,
    count: parsed.count,
    seed: parsed.seed,
    seeds,
    games: parsed.games,
    mode: parsed.quick ? "quick" : "benchmark",
    trace: parsed.trace,
    traceSample: parsed.traceSample,
    persistReplays: true,
  };

  const response = await testStrategy(code, language, game, opts);
  let data = response.data;

  if (data && typeof data === "object" && data.async === true && data.job_id) {
    console.log(`  Queued benchmark job ${data.job_id}`);
    if (data.benchmark_pack?.version) {
      console.log(`  Benchmark pack: ${data.benchmark_pack.version}`);
    }
    data = await waitForBenchmarkJob(data.job_id);
  }

  if (data?.ok === false) {
    const err = data.error || {};
    let detail = "";
    const retryAfter = response.headers?.["retry-after"];
    if (response.status === 429 && retryAfter) {
      const secs = parseInt(retryAfter, 10);
      if (Number.isFinite(secs) && secs > 0) {
        detail = ` Retry in about ${secs}s.`;
      }
    }
    console.error(`Error [${err.code || "UNKNOWN"}]: ${(err.message || "Test failed")}${detail}`);
    console.error(`Versions: cli=${CLI_VERSION} modal=${modalVersionFrom(data)} api=${API_BASE} mode=${API_MODE}`);
    process.exit(1);
  }
  if (!data || (data.ok !== true && !data.summary)) {
    console.error("Error: unexpected benchmark response");
    process.exit(1);
  }

  if (parsed.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const summary = data.summary || {};
  console.log("");
  console.log(`  Versions: cli=${CLI_VERSION} modal=${modalVersionFrom(data)} api=${API_BASE} mode=${API_MODE}`);
  if (data.benchmark_pack?.version) {
    console.log(`  Benchmark pack: ${data.benchmark_pack.version}`);
  }
  console.log(
    `  Summary: ${summary.wins || 0}W-${summary.losses || 0}L-${summary.draws || 0}D`
    + ` | games=${summary.games || 0}`
    + ` | win_rate=${toPercent(summary.win_rate || 0)}`
    + ` | avg_score=${(summary.avg_score ?? 0).toFixed(3)}`
    + ` | non_game_errors=${summary.non_game_errors || 0}`
  );
  console.log(`  Seeds: ${(data.seeds || []).join(", ") || "(none)"}`);
  console.log(`  Count per seed set: ${data.count || 1}`);

  if (Array.isArray(data.by_opponent) && data.by_opponent.length > 0) {
    console.log("");
    console.log("  Matchup Matrix:");
    for (const row of data.by_opponent) {
      console.log(
        `    ${row.opponent_name} [${row.opponent_style}]`
        + ` -> ${row.wins}W-${row.losses}L-${row.draws}D`
        + ` (${toPercent(row.win_rate || 0)} WR, errors=${row.errors || 0})`
      );
    }
  }

  if (Array.isArray(data.results) && data.results.length > 0) {
    console.log("");
    console.log("  Per-Game:");
    for (const row of data.results) {
      const icon = row.winner === "sub" ? "W" : row.winner === "opp" ? "L" : "D";
      console.log(
        `    ${icon} vs ${row.opponent_name} [seed=${row.base_seed}, run=${row.repeat}]`
        + ` (${row.turns} turns)`
        + (row.artifact_id ? ` artifact=${row.artifact_id}` : "")
      );
      if (icon === "L") {
        printLossDiagnostics(row);
      }
      if (parsed.trace && Array.isArray(row.decision_traces) && row.decision_traces.length > 0) {
        const sample = row.decision_traces
          .filter((t) => t.player_id === "p0")
          .slice(0, 5);
        for (const t of sample) {
          const alts = (t.alternatives || [])
            .slice(0, 2)
            .map((a) => `${a.move}:${a.score == null ? "?" : a.score}`)
            .join(", ");
          const features = t.feature_scores
            ? Object.entries(t.feature_scores).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(", ")
            : "";
          console.log(
            `      trace t=${t.turn} move=${t.move} alt=[${alts}]`
            + (features ? ` features={${features}}` : "")
          );
        }
      }
    }
  }

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    console.log("");
    console.log("  Non-Game Errors:");
    for (const err of data.errors) {
      console.log(
        `    ${err.code} vs ${err.opponent_name} [seed=${err.base_seed}, run=${err.repeat}]: ${err.message}`
      );
    }
  }

  const replayIds = Array.isArray(data.replay_ids) ? data.replay_ids : [];
  if (parsed.saveDir && replayIds.length > 0) {
    const saved = await saveReplayArtifacts(replayIds, path.resolve(parsed.saveDir));
    console.log(`\n  Saved ${saved}/${replayIds.length} replay artifacts to ${path.resolve(parsed.saveDir)}`);
  }

  if (parsed.view && replayIds.length > 0) {
    const replayData = await loadReplayArtifacts(replayIds.slice(0, 20));
    if (replayData.length === 1) {
      openReplayViewer(replayData[0], { prefix: "replay" });
    } else if (replayData.length > 1) {
      openMatchViewer(replayData, { prefix: "benchmark" });
    }
  }
}

module.exports = { test };
