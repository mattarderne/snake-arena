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
 *   npx snake-arena play <strategy.js>
 *   npx snake-arena show <strategy-id> [--code] [--stats]
 */

const { init } = require("./commands/init");
const { test } = require("./commands/test");
const { submit } = require("./commands/submit");
const { leaderboard } = require("./commands/leaderboard");
const { login } = require("./commands/login");
const replay = require("./commands/replay");
const play = require("./commands/play");
const { show } = require("./commands/show");

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
  AI Arena - Multi-Game AI Agent Benchmark

  Games:
    battlesnake    Turn-based snake on 11x11 grid (default)
    kurve          Achtung die Kurve - trails on continuous 2D board

  Commands:
    init [--js|--py] [--kurve]          Scaffold a new strategy
    test [file] [--game TYPE] [--cloud]  Test your strategy (opens local replay viewer)
      --vs ID                           Test against a specific strategy
    submit [file] [--game TYPE]         Submit to the leaderboard
      --name NAME                       Display name
      --model MODEL                     AI model used (e.g. claude-sonnet-4)
      --parent ID                       Parent strategy (for evolution lineage)
      --tool TOOL                       Tool used (e.g. claude-code, cursor)
      --public                          Make code publicly visible
    leaderboard [--game TYPE|all]       Show rankings
    replay <id|file.json> [--cloud]     Open replay (local viewer or --cloud for web)
      --json                            Print raw replay JSON to stdout
      --summary                         Print human-readable game summary
      --turn N                          Print game state at turn N
    play <strategy.js> [--opponent rank:N]  Play against an AI in the browser
    show <strategy-id> [--code] [--stats]  Inspect a strategy's info, code, or stats
    login                               Authenticate via GitHub (for ranked play)

  Examples:
    npx snake-arena init --py
    npx snake-arena init --kurve
    npx snake-arena test snake.py
    npx snake-arena submit snake.py --name "my-snake" --model claude-sonnet-4
    npx snake-arena submit kurve.py --game kurve --parent flood-fill_2be787f9
    npx snake-arena leaderboard --game all
    npx snake-arena replay arena-v2-test_2be787f9d427_vs_flood-fill_2be787f9d427_0
    npx snake-arena play templates/kurve.js
    npx snake-arena play my-strategy.js --opponent rank:1
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
    case "watch":
      await replay(args.slice(1));
      break;
    case "play":
      await play(args.slice(1));
      break;
    case "show":
      await show(args.slice(1));
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

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
