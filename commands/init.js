/**
 * `snake-arena init` - Scaffold a new strategy file.
 *
 * Supports both Battlesnake and Kurve games.
 */

const fs = require("fs");
const path = require("path");

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
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Edit ${outputFile} with your strategy`);
  console.log(`  2. Test:   npx snake-arena test ${outputFile}${game === "kurve" ? " --game kurve" : ""}`);
  console.log(`  3. Submit: npx snake-arena submit ${outputFile} --name your-${game === "kurve" ? "kurve" : "snake"}${game === "kurve" ? " --game kurve" : ""}`);
}

module.exports = { init };
