const { ZERO_ADDRESS } = require("@uma/common");

const func = async function (hre) {
  const { deployments, getNamedAccounts, web3 } = hre;
  const { deploy, save } = deployments;

  const { deployer } = await getNamedAccounts();

  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };
  const VotingToken = await deployments.get("VotingToken");
  const Finder = await deployments.get("Finder");
  const SlashingLibrary = await deployments.get("FixedSlashSlashingLibrary");

  // Set the GAT to 5.5 million tokens. This is the number of tokens that must participate to resolve a vote.
  const gat = web3.utils.toBN(web3.utils.toWei("5500000", "ether"));

  // Set the SPAT to 25%. This is the percentage of staked tokens that must participate to resolve a vote.
  const spat = web3.utils.toBN(web3.utils.toWei("0.25", "ether"));

  const emissionRate = "640000000000000000"; // 0.64 UMA per second.

  const unstakeCooldown = 60 * 60 * 24 * 7; // 7 days

  // Set phase length to one day.
  const phaseLength = "86400";

  // A price request can roll, at maximum, 2 times before it is auto deleted (i.e on the 3rd roll it is auto deleted).
  const maxRolls = 2;

  // Bound how many requests can be made in a single round. After this maximum requests auto roll.
  const maxRequestsPerRound = 1000;

  // Note: this is a bit hacky, but we must have _some_ tokens in existence to set a GAT.
  const votingToken = new web3.eth.Contract(VotingToken.abi, VotingToken.address);
  await votingToken.methods.addMember(1, deployer).send({ from: deployer });
  await votingToken.methods.addMember(2, deployer).send({ from: deployer });
  const mintAmount = gat.addn(1).toString();
  await votingToken.methods.mint(deployer, mintAmount).send({ from: deployer });

  if (Timer.address === ZERO_ADDRESS) {
    await deploy("VotingV2", {
      from: deployer,
      args: [
        emissionRate,
        unstakeCooldown,
        phaseLength,
        maxRolls,
        maxRequestsPerRound,
        gat.toString(),
        spat.toString(),
        VotingToken.address,
        Finder.address,
        SlashingLibrary.address,
        ZERO_ADDRESS,
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });
  } else {
    const submission = await deploy("VotingV2ControllableTiming", {
      from: deployer,
      args: [
        emissionRate,
        unstakeCooldown,
        phaseLength,
        maxRolls,
        maxRequestsPerRound,
        gat.toString(),
        spat.toString(),
        VotingToken.address,
        Finder.address,
        SlashingLibrary.address,
        ZERO_ADDRESS,
        Timer.address,
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    // Save this under VotingV2 as well.
    await save("VotingV2", submission);
  }

  // Destroy the tokens minted above.
  await votingToken.methods.burn(mintAmount).send({ from: deployer });
  await votingToken.methods.removeMember(1, deployer).send({ from: deployer });
  await votingToken.methods.removeMember(2, deployer).send({ from: deployer });
};
module.exports = func;
func.tags = ["dvmv2"];
func.dependencies = ["VotingToken", "Finder", "Timer", "FixedSlashSlashingLibrary"];
