#!/usr/bin/env node

/**
 * Snake Arena CLI
 *
 * Submit and test Battlesnake strategies against a public leaderboard.
 *
 * Usage:
 *   npx snake-arena init [--js|--py]
 *   npx snake-arena test [file]
 *   npx snake-arena submit [file]
 *   npx snake-arena leaderboard
 *   npx snake-arena replay <id>
 */

const { init } = require("./commands/init");
const { test } = require("./commands/test");
const { submit } = require("./commands/submit");
const { leaderboard } = require("./commands/leaderboard");

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
  snake-arena - Public Battlesnake Leaderboard

  Commands:
    init [--js|--py]      Scaffold a new snake strategy
    test [file]           Test your snake locally or in the cloud
    submit [file]         Submit your snake to the leaderboard
    leaderboard           Show current rankings
    replay <id>           Open a game replay in the browser

  Examples:
    npx snake-arena init --py
    npx snake-arena test snake.py
    npx snake-arena submit snake.py --name "my-snake"
    npx snake-arena leaderboard
`;

async function main() {
  switch (command) {
    case "init":
      await init(args.slice(1));
      break;
    case "test":
      await test(args.slice(1));
      break;
    case "submit":
      await submit(args.slice(1));
      break;
    case "leaderboard":
    case "lb":
      await leaderboard(args.slice(1));
      break;
    case "replay":
      await replay(args.slice(1));
      break;
    case "--help":
    case "-h":
    case "help":
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

async function replay(args) {
  const id = args[0];
  if (!id) {
    console.error("Usage: snake-arena replay <game-id>");
    process.exit(1);
  }
  const { API_BASE } = require("./lib/api");
  const url = `${API_BASE}/replay/${id}`;
  console.log(`Opening replay: ${url}`);
  // Open in browser
  const { exec } = require("child_process");
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${opener} ${url}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
