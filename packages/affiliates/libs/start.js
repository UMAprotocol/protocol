// This file is a common bootstrapping library to initialize configs and web3 apps in the /apps dir.
// It expects a function to be passed in. This file is repsonsible for constructing the configuration
// file and other dependencies for that function and injecting it. The idea is that any app would share
// the same pattern for getting configuration and dependencies.
// example: see how its used in apps/DeployerRewards
require("dotenv").config();
const assert = require("assert");
const Web3 = require("web3");
const Path = require("path");
const [, , configPath] = process.argv;

assert(configPath, "Requires relative path to config params");
const config = require(Path.join(process.cwd(), configPath));
assert(process.env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");

module.exports = async App => {
  const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));
  return App(config, { web3 });
};
