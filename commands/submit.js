/**
 * `snake-arena submit` - Submit a strategy to the public leaderboard.
 *
 * Supports both Battlesnake and Kurve games with AI metadata tracking.
 */

const fs = require("fs");
const { submitStrategy } = require("../lib/api");

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
    } else if (args[i] === "--public") {
      isPublic = true;
    } else if (!args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  return { filePath, name, model, notes, parent, tool, game, isPublic };
}

async function submit(args) {
  let { filePath, name, model, notes, parent, tool, game, isPublic } = parseArgs(args);

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
        "No strategy file found. Specify a file or run `snake-arena init` first."
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

  const metadata = { game };
  if (model) metadata.model = model;
  if (notes) metadata.notes = notes;
  if (parent) metadata.parent_id = parent;
  if (tool) metadata.tool = tool;
  if (isPublic) metadata.public_code = true;

  const gameName = game === "kurve" ? "Kurve" : "Battlesnake";
  console.log(`Submitting ${filePath} as "${name}" (${language}, ${gameName})...`);
  console.log("Running games against leaderboard opponents...");
  console.log("");

  // Show spinner
  const spinChars = ["|", "/", "-", "\\"];
  let spinIdx = 0;
  const spinner = setInterval(() => {
    process.stdout.write(`\r  ${spinChars[spinIdx++ % 4]} Playing matches...`);
  }, 200);

  try {
    const response = await submitStrategy(code, language, name, metadata);
    clearInterval(spinner);
    process.stdout.write("\r");

    if (response.data.error) {
      console.error(`Error: ${response.data.error}`);
      process.exit(1);
    }

    const result = response.data;
    const rd = result.rating_deviation ? ` ± ${result.rating_deviation}` : "";

    console.log("  Results:");
    console.log(`  ────────────────────────────────────`);
    console.log(
      `  ELO:    ${result.elo}${rd}${result.provisional ? " (provisional)" : ""}`
    );
    console.log(`  Rank:   #${result.rank} (${gameName})`);
    console.log(`  Record: ${result.record}`);
    console.log(`  ────────────────────────────────────`);

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
        console.log(
          `    ${icon} vs ${match.opponent_name} (${match.wins}-${match.losses}-${match.draws})`
        );
      }
    }

    // Show replay links
    if (result.replays && result.replays.length > 0) {
      console.log("");
      console.log("  Watch replays:");
      // Group by opponent
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
          console.log(`      Game ${i + 1}: npx snake-arena replay ${rIds[i]}`);
        }
      }
    }

    console.log("");

    // Tweet intent
    const rank = result.rank;
    const elo = result.elo;
    const tweetText = encodeURIComponent(
      `My ${gameName} bot ranked #${rank} with ${elo} ELO on AI Arena! 🎮🤖\n\nhttps://arena-web-vinext.matt-15d.workers.dev`
    );
    console.log(`  Share: https://twitter.com/intent/tweet?text=${tweetText}`);
    console.log("");
    console.log(`  Strategy: https://arena-web-vinext.matt-15d.workers.dev/strategy/${result.strategy_id}`);
    console.log(`  Leaderboard: npx snake-arena leaderboard${game !== "battlesnake" ? " --game " + game : ""}`);
  } catch (err) {
    clearInterval(spinner);
    process.stdout.write("\r");
    console.error(`Submission failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { submit };
