const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const FundingRateStore = artifacts.require("FundingRateStore");
const { interfaceName, getKeysForNetwork, deploy, enableControllableTiming } = require("@uma/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // .deployed() will fail if called on a network where the is no Timer (!controllableTiming).
  const timerAddress = controllableTiming
    ? (await Timer.deployed()).address
    : "0x0000000000000000000000000000000000000000";

  const finder = await Finder.deployed();

  // Deploy Store.
  const proposalLiveness = 7200; // 2 hours.
  const proposalBondPct = web3.utils.toWei("0.0008");
  const { contract: fundingRateStore } = await deploy(
    deployer,
    network,
    FundingRateStore,
    proposalLiveness,
    finder.address,
    timerAddress,
    { rawValue: proposalBondPct },
    { from: keys.deployer }
  );

  // Point Finder to newly deployed contract.
  await finder.changeImplementationAddress(
    web3.utils.utf8ToHex(interfaceName.FundingRateStore),
    fundingRateStore.address,
    {
      from: keys.deployer
    }
  );
};
