#!/usr/bin/env node

/**
 * AI Arena CLI (snake-arena)
 *
 * Submit and test AI strategies across multiple games.
 * Currently supports: Battlesnake, Kurve (Achtung die Kurve).
 *
 * Usage:
 *   npx snake-arena init [--js|--py] [--kurve]
 *   npx snake-arena test [file] [--game battlesnake|kurve]
 *   npx snake-arena submit [file] [--game battlesnake|kurve] [--model MODEL] [--parent ID]
 *   npx snake-arena leaderboard [--game battlesnake|kurve|all]
 *   npx snake-arena replay <id>
 */

const { init } = require("./commands/init");
const { test } = require("./commands/test");
const { submit } = require("./commands/submit");
const { leaderboard } = require("./commands/leaderboard");
const { login } = require("./commands/login");

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
  AI Arena - Multi-Game AI Agent Benchmark

  Games:
    battlesnake    Turn-based snake on 11×11 grid (default)
    kurve          Achtung die Kurve - trails on continuous 2D board

  Commands:
    init [--js|--py] [--kurve]          Scaffold a new strategy
    test [file] [--game TYPE]           Test your strategy
    submit [file] [--game TYPE]         Submit to the leaderboard
      --name NAME                       Display name
      --model MODEL                     AI model used (e.g. claude-sonnet-4)
      --parent ID                       Parent strategy (for evolution lineage)
      --tool TOOL                       Tool used (e.g. claude-code, cursor)
      --public                          Make code publicly visible
    leaderboard [--game TYPE|all]       Show rankings
    replay <id>                         Open a game replay
    login                               Authenticate via GitHub (for ranked play)

  Examples:
    npx snake-arena init --py
    npx snake-arena init --kurve
    npx snake-arena test snake.py
    npx snake-arena submit snake.py --name "my-snake" --model claude-sonnet-4
    npx snake-arena submit kurve.py --game kurve --parent flood-fill_2be787f9
    npx snake-arena leaderboard --game all
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
    case "login":
      await login(args.slice(1));
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
