/**
 * `snake-arena submit` - Submit a strategy to the public leaderboard.
 *
 * Supports both Battlesnake and Kurve games with AI metadata tracking.
 */

const crypto = require("crypto");
const fs = require("fs");
const { submitStrategy, getStatus } = require("../lib/api");

const USAGE = `
  Usage: snake-arena submit [file] [flags]

  Submit a strategy to the public leaderboard for ranked play.

  Flags:
    --name NAME       Display name for your strategy
    --model MODEL     AI model used (required, e.g. claude-sonnet-4)
    --game TYPE       Game type: battlesnake or kurve
    --parent ID       Parent strategy ID (for evolution lineage)
    --tool TOOL       Tool used (e.g. claude-code, cursor)
    --owner OWNER     Owner identifier
    --notes NOTES     Notes about this submission
    --public          Make code publicly visible
`;

function detectLanguage(filePath) {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".js")) return "javascript";
  return null;
}

function parseArgs(args) {
  let filePath = null;
  let name = null;
  let model = null;
  let notes = null;
  let parent = null;
  let tool = null;
  let game = null;
  let owner = null;
  let isPublic = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) {
      name = args[++i];
    } else if (args[i] === "--model" && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === "--notes" && args[i + 1]) {
      notes = args[++i];
    } else if (args[i] === "--parent" && args[i + 1]) {
      parent = args[++i];
    } else if (args[i] === "--tool" && args[i + 1]) {
      tool = args[++i];
    } else if (args[i] === "--game" && args[i + 1]) {
      game = args[++i];
    } else if (args[i] === "--owner" && args[i + 1]) {
      owner = args[++i];
    } else if (args[i] === "--public") {
      isPublic = true;
    } else if (!args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  return { filePath, name, model, notes, parent, tool, game, owner, isPublic };
}

function displayResult(result, gameName, game, ownershipToken) {
  if (!result.strategy_id || result.elo == null) {
    console.error(`Error: Unexpected response from server`);
    if (result.detail) console.error(`  Detail: ${result.detail}`);
    process.exit(1);
  }
  const rd = result.rating_deviation ? ` \u00b1 ${result.rating_deviation}` : "";

  console.log("  Results:");
  console.log(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(
    `  ELO:    ${result.elo}${rd}${result.provisional ? " (provisional)" : ""}`
  );
  console.log(`  Rank:   #${result.rank} (${gameName})`);
  console.log(`  Record: ${result.record}`);
  console.log(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log("");
  console.log(`  Ownership token: ${ownershipToken} (save this to prove ownership)`);

  if (result.matches && result.matches.length > 0) {
    console.log("");
    console.log("  Match results:");
    for (const match of result.matches) {
      const icon =
        match.series_result === "win"
          ? "W"
          : match.series_result === "loss"
            ? "L"
            : "D";
      const invalidNote = match.invalid_games ? ` [${match.invalid_games} invalid skipped]` : "";
      console.log(
        `    ${icon} vs ${match.opponent_name} (${match.wins}-${match.losses}-${match.draws})${invalidNote}`
      );
      if (match.warning) {
        console.log(`      \u26a0 ${match.warning}`);
      }
      if (icon === "L" && result.replays) {
        // Find a replay for this opponent
        const oppReplay = result.replays.find(r => r.includes(match.opponent_id));
        if (oppReplay) {
          console.log(`      See: npx snake-arena replay ${oppReplay} --summary`);
        }
      }
    }
  }

  // Show replay links
  if (result.replays && result.replays.length > 0) {
    console.log("");
    console.log("  Watch replays:");
    const byOpp = {};
    for (const rId of result.replays) {
      const vsIdx = rId.indexOf("_vs_");
      if (vsIdx === -1) continue;
      const rest = rId.slice(vsIdx + 4);
      const lastU = rest.lastIndexOf("_");
      const oppId = lastU > 0 ? rest.slice(0, lastU) : rest;
      if (!byOpp[oppId]) byOpp[oppId] = [];
      byOpp[oppId].push(rId);
    }
    for (const [oppId, rIds] of Object.entries(byOpp)) {
      const match = (result.matches || []).find(m => m.opponent_id === oppId);
      const oppName = match ? match.opponent_name : oppId;
      console.log(`    vs ${oppName}:`);
      for (let i = 0; i < rIds.length; i++) {
        console.log(`      Match ${i + 1}: npx github:mattarderne/snake-arena replay ${rIds[i]}`);
      }
    }
  }

  console.log("");

  const rank = result.rank;
  const elo = result.elo;
  const tweetText = encodeURIComponent(
    `My ${gameName} bot ranked #${rank} with ${elo} ELO on AI Arena!\n\nhttps://arena-web-vinext.matt-15d.workers.dev`
  );
  console.log(`  Share: https://twitter.com/intent/tweet?text=${tweetText}`);
  console.log("");
  console.log(`  Strategy: https://arena-web-vinext.matt-15d.workers.dev/strategy/${result.strategy_id}`);
  console.log(`  Leaderboard: npx github:mattarderne/snake-arena leaderboard${game !== "battlesnake" ? " --game " + game : ""}`);
}

async function submit(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  let { filePath, name, model, notes, parent, tool, game, owner, isPublic } = parseArgs(args);

  // Auto-read parent from .snake-arena-parent.json if --parent not provided
  const parentFile = ".snake-arena-parent.json";
  if (!parent && fs.existsSync(parentFile)) {
    try {
      const parentData = JSON.parse(fs.readFileSync(parentFile, "utf-8"));
      if (parentData.parent_id) {
        parent = parentData.parent_id;
        console.log(`  Lineage: evolving from ${parentData.parent_name || parentData.parent_id}`);
      }
    } catch {
      // Malformed file — ignore
    }
  }

  // Auto-detect file
  if (!filePath) {
    if (game === "kurve") {
      if (fs.existsSync("kurve.py")) filePath = "kurve.py";
      else if (fs.existsSync("kurve.js")) filePath = "kurve.js";
    } else {
      if (fs.existsSync("snake.py")) filePath = "snake.py";
      else if (fs.existsSync("snake.js")) filePath = "snake.js";
    }
    if (!filePath) {
      console.error(
        "No strategy file found. Specify a file or run `npx github:mattarderne/snake-arena init` first."
      );
      process.exit(1);
    }
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const language = detectLanguage(filePath);
  if (!language) {
    console.error("File must end with .py or .js");
    process.exit(1);
  }

  if (!model) {
    console.error(
      "Error: --model is required. Specify the AI model used (e.g. --model claude-sonnet-4)"
    );
    process.exit(1);
  }

  const code = fs.readFileSync(filePath, "utf-8");

  if (code.length > 50_000) {
    console.error("Strategy file too large (max 50KB)");
    process.exit(1);
  }

  // Auto-detect game from filename if not specified
  if (!game) {
    game = filePath.includes("kurve") ? "kurve" : "battlesnake";
  }

  if (!name) {
    name = filePath.replace(/\.(py|js)$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  // Generate ownership token
  const ownershipToken = crypto.randomBytes(6).toString("hex");

  const metadata = { game };
  metadata.model = model;
  metadata.ownership_token = ownershipToken;
  if (notes) metadata.notes = notes;
  if (parent) metadata.parent_id = parent;
  if (tool) metadata.tool = tool;
  if (owner) metadata.owner = owner;
  if (isPublic) metadata.is_public = true;

  const gameName = game === "kurve" ? "Kurve" : "Battlesnake";
  console.log(`Submitting ${filePath} as "${name}" (${language}, ${gameName})...`);
  console.log("");

  const spinChars = ["|", "/", "-", "\\"];
  let spinIdx = 0;

  try {
    // Phase 1: Submit — returns job_id immediately
    process.stdout.write(`  ${spinChars[0]} Submitting...`);
    const response = await submitStrategy(code, language, name, metadata);
    process.stdout.write("\r\x1B[K");

    if (response.status >= 400 || response.data.error) {
      let msg = response.data?.error || (typeof response.data === "string" ? response.data : `HTTP ${response.status}`);
      const retryAfter = response.headers?.["retry-after"];
      if (response.status === 429 && retryAfter) {
        const mins = Math.ceil(parseInt(retryAfter, 10) / 60);
        msg = `Rate limited — retry in ${mins} minute${mins !== 1 ? "s" : ""}`;
      }
      console.error(`Error: ${msg}`);
      process.exit(1);
    }

    // Show rate limit info
    const remaining = response.headers?.["x-ratelimit-remaining"];
    const limit = response.headers?.["x-ratelimit-limit"];
    const reset = response.headers?.["x-ratelimit-reset"];
    if (remaining != null && limit != null) {
      let resetStr = "";
      if (reset) {
        const resetMins = Math.ceil(parseInt(reset, 10) / 60);
        resetStr = `, resets in ${resetMins}m`;
      }
      console.log(`  Submitted (${remaining}/${limit} submits remaining${resetStr})`);
    }

    const { job_id } = response.data;
    if (!job_id) {
      // Fallback: server returned synchronous result (old Modal version)
      displayResult(response.data, gameName, game, ownershipToken);
      if (fs.existsSync(parentFile)) fs.unlinkSync(parentFile);
      return;
    }

    console.log("  Match results:");

    // Phase 2: Poll for progress every 3s, timeout after 5 minutes
    let lastMatchCount = 0;
    const maxPolls = 100; // 100 × 3s = 5 minutes
    let polls = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 3000));
      polls++;

      let job;
      try {
        const statusResponse = await getStatus(job_id);
        job = statusResponse.data;
      } catch (err) {
        if (polls >= maxPolls) {
          process.stdout.write("\r\x1B[K");
          console.error(`\n  Error: Timed out waiting for results (${err.message})`);
          process.exit(1);
        }
        process.stdout.write(`\r  ${spinChars[spinIdx++ % 4]} Waiting for backend...`);
        continue;
      }

      // Job not yet created on backend — keep waiting
      if (job.error === "Job not found") {
        if (polls >= 20) { // 60s without job file = something is wrong
          process.stdout.write("\r\x1B[K");
          console.error(`\n  Error: Backend never started processing this job`);
          process.exit(1);
        }
        process.stdout.write(`\r  ${spinChars[spinIdx++ % 4]} Waiting for backend to start...`);
        continue;
      }

      if (job.status === "failed") {
        process.stdout.write("\r\x1B[K");
        console.error(`\n  Error: ${job.error || "Unknown backend error"}`);
        process.exit(1);
      }

      // Print new matches incrementally
      const matches = job.matches || [];
      for (const m of matches.slice(lastMatchCount)) {
        process.stdout.write("\r\x1B[K");
        const icon = m.series_result === "win" ? "W" : m.series_result === "loss" ? "L" : "D";
        const invalidNote = m.invalid_games ? ` [${m.invalid_games} invalid skipped]` : "";
        console.log(`    ${icon} vs ${m.opponent_name} (${m.wins}-${m.losses}-${m.draws})${invalidNote}`);
        if (m.warning) {
          console.log(`      \u26a0 ${m.warning}`);
        }
        lastMatchCount++;
      }

      if (job.status === "complete") {
        process.stdout.write("\r\x1B[K");
        console.log("");
        displayResult(job.result, gameName, game, ownershipToken);
        if (fs.existsSync(parentFile)) fs.unlinkSync(parentFile);
        break;
      }

      if (polls >= maxPolls) {
        process.stdout.write("\r\x1B[K");
        console.error(`\n  Error: Timed out waiting for results after 5 minutes`);
        process.exit(1);
      }

      // Spinner with progress
      const progress = job.completed_opponents != null && job.total_opponents
        ? ` (${job.completed_opponents}/${job.total_opponents} opponents)`
        : "";
      process.stdout.write(`\r  ${spinChars[spinIdx++ % 4]} Playing matches...${progress}`);
    }
  } catch (err) {
    process.stdout.write("\r\x1B[K");
    console.error(`Submission failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { submit };
