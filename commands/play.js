const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

module.exports = async function play(args) {
  const file = args.find(a => !a.startsWith("--"));

  if (args.includes("--help") || args.includes("-h")) {
    console.log("\n  Usage: snake-arena play [strategy.js|.py]");
    console.log("\n  Play against an AI opponent in the browser using arrow keys.");
    console.log("  With no arguments, fetches leaderboard strategies to choose from.\n");
    console.log("  Examples:");
    console.log("    snake-arena play");
    console.log("    snake-arena play my-kurve.js\n");
    return;
  }

  // Build the strategy catalog
  const strategies = [];
  const templateCode = fs.readFileSync(path.join(__dirname, "..", "templates", "kurve.js"), "utf-8");

  // Always include built-in template
  strategies.push({ name: "Built-in Template", lang: "js", elo: null, code: templateCode });

  // If a local file was given, add it at the top
  if (file) {
    if (!fs.existsSync(file)) {
      console.error(`\n  File not found: ${file}`);
      process.exit(1);
    }
    if (!file.endsWith(".js") && !file.endsWith(".py")) {
      console.error(`\n  Only .js and .py strategy files are supported.`);
      process.exit(1);
    }
    const code = fs.readFileSync(file, "utf-8");
    const lang = file.endsWith(".py") ? "py" : "js";
    strategies.unshift({ name: path.basename(file), lang, elo: null, code });
    console.log(`\n  Loaded local strategy: ${file}`);
  }

  // Fetch leaderboard strategies
  console.log(`  Fetching kurve leaderboard...`);
  try {
    const { getLeaderboard, getStrategyCode } = require("../lib/api");
    const lb = await getLeaderboard(50, 0, "kurve");
    const entries = lb.data?.strategies || [];

    // Try to fetch code for each
    const fetches = entries.map(async (entry) => {
      try {
        const resp = await getStrategyCode(entry.id);
        if (resp.data?.code) {
          return {
            name: entry.name,
            lang: entry.language === "python" ? "py" : "js",
            elo: Math.round(entry.elo),
            code: resp.data.code,
          };
        }
      } catch {}
      return null;
    });
    const results = await Promise.all(fetches);
    let added = 0;
    for (const r of results) {
      if (r) { strategies.push(r); added++; }
    }
    console.log(`  Found ${entries.length} strategies, ${added} with public code`);
  } catch (e) {
    console.log(`  Could not fetch leaderboard: ${e.message}`);
  }

  const templatePath = path.join(__dirname, "..", "templates", "play.html");
  const template = fs.readFileSync(templatePath, "utf-8");

  const catalogScript = `<script id="strategy-catalog" type="application/json">${JSON.stringify(strategies)}</script>`;
  const html = template.replace("</body>", `${catalogScript}\n</body>`);

  const os = require("os");
  const tmpDir = path.join(os.tmpdir(), "snake-arena");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const htmlFile = path.join(tmpDir, `play-${Date.now()}.html`);
  fs.writeFileSync(htmlFile, html);

  console.log(`  Opening game in browser...\n`);
  openBrowser(htmlFile);
};

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
