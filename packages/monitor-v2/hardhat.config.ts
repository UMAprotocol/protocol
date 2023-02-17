// Minimal config just to get bot tests to run.

import { HardhatUserConfig } from "hardhat/config";

import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {},
  },
};

export default config;
