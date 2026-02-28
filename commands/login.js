/**
 * `snake-arena login` - Authenticate via GitHub OAuth.
 *
 * Opens browser to GitHub OAuth flow, saves token to ~/.snake-arena/token.
 * Required for ranked leaderboard placement.
 */

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const http = require("http");

const { API_BASE } = require("../lib/api");

const TOKEN_DIR = path.join(require("os").homedir(), ".snake-arena");
const TOKEN_FILE = path.join(TOKEN_DIR, "token");

function loadToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveToken(data) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
}

async function login(args) {
  const existing = loadToken();
  if (existing) {
    console.log(`Already logged in as ${existing.user}`);
    console.log("To re-login, remove ~/.snake-arena/token and try again.");
    return;
  }

  const authUrl = `${API_BASE}/auth/github`;
  console.log("Opening browser for GitHub login...");
  console.log(`  ${authUrl}`);
  console.log("");
  console.log("After authorizing, copy the TOKEN value from the browser and paste it here.");
  console.log("");

  // Open browser
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${opener} "${authUrl}"`);

  // Wait for user to paste token
  process.stdout.write("Token: ");
  const token = await new Promise((resolve) => {
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (data) => resolve(data.trim()));
    process.stdin.resume();
  });

  if (!token) {
    console.error("No token provided.");
    process.exit(1);
  }

  // Verify token
  const https = require("https");
  const user = await new Promise((resolve, reject) => {
    https
      .get("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "snake-arena-cli",
        },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Invalid response from GitHub"));
          }
        });
      })
      .on("error", reject);
  });

  if (!user.login) {
    console.error("Invalid token — could not verify with GitHub.");
    process.exit(1);
  }

  saveToken({
    token,
    user: user.login,
    avatar: user.avatar_url,
    created: new Date().toISOString(),
  });

  console.log(`\nLogged in as ${user.login}!`);
  console.log("Your submissions will now appear on the ranked leaderboard.");
}

module.exports = { login, loadToken };
