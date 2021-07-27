const { getContractDefinition } = require("@eth-optimism/contracts");
const { smockit } = require("@eth-optimism/smock");

const hre = require("hardhat");

async function deployOptimismContractMock(name, opts) {
  const artifact = getContractDefinition(name);

  const factory = new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode);
  let mock = await smockit(factory, opts);
  // Create an options prop and put the address within it. This is done to match hardhat's web3 syntax for consistency
  // within unit tests that use this mock.
  mock.options = {};
  mock.options.address = mock.address;
  return mock;
}

module.exports = { deployOptimismContractMock };
