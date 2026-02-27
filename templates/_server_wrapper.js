/**
 * Minimal Battlesnake server wrapper for local testing.
 * Used internally by `snake-arena test`.
 * Usage: node _server_wrapper.js <strategy.js> [port]
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

const strategyPath = process.argv[2];
const port = parseInt(process.argv[3] || "8080", 10);

const code = fs.readFileSync(path.resolve(strategyPath), "utf-8");
const mod = {};
const fn = eval(`(function(module, exports) { ${code} })`);
fn(mod, mod);
const decideMove = mod.exports?.decideMove || mod.decideMove;

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ apiversion: "1" }));
    return;
  }
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/move") {
        try {
          const data = JSON.parse(body);
          let move = decideMove(data);
          if (!["up", "down", "left", "right"].includes(move)) move = "up";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ move }));
        } catch {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ move: "up" }));
        }
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, () => {
  console.log(`Snake server on port ${port}`);
});
