/**
 * `snake-arena submit` - Submit a snake to the public leaderboard.
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

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) {
      name = args[++i];
    } else if (args[i] === "--model" && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === "--notes" && args[i + 1]) {
      notes = args[++i];
    } else if (!args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  return { filePath, name, model, notes };
}

async function submit(args) {
  let { filePath, name, model, notes } = parseArgs(args);

  // Auto-detect file
  if (!filePath) {
    if (fs.existsSync("snake.py")) filePath = "snake.py";
    else if (fs.existsSync("snake.js")) filePath = "snake.js";
    else {
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

  if (!name) {
    // Use filename without extension as name
    name = filePath.replace(/\.(py|js)$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  const metadata = {};
  if (model) metadata.model = model;
  if (notes) metadata.notes = notes;

  console.log(`Submitting ${filePath} as "${name}" (${language})...`);
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

    console.log("  Results:");
    console.log(`  ────────────────────────────────────`);
    console.log(
      `  ELO:    ${result.elo}${result.provisional ? " (provisional)" : ""}`
    );
    console.log(`  Rank:   #${result.rank}`);
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

    console.log("");
    console.log("  View leaderboard: npx snake-arena leaderboard");
  } catch (err) {
    clearInterval(spinner);
    process.stdout.write("\r");
    console.error(`Submission failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { submit };
