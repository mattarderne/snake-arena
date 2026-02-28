/**
 * `snake-arena test` - Test a strategy locally or via cloud.
 *
 * Supports both Battlesnake and Kurve games.
 */

const fs = require("fs");
const path = require("path");
const { detectPython, detectBattlesnake } = require("../lib/detect");
const { runLocalGame } = require("../lib/local-runner");
const { testStrategy } = require("../lib/api");

function detectLanguage(filePath) {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".js")) return "javascript";
  return null;
}

function parseArgs(args) {
  let filePath = null;
  let game = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--game" && args[i + 1]) {
      game = args[++i];
    } else if (!args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  return { filePath, game };
}

async function test(args) {
  let { filePath, game } = parseArgs(args);

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
      console.error("No strategy file found. Specify a file or run `snake-arena init` first.");
      process.exit(1);
    }
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

  // Auto-detect game from filename if not specified
  if (!game) {
    game = filePath.includes("kurve") ? "kurve" : "battlesnake";
  }

  const gameName = game === "kurve" ? "Kurve" : "Battlesnake";
  console.log(`Testing ${filePath} (${language}, ${gameName})...`);
  console.log("");

  // Kurve: always use cloud (no local battlesnake CLI needed)
  if (game === "kurve") {
    console.log("Running in the cloud...");
    console.log("");

    const code = fs.readFileSync(filePath, "utf-8");
    const response = await testStrategy(code, language, game);

    if (response.data.error) {
      console.error(`Error: ${response.data.error}`);
      process.exit(1);
    }

    const result = response.data;
    const icon =
      result.winner === "sub" ? "WIN" : result.winner === "draw" ? "DRAW" : "LOSS";
    console.log(`  Result: ${icon} (${result.turns} ticks) vs Random Kurve opponent`);
    if (icon === "WIN") {
      console.log(`\nLooking good! Try: npx snake-arena submit ${filePath} --game kurve`);
    }
    return;
  }

  // Battlesnake: try local test first
  const pythonBin = detectPython();
  const battlesnakeBin = detectBattlesnake();

  if (pythonBin && battlesnakeBin) {
    console.log("Running locally (python + battlesnake CLI detected)");
    console.log("");

    const opponentPath = path.join(__dirname, "..", "templates", "random_valid.py");
    const results = [];

    for (let i = 0; i < 3; i++) {
      process.stdout.write(`  Game ${i + 1}/3... `);
      try {
        const result = await runLocalGame(
          filePath, language, pythonBin, battlesnakeBin, opponentPath
        );
        results.push(result);
        const icon = result.winner === "you" ? "W" : result.winner === "draw" ? "D" : "L";
        console.log(`${icon} (${result.turns} turns)`);
      } catch (err) {
        console.log(`Error: ${err.message}`);
        results.push({ winner: "error", turns: 0 });
      }
    }

    const wins = results.filter((r) => r.winner === "you").length;
    const losses = results.filter((r) => r.winner === "opponent").length;
    const draws = results.filter((r) => r.winner === "draw").length;

    console.log("");
    console.log(`Results: ${wins}W-${losses}L-${draws}D vs Random opponent`);
    if (wins >= 2) {
      console.log("Looking good! Try: npx snake-arena submit " + filePath);
    } else {
      console.log("Tip: Make sure your snake avoids walls and other snake bodies.");
    }
  } else {
    // Cloud fallback
    console.log("Local testing unavailable (need python3 + battlesnake CLI).");
    console.log("Running in the cloud...");
    console.log("");

    const code = fs.readFileSync(filePath, "utf-8");
    const response = await testStrategy(code, language, game);

    if (response.data.error) {
      console.error(`Error: ${response.data.error}`);
      process.exit(1);
    }

    const result = response.data;
    const icon =
      result.winner === "sub" ? "WIN" : result.winner === "draw" ? "DRAW" : "LOSS";
    console.log(`  Result: ${icon} (${result.turns} turns) vs Random opponent`);
  }
}

module.exports = { test };
