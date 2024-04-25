const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, get } = deployments;

  const { deployer } = await getNamedAccounts();

  const finderAddress = (await get("Finder")).address;
  const votingTokenAddress = (await get("VotingToken")).address;

  console.log(`Using finder @ ${finderAddress}`);
  console.log(`Using final fee currency @ ${votingTokenAddress}`);

  await deploy("OracleHub", {
    from: deployer,
    args: [
      finderAddress,
      votingTokenAddress, // Final fee currency paid by someone who wants to force speed up a cross chain price request.
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = [
  "OracleHub",
  "l1-arbitrum-xchain",
  "l1-boba-xchain",
  "l1-optimism-xchain",
  "l1-base-xchain",
  "l1-blast-xchain",
];
func.dependencies = ["Finder", "VotingToken"];
