/**
 * HTTP client for the Snake Arena API.
 *
 * Routes all requests through the Cloudflare Workers frontend at /api/*.
 * Override with SNAKE_ARENA_API env var to point at a different backend.
 */

const https = require("https");
const http = require("http");

const API_BASE = process.env.SNAKE_ARENA_API || "https://arena-web-vinext.matt-15d.workers.dev";

function resolveUrl(endpoint, params = "") {
  return `${API_BASE}/api/${endpoint}${params}`;
}

async function apiRequest(url, options = {}) {
  const method = options.method || "GET";
  const body = options.body ? JSON.stringify(options.body) : undefined;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const transport = urlObj.protocol === "https:" ? https : http;

    const req = transport.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
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

async function testStrategy(code, language) {
  return apiRequest(resolveUrl("test"), {
    method: "POST",
    body: { code, language },
  });
}

async function getLeaderboard(limit = 50, offset = 0) {
  return apiRequest(resolveUrl("leaderboard", `?limit=${limit}&offset=${offset}`));
}

async function getStatus(jobId) {
  return apiRequest(resolveUrl(`status/${jobId}`));
}

async function getReplay(gameId) {
  return apiRequest(resolveUrl("replay", `?game_id=${encodeURIComponent(gameId)}`));
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
};
