const { ZERO_ADDRESS } = require("@uma/common");

// Custom settings based on network. We don't want to update hardcoded values in deploy script as tests depend on them.
const CUSTOM_PARAMETERS = {
  1: {
    gatEther: "5000000",
    spatEther: "0.5",
    emissionRate: "180000000000000000", // 0.18 UMA per second.
    unstakeCooldown: 60 * 60 * 24 * 7, // 7 days
    phaseLength: "86400", // 1 day
    maxRolls: 4,
  },
  11155111: {
    gatEther: "5000000",
    spatEther: "0.5",
    emissionRate: "180000000000000000", // 0.18 UMA per second.
    unstakeCooldown: 60, // 1 minute
    phaseLength: "600", // 10 minutes
    maxRolls: 144,
  },
};

const func = async function (hre) {
  const { deployments, getNamedAccounts, web3, getChainId } = hre;
  const { deploy, save } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const customParameters = chainId in CUSTOM_PARAMETERS;

  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };
  const VotingToken = await deployments.get("VotingToken");
  const Finder = await deployments.get("Finder");
  const SlashingLibrary = await deployments.get("FixedSlashSlashingLibrary");

  // Set the GAT to 5.5 million tokens. This is the number of tokens that must participate to resolve a vote.
  const gatEther = customParameters ? CUSTOM_PARAMETERS[chainId].gatEther : "5500000";
  const gat = web3.utils.toBN(web3.utils.toWei(gatEther, "ether"));

  // Set the SPAT to 25%. This is the percentage of staked tokens that must participate to resolve a vote.
  const spatEther = customParameters ? CUSTOM_PARAMETERS[chainId].spatEther : "0.25";
  const spat = web3.utils.toBN(web3.utils.toWei(spatEther, "ether"));

  const emissionRate = customParameters ? CUSTOM_PARAMETERS[chainId].emissionRate : "640000000000000000"; // 0.64 UMA per second.

  const unstakeCooldown = customParameters ? CUSTOM_PARAMETERS[chainId].unstakeCooldown : 60 * 60 * 24 * 7; // 7 days

  // Set phase length to one day.
  const phaseLength = customParameters ? CUSTOM_PARAMETERS[chainId].phaseLength : "86400";

  // A price request can roll, at maximum, 2 times before it is auto deleted (i.e on the 3rd roll it is auto deleted).
  const maxRolls = customParameters ? CUSTOM_PARAMETERS[chainId].maxRolls : 2;

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
