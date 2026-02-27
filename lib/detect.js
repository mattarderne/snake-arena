/**
 * Detect local Python and Battlesnake binary availability.
 */

const { execSync } = require("child_process");

function which(cmd) {
  try {
    return execSync(`which ${cmd}`, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function detectPython() {
  return which("python3") || which("python");
}

function detectBattlesnake() {
  return (
    which("battlesnake") ||
    (() => {
      // Check common Go bin path
      const goPath = `${process.env.HOME}/go/bin/battlesnake`;
      try {
        execSync(`test -x ${goPath}`, { encoding: "utf-8" });
        return goPath;
      } catch {
        return null;
      }
    })()
  );
}

function detectNode() {
  return which("node");
}

module.exports = { detectPython, detectBattlesnake, detectNode };
