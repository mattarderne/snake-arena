const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

function _writeAndOpen(scriptId, dataJson, prefix) {
  const viewerTemplate = fs.readFileSync(
    path.join(__dirname, "..", "templates", "replay-viewer.html"),
    "utf-8"
  );

  const dataScript = `<script id="${scriptId}" type="application/json">${dataJson}</script>`;
  const html = viewerTemplate.replace("</body>", `${dataScript}\n</body>`);

  const tmpDir = path.join(os.tmpdir(), "snake-arena");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const htmlFile = path.join(tmpDir, `${prefix}-${Date.now()}.html`);
  fs.writeFileSync(htmlFile, html);

  console.log(`  Opening viewer...`);
  openBrowser(htmlFile);
}

function openReplayViewer(replayData, opts) {
  const prefix = (opts && opts.prefix) || "viewer";
  _writeAndOpen("replay-data", JSON.stringify(replayData), prefix);
}

function openMatchViewer(replays, opts) {
  const prefix = (opts && opts.prefix) || "match";
  _writeAndOpen("replay-match-data", JSON.stringify(replays), prefix);
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? `open "${url}"` :
    platform === "win32" ? `start "${url}"` :
    `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(`  Could not open browser. Open manually: ${url}\n`);
    }
  });
}

module.exports = { openReplayViewer, openMatchViewer, openBrowser };
