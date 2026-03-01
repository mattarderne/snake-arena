const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { API_BASE } = require("../lib/api");

const WEBSITE_BASE = "https://arena-web-vinext.matt-15d.workers.dev";

const USAGE = `
  Usage: snake-arena replay <replay-id | file.json> [flags]

  Opens a game replay in the local viewer (default) or processes it.

  Sources:
    - Replay ID from submit output or strategy pages
    - Local JSON file from \`snake-arena test\`

  Flags:
    --cloud    Open in the web viewer instead of locally
    --json     Print raw replay JSON to stdout (no browser)
    --summary  Print human-readable game summary
    --turn N   Print game state at turn N as JSON
`;

function parseArgs(args) {
  let id = null;
  let useCloud = false;
  let json = false;
  let summary = false;
  let turn = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cloud") {
      useCloud = true;
    } else if (args[i] === "--json") {
      json = true;
    } else if (args[i] === "--summary") {
      summary = true;
    } else if (args[i] === "--turn" && args[i + 1]) {
      turn = parseInt(args[++i], 10);
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (!args[i].startsWith("-")) {
      id = args[i];
    }
  }

  return { id, useCloud, json, summary, turn };
}

async function fetchReplayData(id) {
  // Local JSON file
  if (id.endsWith(".json") && fs.existsSync(id)) {
    return JSON.parse(fs.readFileSync(id, "utf-8"));
  }

  // Fetch from API
  const { getReplay } = require("../lib/api");
  const response = await getReplay(id);

  if (response.data?.error) {
    console.error(`  Error: ${response.data.error}`);
    console.log(`  Try --cloud to open in the web viewer instead.\n`);
    process.exit(1);
  }

  return response.data;
}

function printSummary(data) {
  const playerNames = data.player_names || {};
  const turns = data.turns || [];
  const result = data.result || {};

  console.log("\n  Game Summary");
  console.log("  ────────────────────────────────");

  // Basic info
  const totalTicks = result.totalTicks || turns.length;
  console.log(`  Game:    ${data.game_type || "unknown"}`);
  console.log(`  Ticks:   ${totalTicks}`);

  // Players
  const names = Object.values(playerNames);
  if (names.length > 0) {
    console.log(`  Players: ${names.join(", ")}`);
  }

  // Winner
  const winnerName = result.winnerName || result.winner;
  if (result.isDraw) {
    console.log(`  Result:  Draw`);
  } else if (winnerName) {
    console.log(`  Winner:  ${winnerName}`);
  }

  // Deaths from result.players
  const resultPlayers = result.players || [];
  const deaths = resultPlayers.filter(p => !p.alive);
  if (deaths.length > 0) {
    console.log("");
    console.log("  Deaths:");
    for (const d of deaths) {
      const name = d.name || playerNames[d.id] || d.id;
      // Find position at death tick from turns data
      let pos = "";
      if (d.eliminated_at && turns[d.eliminated_at]) {
        const board = turns[d.eliminated_at].board;
        const ps = (board?.players || []).find(p => p.id === d.id);
        if (ps?.position) {
          pos = ` at (${ps.position.x}, ${ps.position.y})`;
        }
      }
      console.log(`    Tick ${d.eliminated_at || "?"}: ${name}${pos}`);
    }
  }

  // Also scan turns for deaths if result.players is missing
  if (deaths.length === 0 && turns.length > 0) {
    const detected = [];
    const aliveState = {};
    for (let i = 0; i < turns.length; i++) {
      const board = turns[i].board;
      for (const ps of (board?.players || board?.snakes || [])) {
        const pid = ps.id || ps.name;
        if (ps.alive === false && aliveState[pid] !== false) {
          const name = playerNames[pid] || ps.name || pid;
          const pos = ps.position ? ` at (${ps.position.x}, ${ps.position.y})` : "";
          detected.push({ tick: i, name, pos });
        }
        aliveState[pid] = ps.alive;
      }
    }
    if (detected.length > 0) {
      console.log("");
      console.log("  Deaths:");
      for (const d of detected) {
        console.log(`    Tick ${d.tick}: ${d.name}${d.pos}`);
      }
    }
  }

  console.log("  ────────────────────────────────\n");
}

function printTurnState(data, turn) {
  const turns = data.turns || data.frames || [];

  if (turns.length === 0) {
    console.error("  Error: No turn data found in replay");
    process.exit(1);
  }

  if (turn < 0 || turn >= turns.length) {
    console.error(`  Error: Turn ${turn} out of range (0-${turns.length - 1})`);
    process.exit(1);
  }

  console.log(JSON.stringify(turns[turn], null, 2));
}

module.exports = async function replay(args) {
  const { id, useCloud, json, summary, turn } = parseArgs(args);

  if (!id) {
    console.log(USAGE);
    return;
  }

  // --json, --summary, --turn modes: fetch data and output without browser
  if (json || summary || turn != null) {
    const data = await fetchReplayData(id);

    if (json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (summary) {
      printSummary(data);
      return;
    }

    if (turn != null) {
      printTurnState(data, turn);
      return;
    }
  }

  // If it's a local JSON file, open with local viewer
  if (id.endsWith(".json") && fs.existsSync(id)) {
    console.log(`\n  Opening local replay: ${id}`);
    openLocalViewer(id);
    return;
  }

  // Cloud viewer
  if (useCloud) {
    const url = `${WEBSITE_BASE}/replay/${encodeURIComponent(id)}`;
    console.log(`\n  Opening cloud replay: ${id}`);
    console.log(`  ${url}\n`);
    openBrowser(url);
    return;
  }

  // Default: fetch replay data from API, open local viewer
  console.log(`\n  Fetching replay: ${id}...`);
  const { getReplay } = require("../lib/api");
  const response = await getReplay(id);

  if (response.data?.error) {
    console.error(`  Error: ${response.data.error}`);
    console.log(`  Try --cloud to open in the web viewer instead.\n`);
    process.exit(1);
  }

  const os = require("os");
  const tmpDir = path.join(os.tmpdir(), "snake-arena");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const replayFile = path.join(tmpDir, `replay-${Date.now()}.json`);
  fs.writeFileSync(replayFile, JSON.stringify(response.data));
  console.log(`  Saved to: ${replayFile}`);
  openLocalViewer(replayFile);
};

function openLocalViewer(jsonPath) {
  const os = require("os");
  const replayData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  const viewerTemplate = fs.readFileSync(
    path.join(__dirname, "..", "templates", "replay-viewer.html"),
    "utf-8"
  );

  const dataScript = `<script id="replay-data" type="application/json">${JSON.stringify(replayData)}</script>`;
  const html = viewerTemplate.replace("</body>", `${dataScript}\n</body>`);

  const tmpDir = path.join(os.tmpdir(), "snake-arena");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const htmlFile = path.join(tmpDir, `viewer-${Date.now()}.html`);
  fs.writeFileSync(htmlFile, html);

  console.log(`  Opening viewer...\n`);
  openBrowser(htmlFile);
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? `open "${url}"` :
    platform === "win32" ? `start "${url}"` :
    `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(`  Could not open browser. Open manually: ${url}\n`);
    }
  });
}
