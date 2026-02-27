/**
 * Run games locally using Python server + Battlesnake CLI.
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

function startServer(command, args, port) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;

    // Wait for "Snake server on port" message
    proc.stdout.on("data", (data) => {
      if (!started && data.toString().includes("Snake server on port")) {
        started = true;
        resolve(proc);
      }
    });

    proc.stderr.on("data", (data) => {
      if (!started) {
        reject(new Error(`Server failed: ${data.toString()}`));
      }
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error("Server start timed out"));
      }
    }, 5000);
  });
}

async function runLocalGame(
  strategyPath,
  language,
  pythonBin,
  battlesnakeBin,
  opponentPath
) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snake-arena-"));
  const outputPath = path.join(tmpDir, "replay.jsonl");

  // Determine server commands
  const userPort = 8080;
  const oppPort = 8081;

  let userCmd, userArgs;
  const wrapperDir = path.join(__dirname, "..");

  if (language === "python") {
    // Use a minimal inline server wrapper
    const wrapperPy = path.join(wrapperDir, "templates", "_server_wrapper.py");
    userCmd = pythonBin;
    userArgs = [wrapperPy, path.resolve(strategyPath), String(userPort)];
  } else {
    const wrapperJs = path.join(wrapperDir, "templates", "_server_wrapper.js");
    userCmd = "node";
    userArgs = [wrapperJs, path.resolve(strategyPath), String(userPort)];
  }

  // Opponent is always Python
  const oppWrapperPy = path.join(wrapperDir, "templates", "_server_wrapper.py");
  const oppCmd = pythonBin;
  const oppArgs = [oppWrapperPy, path.resolve(opponentPath), String(oppPort)];

  let userProc, oppProc;
  try {
    [userProc, oppProc] = await Promise.all([
      startServer(userCmd, userArgs, userPort),
      startServer(oppCmd, oppArgs, oppPort),
    ]);

    // Run game
    const result = await new Promise((resolve, reject) => {
      const game = spawn(battlesnakeBin, [
        "play",
        "-W", "11", "-H", "11",
        "-n", "you", "-u", `http://localhost:${userPort}`,
        "-n", "opponent", "-u", `http://localhost:${oppPort}`,
        "-o", outputPath,
      ]);

      let stderr = "";
      game.stderr.on("data", (d) => (stderr += d.toString()));

      game.on("close", (code) => {
        if (code !== 0 && !fs.existsSync(outputPath)) {
          reject(new Error(`Game failed: ${stderr}`));
          return;
        }
        resolve(parseResult(outputPath));
      });

      // Timeout
      setTimeout(() => {
        game.kill();
        reject(new Error("Game timed out"));
      }, 30000);
    });

    return result;
  } finally {
    if (userProc) userProc.kill();
    if (oppProc) oppProc.kill();
    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {}
  }
}

function parseResult(outputPath) {
  if (!fs.existsSync(outputPath)) {
    return { winner: "draw", turns: 0, error: "No output" };
  }

  const lines = fs.readFileSync(outputPath, "utf-8").trim().split("\n");
  if (lines.length < 2) {
    return { winner: "draw", turns: 0, error: "Empty output" };
  }

  const summary = JSON.parse(lines[lines.length - 1]);
  const winnerName = summary.winnerName || "";
  const isDraw = summary.isDraw || false;

  // Count turns from second-to-last line
  let totalTurns = 0;
  try {
    const lastTurn = JSON.parse(lines[lines.length - 2]);
    totalTurns = lastTurn.turn || 0;
  } catch {}

  return {
    winner: isDraw ? "draw" : winnerName === "you" ? "you" : "opponent",
    turns: totalTurns,
    winnerName,
    isDraw,
  };
}

module.exports = { runLocalGame, startServer };
