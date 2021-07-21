const { getContractDefinition } = require("@eth-optimism/contracts");
const { smockit } = require("@eth-optimism/smock");

const hre = require("hardhat");
const { ethers } = hre;

async function deployOptimismContractMock(name, opts) {
  const artifact = getContractDefinition(name);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  return await smockit(factory, opts);
  //   const mock = await smockit(factory, opts);
  //   // create an options prop and put the address within it. This is done to match hardhat web3 syntax for consistency
  //   // within unit tests that use this mock.
  //   mock.options.address = mock.address;
  //   return mock;
}

module.exports = { deployOptimismContractMock };
