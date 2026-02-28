const { exec } = require("child_process");
const { API_BASE } = require("../lib/api");

const WEBSITE_BASE = "https://arena-web-vinext.matt-15d.workers.dev";

module.exports = async function replay(args) {
  const replayId = args[0];

  if (!replayId) {
    console.log("\n  Usage: snake-arena replay <replay-id>");
    console.log("\n  Opens a game replay in your browser.");
    console.log("\n  You can find replay IDs from:");
    console.log("    - Submit output (listed after each match)");
    console.log("    - Strategy detail pages on the website");
    console.log("    - snake-arena leaderboard (click a strategy)\n");
    return;
  }

  const url = `${WEBSITE_BASE}/replay/${encodeURIComponent(replayId)}`;
  console.log(`\n  Opening replay: ${replayId}`);
  console.log(`  ${url}\n`);

  // Open in browser
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? `open "${url}"` :
    platform === "win32" ? `start "${url}"` :
    `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(`  Could not open browser. Visit the URL above manually.\n`);
    }
  });
};
