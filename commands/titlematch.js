const { triggerTitleMatch, getTitleMatchLatest, getReplay } = require("../lib/api");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

module.exports = async function titlematch(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("\n  Usage: snake-arena titlematch [--run] [--game kurve]");
    console.log("\n  View the latest title match, or trigger a new one.");
    console.log("\n  The title match pits the top 3 ELO strategies against each other");
    console.log("  in a best-of-5 free-for-all. It auto-triggers when top 3 rankings change.\n");
    console.log("  Options:");
    console.log("    --run         Trigger a new title match (default: show latest)");
    console.log("    --watch       Open all games in the replay viewer");
    console.log("    --game TYPE   Game type (default: kurve)");
    console.log("    --best-of N   Number of games (default: 5)");
    console.log("    --top N       Number of players (default: 3)\n");
    return;
  }

  const game = getFlag(args, "--game") || "kurve";
  const shouldRun = args.includes("--run");
  const shouldWatch = args.includes("--watch");

  let matchData;

  if (shouldRun) {
    const bestOf = parseInt(getFlag(args, "--best-of") || "5", 10);
    const topN = parseInt(getFlag(args, "--top") || "3", 10);

    console.log(`\n  Triggering title match: top ${topN} ${game} strategies, best-of-${bestOf}...`);
    console.log("  This runs on the cloud and may take a minute.\n");

    try {
      const resp = await triggerTitleMatch(game, bestOf, topN);
      if (resp.data?.error) {
        console.error(`  Error: ${resp.data.error}`);
        process.exit(1);
      }
      matchData = resp.data;
    } catch (e) {
      console.error(`  Error: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log(`\n  Fetching latest ${game} title match...\n`);
    try {
      const resp = await getTitleMatchLatest(game);
      if (resp.data?.error) {
        console.log(`  ${resp.data.error}`);
        console.log("  Run with --run to trigger one.\n");
        return;
      }
      matchData = resp.data;
    } catch (e) {
      console.error(`  Error: ${e.message}`);
      process.exit(1);
    }
  }

  displayResult(matchData);

  if (shouldWatch && matchData?.replays?.length > 0) {
    await openMatchViewer(matchData.replays);
  }
};

function displayResult(data) {
  if (!data || !data.players) {
    console.log("  No title match data available.\n");
    return;
  }

  const sorted = [...data.players].sort((a, b) => b.wins - a.wins || b.elo - a.elo);
  const champion = sorted[0];

  console.log("  ========================================");
  console.log("           TITLE MATCH RESULTS");
  console.log("  ========================================\n");

  sorted.forEach((p, i) => {
    const crown = p.id === data.champion_id ? " <<< CHAMPION" : "";
    const bar = "W".repeat(p.wins) + "-".repeat(data.best_of - p.wins);
    console.log(`  #${i + 1}  ${p.name.padEnd(20)} ELO ${String(Math.round(p.elo)).padStart(4)}  [${bar}] ${p.wins}W${crown}`);
  });

  console.log(`\n  Best of ${data.best_of} | ${data.game}`);

  if (data.games && data.games.length > 0) {
    console.log("\n  Game-by-game:");
    data.games.forEach((g, i) => {
      const winner = g.winner_name || "Draw";
      const ticks = g.turns || "?";
      console.log(`    Game ${i + 1}: ${winner} wins (${ticks} ticks)`);
    });
  }

  if (data.replays && data.replays.length > 0) {
    console.log("\n  Replays:");
    data.replays.forEach((r) => {
      console.log(`    snake-arena replay ${r}`);
    });
  }

  console.log();
}

async function openMatchViewer(replayIds) {
  console.log(`  Fetching ${replayIds.length} replays for match viewer...`);

  const replays = [];
  for (const id of replayIds) {
    try {
      const resp = await getReplay(id);
      if (resp.data && !resp.data.error) {
        replays.push(resp.data);
      } else {
        console.log(`  Warning: could not fetch replay ${id}`);
      }
    } catch (e) {
      console.log(`  Warning: failed to fetch replay ${id}: ${e.message}`);
    }
  }

  if (replays.length === 0) {
    console.log("  No replays could be loaded.\n");
    return;
  }

  console.log(`  Loaded ${replays.length} games. Opening viewer...`);

  const os = require("os");
  const viewerTemplate = fs.readFileSync(
    path.join(__dirname, "..", "templates", "replay-viewer.html"),
    "utf-8"
  );

  const dataScript = `<script id="replay-match-data" type="application/json">${JSON.stringify(replays)}</script>`;
  const html = viewerTemplate.replace("</body>", `${dataScript}\n</body>`);

  const tmpDir = path.join(os.tmpdir(), "snake-arena");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const htmlFile = path.join(tmpDir, `match-${Date.now()}.html`);
  fs.writeFileSync(htmlFile, html);

  const platform = process.platform;
  const cmd =
    platform === "darwin" ? `open "${htmlFile}"` :
    platform === "win32" ? `start "${htmlFile}"` :
    `xdg-open "${htmlFile}"`;

  exec(cmd, (err) => {
    if (err) console.log(`  Could not open browser. Open manually: ${htmlFile}\n`);
  });
  console.log();
}

function getFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return null;
}
