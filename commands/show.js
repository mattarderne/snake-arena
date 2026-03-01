/**
 * `snake-arena show` - Inspect a public strategy's info, code, or stats.
 */

const { getLeaderboard, getStrategyCode } = require("../lib/api");

const USAGE = `
  Usage: snake-arena show <strategy-id> [flags]

  Display information about a strategy.

  Flags:
    --code    Print the strategy's source code
    --stats   Show match history (W/L vs specific opponents)
`;

function parseArgs(args) {
  let id = null;
  let code = false;
  let stats = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--code") {
      code = true;
    } else if (args[i] === "--stats") {
      stats = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (!args[i].startsWith("-")) {
      id = args[i];
    }
  }

  return { id, code, stats };
}

async function show(args) {
  const { id, code, stats } = parseArgs(args);

  if (!id) {
    console.log(USAGE);
    return;
  }

  // Find strategy on leaderboard
  const lbResponse = await getLeaderboard(200, 0, "");
  const strategies = lbResponse.data?.strategies || [];
  const strategy = strategies.find(s => s.id === id || s.name === id);

  if (!strategy) {
    console.error(`  Strategy not found: ${id}`);
    console.error(`  Try: npx snake-arena leaderboard --game all`);
    process.exit(1);
  }

  if (code) {
    const codeResponse = await getStrategyCode(strategy.id);
    if (codeResponse.status >= 400 || !codeResponse.data?.code) {
      console.error(`  Code not available (strategy may not be public)`);
      process.exit(1);
    }
    console.log(codeResponse.data.code);
    return;
  }

  // Default: show strategy info
  const game = strategy.metadata?.game || "battlesnake";
  const gameName = game === "kurve" ? "Kurve" : "Battlesnake";
  const rank = strategies.indexOf(strategy) + 1;
  const total = strategy.wins + strategy.losses + strategy.draws;
  const wr = total > 0 ? Math.round((strategy.wins / total) * 100) : 0;

  console.log("");
  console.log(`  ${strategy.name || strategy.id}`);
  console.log("  ────────────────────────────────");
  console.log(`  ID:       ${strategy.id}`);
  console.log(`  Game:     ${gameName}`);
  console.log(`  ELO:      ${Math.round(strategy.elo)}${strategy.provisional ? " (provisional)" : ""}`);
  console.log(`  Rank:     #${rank}`);
  console.log(`  Record:   ${strategy.wins}W-${strategy.losses}L-${strategy.draws}D (${wr}% WR)`);
  console.log(`  Language: ${strategy.language}`);
  if (strategy.metadata?.model) {
    console.log(`  Model:    ${strategy.metadata.model}`);
  }
  if (strategy.metadata?.is_public) {
    console.log(`  Public:   yes`);
  }
  console.log("  ────────────────────────────────");

  if (stats && strategy.match_history) {
    console.log("");
    console.log("  Match History:");
    for (const m of strategy.match_history) {
      const icon = m.result === "win" ? "W" : m.result === "loss" ? "L" : "D";
      console.log(`    ${icon} vs ${m.opponent_name} (ELO ${m.opponent_elo || "?"})`);
    }
  } else if (stats) {
    console.log("\n  No detailed match history available.");
  }

  console.log("");
  console.log(`  View: https://arena-web-vinext.matt-15d.workers.dev/strategy/${strategy.id}`);
  console.log("");
}

module.exports = { show };
