/**
 * CLI version metadata shared across commands.
 */

const pkg = require("../package.json");

const CLI_NAME = pkg.name || "snake-arena";
const CLI_VERSION = pkg.version || "0.0.0";

module.exports = {
  CLI_NAME,
  CLI_VERSION,
};
