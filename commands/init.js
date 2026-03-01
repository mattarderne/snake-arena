/**
 * `snake-arena init` - Scaffold a new strategy file.
 *
 * Supports both Battlesnake and Kurve games.
 */

const fs = require("fs");
const path = require("path");
const { getLeaderboard, getStrategyCode } = require("../lib/api");

async function init(args) {
  let language = "python"; // default
  let advanced = false;
  let game = "battlesnake"; // default

  for (const arg of args) {
    if (arg === "--js" || arg === "--javascript") language = "javascript";
    if (arg === "--py" || arg === "--python") language = "python";
    if (arg === "--advanced") advanced = true;
    if (arg === "--kurve") game = "kurve";
  }

  const templatesDir = path.join(__dirname, "..", "templates");
  let templateFile, outputFile;

  if (game === "kurve") {
    if (language === "javascript") {
      templateFile = path.join(templatesDir, "kurve.js");
      outputFile = "kurve.js";
    } else {
      templateFile = path.join(templatesDir, "kurve.py");
      outputFile = "kurve.py";
    }
  } else if (language === "javascript") {
    templateFile = path.join(templatesDir, "snake.js");
    outputFile = "snake.js";
  } else if (advanced) {
    templateFile = path.join(templatesDir, "snake-advanced.py");
    outputFile = "snake.py";
  } else {
    templateFile = path.join(templatesDir, "snake.py");
    outputFile = "snake.py";
  }

  if (fs.existsSync(outputFile)) {
    console.error(`${outputFile} already exists. Remove it first or use a different directory.`);
    process.exit(1);
  }

  const template = fs.readFileSync(templateFile, "utf-8");
  fs.writeFileSync(outputFile, template);

  const gameName = game === "kurve" ? "Kurve" : "Battlesnake";
  console.log(`Created ${outputFile} (${gameName} strategy)`);

  // Fetch a random public strategy as inspiration
  let inspiration = null;
  try {
    const lbResponse = await getLeaderboard(50, 0, game);
    const strategies = (lbResponse.data?.strategies || []).filter(
      (s) => s.metadata?.is_public === true
    );
    if (strategies.length > 0) {
      const pick = strategies[Math.floor(Math.random() * strategies.length)];
      const codeResponse = await getStrategyCode(pick.id);
      if (codeResponse.status < 400 && codeResponse.data?.code) {
        const ext = language === "javascript" ? "js" : "py";
        const inspirationFile = game === "kurve" ? `kurve_inspiration.${ext}` : `snake_inspiration.${ext}`;
        fs.writeFileSync(inspirationFile, codeResponse.data.code);
        fs.writeFileSync(
          ".snake-arena-parent.json",
          JSON.stringify({
            parent_id: pick.id,
            parent_name: pick.name,
            parent_elo: pick.elo,
          }, null, 2)
        );
        inspiration = { name: pick.name, rank: strategies.indexOf(pick) + 1, elo: pick.elo, file: inspirationFile };
      }
    }
  } catch {
    // Network failure — silently skip inspiration
  }

  if (inspiration) {
    console.log("");
    console.log(`  Inspiration: ${inspiration.name} (#${inspiration.rank}, ${inspiration.elo} ELO)`);
    console.log(`  See ${inspiration.file} for their approach.`);
    console.log(`  Your submission will automatically track lineage from this strategy.`);
  }

  console.log("");
  console.log("Next steps:");
  console.log(`  1. Edit ${outputFile} with your strategy`);
  console.log(`  2. Test:   npx github:mattarderne/snake-arena test ${outputFile}  (Docker cloud-parity local by default)`);
  if (game === "kurve") {
    console.log(`  2b. Data:  npx github:mattarderne/snake-arena sample-data --game kurve`);
  }
  console.log(`  3. Submit: npx github:mattarderne/snake-arena submit ${outputFile} --name your-${game === "kurve" ? "kurve" : "snake"}${game === "kurve" ? " --game kurve" : ""}`);
}

module.exports = { init };
