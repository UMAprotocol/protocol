// Helper for getting the configuration file to run the script
// example: see how its used in apps/DeployerRewards
require("dotenv").config();
const assert = require("assert");
const Path = require("path");

module.exports = () => {
  const [, , configPath] = process.argv;
  assert(configPath, "Requires relative path to config params");
  return require(Path.join(process.cwd(), configPath));
};
