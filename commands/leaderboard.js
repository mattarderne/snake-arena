/**
 * `snake-arena leaderboard` - Display current rankings.
 *
 * Supports filtering by game: --game battlesnake|kurve|all
 */

const { getLeaderboard } = require("../lib/api");

const USAGE = `
  Usage: snake-arena leaderboard [flags]

  Display current rankings.

  Flags:
    --game TYPE       Filter by game: battlesnake, kurve, or all
    --limit=N         Number of results (default: 20)
`;

async function leaderboard(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const limit = parseInt(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "20",
    10
  );

  let game = "battlesnake"; // default
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--game" && args[i + 1]) {
      game = args[++i];
    }
  }

  const gameName = game === "all" ? "All Games" : game === "kurve" ? "Kurve" : "Battlesnake";
  console.log(`Fetching ${gameName} leaderboard...`);
  console.log("");

  const response = await getLeaderboard(limit, 0, game);

  if (response.data.error) {
    console.error(`Error: ${response.data.error}`);
    process.exit(1);
  }

  const strategies = response.data.strategies || [];

  if (strategies.length === 0) {
    console.log("  No strategies submitted yet. Be the first!");
    console.log(`  Run: npx snake-arena init${game === "kurve" ? " --kurve" : ""}`);
    return;
  }

  // Header
  const cols = {
    rank: 4,
    name: 20,
    elo: 10,
    record: 12,
    wr: 6,
    lang: 4,
    ai: 3,
  };

  const gameCol = game === "all" ? "  Game  " : "";
  console.log(
    `  ${"#".padStart(cols.rank)}  ${"Name".padEnd(cols.name)}  ${"ELO".padStart(cols.elo)}  ${"Record".padEnd(cols.record)}  ${"WR%".padStart(cols.wr)}  ${"Lang".padEnd(cols.lang)}  AI${gameCol}`
  );
  console.log(`  ${"─".repeat(game === "all" ? 72 : 64)}`);

  strategies.forEach((s, i) => {
    const rank = String(i + 1).padStart(cols.rank);
    const name = (s.name || s.id).slice(0, cols.name).padEnd(cols.name);
    const rd = s.rating_deviation ? ` ±${Math.round(s.rating_deviation)}` : "";
    const eloStr = String(Math.round(s.elo)) + (s.provisional ? "?" : " ") + rd;
    const elo = eloStr.padStart(cols.elo);
    const total = s.wins + s.losses + s.draws;
    const record = `${s.wins}W-${s.losses}L-${s.draws}D`.padEnd(cols.record);
    const wr =
      total > 0
        ? String(Math.round((s.wins / total) * 100)).padStart(cols.wr - 1) +
          "%"
        : "  N/A ";
    const lang = (s.language === "python" ? "py" : "js").padEnd(cols.lang);
    const ai = s.metadata?.model ? "*" : " ";
    const gameTag = game === "all" ? `  ${(s.metadata?.game || "snake").slice(0, 6).padEnd(6)}` : "";

    console.log(`  ${rank}  ${name}  ${elo}  ${record}  ${wr}  ${lang}  ${ai}${gameTag}`);
  });

  console.log(`  ${"─".repeat(game === "all" ? 72 : 64)}`);
  console.log(`  ${strategies.length} strategies | * = AI-assisted`);
}

module.exports = { leaderboard };
