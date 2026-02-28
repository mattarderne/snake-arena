/**
 * HTTP client for the Snake Arena API.
 *
 * Routes all requests through the Cloudflare Workers frontend at /api/*.
 * Override with SNAKE_ARENA_API env var to point at a different backend.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const API_BASE = process.env.SNAKE_ARENA_API || "https://arena-web-vinext.matt-15d.workers.dev";
const TOKEN_FILE = path.join(os.homedir(), ".snake-arena", "token");

function resolveUrl(endpoint, params = "") {
  return `${API_BASE}/api/${endpoint}${params}`;
}

function loadAuthToken() {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === "string" && parsed.token.length > 0) {
      return parsed.token;
    }
  } catch {}
  return null;
}

async function apiRequest(url, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const authToken = loadAuthToken();

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const transport = urlObj.protocol === "https:" ? https : http;

    const req = transport.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "snake-arena-cli",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed = data;
          try {
            parsed = JSON.parse(data);
          } catch {}
          resolve({
            status: res.statusCode || 0,
            data: parsed,
            headers: {
              "retry-after": res.headers["retry-after"],
              "x-ratelimit-limit": res.headers["x-ratelimit-limit"],
              "x-ratelimit-remaining": res.headers["x-ratelimit-remaining"],
              "x-ratelimit-reset": res.headers["x-ratelimit-reset"],
            },
          });
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function submitStrategy(code, language, name, metadata = {}) {
  return apiRequest(resolveUrl("submit"), {
    method: "POST",
    body: { code, language, name, metadata },
  });
}

async function testStrategy(code, language, game = "battlesnake", { opponentId, seed } = {}) {
  const body = { code, language, game };
  if (opponentId) body.opponent_id = opponentId;
  if (seed != null) body.seed = seed;
  return apiRequest(resolveUrl("test"), {
    method: "POST",
    body,
  });
}

async function getLeaderboard(limit = 50, offset = 0, game = "") {
  const params = `?limit=${limit}&offset=${offset}${game ? `&game=${game}` : ""}`;
  return apiRequest(resolveUrl("leaderboard", params));
}

async function getStatus(jobId) {
  return apiRequest(resolveUrl("status", `?job_id=${encodeURIComponent(jobId)}`));
}

async function getReplay(gameId) {
  return apiRequest(resolveUrl("replay", `?game_id=${encodeURIComponent(gameId)}`));
}

async function getStrategyCode(strategyId) {
  return apiRequest(resolveUrl("code", `?strategy_id=${encodeURIComponent(strategyId)}`));
}

module.exports = {
  API_BASE,
  resolveUrl,
  apiRequest,
  submitStrategy,
  testStrategy,
  getLeaderboard,
  getStatus,
  getReplay,
  getStrategyCode,
};
