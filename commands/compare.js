/**
 * `snake-arena compare` - Paired A/B comparator with deterministic seeds.
 */

const fs = require("fs");
const { testStrategy } = require("../lib/api");

const USAGE = `
  Usage: snake-arena compare <a.py|a.js> <b.py|b.js> [flags]

  Run paired benchmark tests for two candidates against identical opponents/seeds.

  Flags:
    --game TYPE         Game type: battlesnake or kurve
    --vs A,B            Opponent IDs (comma-separated). May be repeated.
    --count N           Repeat each seed set N times per opponent (default: 1)
    --seed N            Base seed (used when --seeds omitted)
    --seeds A,B,C       Explicit seed set
    --games N           Number of sequential seeds from --seed (default: 1)
    --json              Print raw compare output
`;

function detectLanguage(filePath) {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".js")) return "javascript";
  return null;
}

function validateEntrypoint(code, language) {
  if (language === "python") {
    return /^\s*def\s+decide_move\s*\(/m.test(code)
      ? null
      : "Python strategy must define: def decide_move(data: dict) -> str";
  }
  if (language === "javascript") {
    return /\bdecideMove\s*\(/m.test(code)
      ? null
      : "JavaScript strategy must define/export decideMove(data)";
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
  const positionals = [];
  const opponents = [];
  let game = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--game" && args[i + 1]) {
      game = args[++i];
    } else if (arg === "--vs" && args[i + 1]) {
      opponents.push(...args[++i].split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith("--vs=")) {
      opponents.push(...arg.slice("--vs=".length).split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }

  const seedsArg = (() => {
    const idx = args.indexOf("--seeds");
    if (idx >= 0 && args[idx + 1]) return args[idx + 1];
    const eq = args.find((a) => a.startsWith("--seeds="));
    return eq ? eq.split("=")[1] : null;
  })();

  return {
    aFile: positionals[0],
    bFile: positionals[1],
    game,
    opponents: Array.from(new Set(opponents)),
    count: parseIntFlag(args, "--count", 1),
    seed: parseIntFlag(args, "--seed", null),
    seeds: parseSeeds(seedsArg),
    games: parseIntFlag(args, "--games", 1),
    json,
  };
}

function resolveGame(fileA, fileB, explicitGame) {
  if (explicitGame) return explicitGame;
  const all = `${fileA} ${fileB}`.toLowerCase();
  return all.includes("kurve") ? "kurve" : "battlesnake";
}

function outcomeScore(row) {
  if (row.winner === "sub") return 1.0;
  if (row.winner === "draw") return 0.5;
  return 0.0;
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let kk = Math.min(k, n - k);
  let c = 1;
  for (let i = 1; i <= kk; i++) {
    c = (c * (n - kk + i)) / i;
  }
  return c;
}

function binomProb(n, k) {
  return choose(n, k) * Math.pow(0.5, n);
}

function twoSidedSignPvalue(winsA, winsB) {
  const n = winsA + winsB;
  if (n === 0) return 1;
  const tail = Math.min(winsA, winsB);
  let p = 0;
  for (let i = 0; i <= tail; i++) {
    p += binomProb(n, i);
  }
  p *= 2;
  return Math.min(1, p);
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(arr, m) {
  if (arr.length < 2) return 0;
  const v = arr.reduce((sum, x) => sum + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

async function runBenchmark(filePath, language, code, game, parsed) {
  const response = await testStrategy(code, language, game, {
    opponentIds: parsed.opponents.length > 0 ? parsed.opponents : undefined,
    count: parsed.count,
    seed: parsed.seed,
    seeds: parsed.seeds.length > 0 ? parsed.seeds : undefined,
    games: parsed.games,
    persistReplays: false,
  });
  const data = response.data;
  if (data?.ok === false) {
    const err = data.error || {};
    throw new Error(`[${err.code || "UNKNOWN"}] ${err.message || "benchmark failed"}`);
  }
  if (!data || !Array.isArray(data.results)) {
    throw new Error("unexpected benchmark response");
  }
  return {
    filePath,
    language,
    data,
  };
}

async function compare(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const parsed = parseArgs(args);
  if (!parsed.aFile || !parsed.bFile) {
    console.log(USAGE);
    process.exit(1);
  }

  if (!fs.existsSync(parsed.aFile)) {
    console.error(`File not found: ${parsed.aFile}`);
    process.exit(1);
  }
  if (!fs.existsSync(parsed.bFile)) {
    console.error(`File not found: ${parsed.bFile}`);
    process.exit(1);
  }
  if (parsed.count < 1 || parsed.games < 1) {
    console.error("Error: --count and --games must be >= 1");
    process.exit(1);
  }

  const langA = detectLanguage(parsed.aFile);
  const langB = detectLanguage(parsed.bFile);
  if (!langA || !langB) {
    console.error("Both files must end with .py or .js");
    process.exit(1);
  }

  const codeA = fs.readFileSync(parsed.aFile, "utf-8");
  const codeB = fs.readFileSync(parsed.bFile, "utf-8");
  const entryA = validateEntrypoint(codeA, langA);
  const entryB = validateEntrypoint(codeB, langB);
  if (entryA) {
    console.error(`Error in ${parsed.aFile}: ${entryA}`);
    process.exit(1);
  }
  if (entryB) {
    console.error(`Error in ${parsed.bFile}: ${entryB}`);
    process.exit(1);
  }

  const game = resolveGame(parsed.aFile, parsed.bFile, parsed.game);
  const gameName = game === "kurve" ? "Kurve" : "Battlesnake";
  console.log(`Running paired compare (${gameName})...`);

  const [aBench, bBench] = await Promise.all([
    runBenchmark(parsed.aFile, langA, codeA, game, parsed),
    runBenchmark(parsed.bFile, langB, codeB, game, parsed),
  ]);

  const byCaseA = new Map(aBench.data.results.map((r) => [r.case_id, r]));
  const byCaseB = new Map(bBench.data.results.map((r) => [r.case_id, r]));
  const sharedCases = Array.from(byCaseA.keys()).filter((k) => byCaseB.has(k));

  const deltas = [];
  let betterA = 0;
  let betterB = 0;
  const perOpponent = {};
  const styleBuckets = {};

  for (const caseId of sharedCases) {
    const ra = byCaseA.get(caseId);
    const rb = byCaseB.get(caseId);
    const sa = outcomeScore(ra);
    const sb = outcomeScore(rb);
    const delta = sa - sb;
    deltas.push(delta);

    if (delta > 0) betterA++;
    if (delta < 0) betterB++;

    const opp = ra.opponent_id;
    const style = ra.opponent_style || "generalist";
    if (!perOpponent[opp]) {
      perOpponent[opp] = {
        opponent_name: ra.opponent_name,
        opponent_style: style,
        deltas: [],
      };
    }
    perOpponent[opp].deltas.push(delta);

    if (!styleBuckets[style]) styleBuckets[style] = [];
    styleBuckets[style].push(delta);
  }

  const m = mean(deltas);
  const sd = stdev(deltas, m);
  const n = deltas.length;
  const ci95 = n > 1 ? 1.96 * (sd / Math.sqrt(n)) : 0;
  const pValue = twoSidedSignPvalue(betterA, betterB);

  const output = {
    game,
    candidate_a: parsed.aFile,
    candidate_b: parsed.bFile,
    cases: n,
    shared_cases: sharedCases,
    score_delta_mean: m,
    score_delta_ci95: [m - ci95, m + ci95],
    better_a: betterA,
    better_b: betterB,
    p_value: pValue,
    per_opponent: Object.values(perOpponent).map((o) => ({
      opponent_name: o.opponent_name,
      opponent_style: o.opponent_style,
      avg_delta: mean(o.deltas),
      cases: o.deltas.length,
    })),
    per_style: Object.keys(styleBuckets).map((style) => ({
      style,
      avg_delta: mean(styleBuckets[style]),
      cases: styleBuckets[style].length,
    })),
    non_game_errors: {
      a: (aBench.data.errors || []).length,
      b: (bBench.data.errors || []).length,
    },
  };

  if (parsed.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log("");
  console.log(`  Candidate A: ${parsed.aFile}`);
  console.log(`  Candidate B: ${parsed.bFile}`);
  console.log(`  Cases: ${n}`);
  console.log(
    `  Mean Score Delta (A-B): ${m.toFixed(4)}`
    + ` (95% CI ${ (m - ci95).toFixed(4) } to ${ (m + ci95).toFixed(4) })`
  );
  console.log(`  A better: ${betterA} | B better: ${betterB} | p=${pValue.toFixed(4)}`);
  console.log(
    `  Non-game errors: A=${output.non_game_errors.a}, B=${output.non_game_errors.b}`
  );

  console.log("");
  console.log("  Matchup Matrix:");
  for (const row of output.per_opponent) {
    console.log(
      `    ${row.opponent_name} [${row.opponent_style}] -> avg_delta=${row.avg_delta.toFixed(4)}`
      + ` (${row.cases} cases)`
    );
  }

  console.log("");
  console.log("  Style Report:");
  for (const row of output.per_style) {
    console.log(
      `    ${row.style}: avg_delta=${row.avg_delta.toFixed(4)} (${row.cases} cases)`
    );
  }

  console.log("");
  if (pValue < 0.05 && m > 0) {
    console.log(`  Verdict: Keep A (mean delta +${m.toFixed(4)}).`);
  } else if (pValue < 0.05 && m < 0) {
    console.log(`  Verdict: Keep B (mean delta ${m.toFixed(4)}).`);
  } else {
    console.log("  Verdict: No significant difference; run more seeds/opponents.");
  }
}

module.exports = { compare };
