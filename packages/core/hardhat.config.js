// TODO: We should refactor this into common and combine it with common/HardhatConfig.js

const { getHardhatConfig, getNodeUrl, mnemonic } = require("@uma/common");

require("dotenv").config();
const path = require("path");
const coreWkdir = path.dirname(require.resolve("@uma/core/package.json"));
const packageWkdir = path.dirname(require.resolve("@uma/core/package.json"));

require("hardhat-deploy");
require("@nomiclabs/hardhat-ethers");

// Note: For now we assume that a MNEMONIC is set in the environment and derive signing accounts from it. Hardhat also
// supports other ways to describe an HD wallet: https://hardhat.org/config/#hd-wallet-config.
// Note: To make `getNodeUrl` work, the user must set a CUSTOM_NODE_URL that points to an HTTPS node.
const configOverride = {
  namedAccounts: {
    deployer: 0
  },
  paths: {
    root: coreWkdir,
    sources: `${coreWkdir}/contracts`,
    artifacts: `${coreWkdir}/artifacts`,
    cache: `${coreWkdir}/cache`,
    tests: `${packageWkdir}/test`
  },
  networks: {
    hardhat: {},
    rinkeby: {
      url: getNodeUrl("rinkeby", true),
      accounts: { mnemonic }
    },
    goerli: {
      url: getNodeUrl("goerli", true),
      accounts: { mnemonic }
    },
    mumbai: {
      url: "https://rpc-mumbai.maticvigil.com/",
      accounts: { mnemonic }
    }
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_API_KEY
  }
};

// Tasks: These tasks are conveniently available via the hardhat CLI: `yarn hardhat <TASK>`
// Documentation on creating tasks here: https://hardhat.org/guides/create-task.html
require("./scripts/hardhat/tasks");

module.exports = getHardhatConfig(configOverride);
