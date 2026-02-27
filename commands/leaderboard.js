/**
 * `snake-arena leaderboard` - Display current rankings.
 */

const { getLeaderboard } = require("../lib/api");

async function leaderboard(args) {
  const limit = parseInt(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "20",
    10
  );

  console.log("Fetching leaderboard...");
  console.log("");

  const response = await getLeaderboard(limit);

  if (response.data.error) {
    console.error(`Error: ${response.data.error}`);
    process.exit(1);
  }

  const strategies = response.data.strategies || [];

  if (strategies.length === 0) {
    console.log("  No strategies submitted yet. Be the first!");
    console.log("  Run: npx snake-arena init");
    return;
  }

  // Header
  const cols = {
    rank: 4,
    name: 20,
    elo: 7,
    record: 12,
    wr: 6,
    lang: 4,
    ai: 3,
  };

  console.log(
    `  ${"#".padStart(cols.rank)}  ${"Name".padEnd(cols.name)}  ${"ELO".padStart(cols.elo)}  ${"Record".padEnd(cols.record)}  ${"WR%".padStart(cols.wr)}  ${"Lang".padEnd(cols.lang)}  AI`
  );
  console.log(`  ${"─".repeat(62)}`);

  strategies.forEach((s, i) => {
    const rank = String(i + 1).padStart(cols.rank);
    const name = (s.name || s.id).slice(0, cols.name).padEnd(cols.name);
    const elo =
      String(Math.round(s.elo)).padStart(cols.elo - 1) +
      (s.provisional ? "?" : " ");
    const total = s.wins + s.losses + s.draws;
    const record = `${s.wins}W-${s.losses}L-${s.draws}D`.padEnd(cols.record);
    const wr =
      total > 0
        ? String(Math.round((s.wins / total) * 100)).padStart(cols.wr - 1) +
          "%"
        : "  N/A ";
    const lang = (s.language === "python" ? "py" : "js").padEnd(cols.lang);
    const ai = s.metadata?.model ? "*" : " ";

    console.log(`  ${rank}  ${name}  ${elo}  ${record}  ${wr}  ${lang}  ${ai}`);
  });

  console.log(`  ${"─".repeat(62)}`);
  console.log(`  ${strategies.length} strategies | * = AI-assisted`);
}

module.exports = { leaderboard };
