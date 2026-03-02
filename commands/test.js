/**
 * `snake-arena test` - Test a strategy locally or via cloud.
 *
 * Supports both Battlesnake and Kurve games.
 * After a cloud test, opens the replay in a local viewer (or --cloud for web viewer).
 */

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { detectPython, detectBattlesnake } = require("../lib/detect");
const { runLocalGame } = require("../lib/local-runner");
const { testStrategy } = require("../lib/api");

const WEBSITE_BASE = "https://arena-web-vinext.matt-15d.workers.dev";

const USAGE = `
  Usage: snake-arena test [file] [flags]

  Test a strategy locally or via cloud. Opens a replay viewer after cloud tests.

  Flags:
    --game TYPE       Game type: battlesnake or kurve
    --cloud           Open replay in web viewer instead of locally
    --vs ID           Test against a specific strategy by ID
`;

function detectLanguage(filePath) {
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".js")) return "javascript";
  return null;
}

function parseArgs(args) {
  let filePath = null;
  let game = null;
  let cloud = false;
  let vs = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--game" && args[i + 1]) {
      game = args[++i];
    } else if (args[i] === "--cloud") {
      cloud = true;
    } else if (args[i] === "--vs" && args[i + 1]) {
      vs = args[++i];
    } else if (!args[i].startsWith("-")) {
      filePath = args[i];
    }
  }

  return { filePath, game, cloud, vs };
}

/**
 * Open the local replay viewer with replay data saved to a temp JSON file.
 * Falls back to cloud viewer if --cloud is set.
 */
function openReplayViewer(replayData, cloud) {
  if (cloud) {
    // Cloud viewer: would need a replay ID, but test results aren't saved to the API.
    // For now just note it's local only.
    console.log("  (Cloud viewer not available for test results — replays are not persisted)");
    return;
  }

  // Save replay JSON to a temp file
  const os = require("os");
  const tmpDir = path.join(os.tmpdir(), "snake-arena");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const replayFile = path.join(tmpDir, `replay-${Date.now()}.json`);
  fs.writeFileSync(replayFile, JSON.stringify(replayData));

  // Build an HTML file that inlines the replay data
  const viewerTemplate = fs.readFileSync(
    path.join(__dirname, "..", "templates", "replay-viewer.html"),
    "utf-8"
  );

  // Inject replay data as a script tag before closing </body>
  const dataScript = `<script id="replay-data" type="application/json">${JSON.stringify(replayData)}</script>`;
  const html = viewerTemplate.replace("</body>", `${dataScript}\n</body>`);

  const htmlFile = path.join(tmpDir, `replay-${Date.now()}.html`);
  fs.writeFileSync(htmlFile, html);

  console.log(`  Replay saved: ${replayFile}`);
  console.log(`  Opening viewer...`);

  // Open in browser
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? `open "${htmlFile}"` :
    platform === "win32" ? `start "${htmlFile}"` :
    `xdg-open "${htmlFile}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(`  Could not open browser. Open manually: ${htmlFile}`);
    }
  });
}

async function test(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  let { filePath, game, cloud, vs } = parseArgs(args);

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
    const opts = {};
    if (vs) opts.opponentId = vs;
    const response = await testStrategy(code, language, game, opts);

    if (response.data.error) {
      console.error(`Error: ${response.data.error}`);
      process.exit(1);
    }

    const result = response.data;
    const icon =
      result.winner === "sub" ? "WIN" : result.winner === "draw" ? "DRAW" : "LOSS";
    const oppName = result.opponent_name || (vs ? vs : "Random Kurve opponent");
    console.log(`  Result: ${icon} (${result.turns} ticks) vs ${oppName}`);

    if (result.warning) {
      console.log("");
      console.log(`  \u26a0 ${result.warning}`);
    }

    // Open replay viewer if we have replay data
    if (result.replay_data) {
      openReplayViewer(result.replay_data, cloud);
    }

    if (icon === "WIN" && !result.warning) {
      console.log(`\nLooking good! Try: npx snake-arena submit ${filePath} --game kurve`);
    } else if (icon === "WIN" && result.warning) {
      console.log(`\nYou won, but the game may have been invalid. Check your decide_move() for errors.`);
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
    const bsOpts = {};
    if (vs) bsOpts.opponentId = vs;
    const response = await testStrategy(code, language, game, bsOpts);

    if (response.data.error) {
      console.error(`Error: ${response.data.error}`);
      process.exit(1);
    }

    const result = response.data;
    const icon =
      result.winner === "sub" ? "WIN" : result.winner === "draw" ? "DRAW" : "LOSS";
    const bsOppName = result.opponent_name || (vs ? vs : "Random opponent");
    console.log(`  Result: ${icon} (${result.turns} turns) vs ${bsOppName}`);
  }
}

module.exports = { test };
