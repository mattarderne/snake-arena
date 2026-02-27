/**
 * HTTP client for the Snake Arena API.
 *
 * Supports two backends:
 * - Modal (default): each endpoint is a separate URL
 * - Cloudflare Workers: unified API at /api/*
 *
 * Set SNAKE_ARENA_API to a Cloudflare Workers URL to use that instead.
 */

const https = require("https");
const http = require("http");

const MODAL_BASE = "https://mattarderne--snake-arena-arenaapi";
const CF_BASE = process.env.SNAKE_ARENA_API || null;

// If a Cloudflare Workers URL is set, use unified /api/* routes.
// Otherwise use Modal's per-endpoint URLs.
function resolveUrl(endpoint, params = "") {
  if (CF_BASE) {
    return `${CF_BASE}/api/${endpoint}${params}`;
  }
  // Modal: each endpoint is a separate URL
  return `${MODAL_BASE}-${endpoint}.modal.run${params}`;
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
  // Status endpoint is only available on Cloudflare Workers
  if (CF_BASE) {
    return apiRequest(resolveUrl(`status/${jobId}`));
  }
  return { status: 200, data: { status: "completed" } };
}

async function getReplay(gameId) {
  return apiRequest(resolveUrl("replay", `?game_id=${encodeURIComponent(gameId)}`));
}

module.exports = {
  MODAL_BASE,
  CF_BASE,
  resolveUrl,
  apiRequest,
  submitStrategy,
  testStrategy,
  getLeaderboard,
  getStatus,
  getReplay,
};
