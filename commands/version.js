/**
 * `snake-arena version` - Print local CLI and remote API/Modal versions.
 */

const { API_BASE, API_MODE, getVersion } = require("../lib/api");
const { CLI_NAME, CLI_VERSION } = require("../lib/version");

const USAGE = `
  Usage: snake-arena version [--json]

  Show local CLI version and remote API/Modal version details.
`;

function extractModalVersion(remote) {
  const versions = remote?.versions || {};
  return versions.modal_backend || "unknown";
}

async function version(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const asJson = args.includes("--json");
  const payload = {
    cli: {
      name: CLI_NAME,
      version: CLI_VERSION,
    },
    api_base: API_BASE,
  };

  try {
    const response = await getVersion();
    payload.remote_status = response.status;
    payload.remote = response.data;
  } catch (err) {
    payload.remote_error = err?.message || String(err);
  }

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`CLI: ${CLI_NAME} ${CLI_VERSION}`);
  console.log(`API Base: ${API_BASE}`);
  console.log(`API Mode: ${API_MODE}`);

  if (payload.remote_error) {
    console.log(`Modal: unavailable (${payload.remote_error})`);
    process.exitCode = 1;
    return;
  }

  console.log(`Modal Backend: ${extractModalVersion(payload.remote)}`);
  if (payload.remote?.versions?.modal_sdk) {
    console.log(`Modal SDK: ${payload.remote.versions.modal_sdk}`);
  }
  if (payload.remote?.versions?.git_sha) {
    console.log(`Backend Git SHA: ${payload.remote.versions.git_sha}`);
  }
}

module.exports = { version };
