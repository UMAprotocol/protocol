// Note: smockit is designed to run on the local hardhat network and not the optimism network.
const { getContractDefinition } = require("@eth-optimism/contracts");
const { smock } = require("@defi-wonderland/smock");
const chai = require("chai");
chai.use(smock.matchers);

// TODO: this function is now somewhat janky. if an artifact is provided then it ignores the optimism getContractDefinition
// and uses the provided artifact. else, it looks for an optimism contract matching to `name`. Refactor this to be clear
// of the optimism dependency. Left for a later PR as this will introduce a meaningful amount of churn.
async function deployContractMock(name, opts, artifact = null) {
  if (!artifact) artifact = getContractDefinition(name);
  // const factory = new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const mock = await smock.fake(artifact.abi, opts);
  // Create an options prop and put the address within it. This is done to match hardhat's web3 syntax for consistency
  // within unit tests that use this mock.
  mock.options = {};
  mock.options.address = mock.address;
  return mock;
}

module.exports = { deployContractMock };
