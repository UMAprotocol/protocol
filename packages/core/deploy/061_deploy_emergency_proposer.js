// Custom settings based on network.
const CUSTOM_PARAMETERS = {
  1: { emergencyMinimumWaitTime: 60 * 60 * 24 * 10 }, // 10 days
  11155111: { emergencyMinimumWaitTime: 60 * 60 * 24 }, // 1 day
};

const func = async function (hre) {
  const { deployments, getNamedAccounts, web3, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const customParameters = chainId in CUSTOM_PARAMETERS;

  const GovernorV2 = await deployments.get("GovernorV2");
  const VotingToken = await deployments.get("VotingToken");

  const emergencyQuorum = web3.utils.toBN(web3.utils.toWei("5000000", "ether"));

  // 10 days.
  const emergencyMinimumWaitTime = customParameters
    ? CUSTOM_PARAMETERS[chainId].emergencyMinimumWaitTime
    : 60 * 60 * 24 * 10;

  // Note: this is a bit hacky, but we must have _some_ tokens in existence to set a emergencyQuorum.
  const votingToken = new web3.eth.Contract(VotingToken.abi, VotingToken.address);
  await votingToken.methods.addMember(1, deployer).send({ from: deployer });
  await votingToken.methods.addMember(2, deployer).send({ from: deployer });
  const mintAmount = emergencyQuorum.addn(1).toString();
  await votingToken.methods.mint(deployer, mintAmount).send({ from: deployer });

  await deploy("EmergencyProposer", {
    from: deployer,
    args: [VotingToken.address, emergencyQuorum.toString(), GovernorV2.address, deployer, emergencyMinimumWaitTime],
    log: true,
    skipIfAlreadyDeployed: true,
  });

  // Destroy the tokens minted above.
  await votingToken.methods.burn(mintAmount).send({ from: deployer });
  await votingToken.methods.removeMember(1, deployer).send({ from: deployer });
  await votingToken.methods.removeMember(2, deployer).send({ from: deployer });
};
module.exports = func;
func.tags = ["EmergencyProposer", "dvmv2"];
func.dependencies = ["VotingToken", "GovernorV2"];
