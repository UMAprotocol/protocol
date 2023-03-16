// This script generates and submits the transaction to register in the Registry and add to the Finder an arbitrary new
// contract in mainnet and layer 2 blockchains. It can be run on a local hardhat node fork of the mainnet or can be run
// directly on the mainnet to execute the upgrade transactions.
// To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script:
// NODE_URL_10=<OPTIMISM-NODE-URL> \
// NODE_URL_288=<BOBA-NODE-URL> \
// NODE_URL_137=<POLYGON-NODE-URL> \
// NODE_URL_42161=<ARBITRUM-NODE-URL> \
// yarn hardhat run ./src/upgrade-tests/register-new-contract/1_Propose.ts --network localhost

import {
  BaseContract,
  BigNumberish,
  BytesLike,
  FinderEthers,
  fundArbitrumParentMessengerForRelays,
  getAddress,
  getContractInstance,
  getContractInstanceByUrl,
  GovernorEthers,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  hre,
  newContractName,
  ParentMessengerBaseEthers,
  PopulatedTransaction,
  ProposerEthers,
  RegistryEthers,
  RegistryRolesEnum,
  relayGovernanceMessages,
  Signer,
  Wallet,
  getGckmsSigner,
  Provider,
} from "./common";

// PARAMETERS
const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

// Env vars
const NODE_URL_ENV = "NODE_URL_";

async function main() {
  let proposerSigner: Signer;

  if (process.env.GCKMS_WALLET) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(hre.ethers.provider as Provider);
    if (proposerWallet.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    proposerSigner = (await hre.ethers.getSigner(proposerWallet)) as Signer;
  }

  const newContractAddressMainnet = await getAddress(newContractName, 1);

  const finder = await getContractInstance<FinderEthers>("Finder");
  const governor = await getContractInstance<GovernorEthers>("Governor");
  const registry = await getContractInstance<RegistryEthers>("Registry");
  const proposer = await getContractInstance<ProposerEthers>("Proposer");
  const arbitrumParentMessenger = await getContractInstance<ParentMessengerBaseEthers>("Arbitrum_ParentMessenger");

  const governorRootTunnel = await getContractInstance<GovernorRootTunnelEthers>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub"); // rest of l2

  const l2Networks = { BOBA: 288, MATIC: 137, OPTIMISM: 10, ARBITRUM: 42161 };

  const adminProposalTransactions: {
    to: string;
    value: BigNumberish;
    data: BytesLike;
  }[] = [];

  if (!newContractAddressMainnet) throw new Error(`No ${newContractName} address found in mainnet deployment`);

  for (const networkName in l2Networks) {
    const governanceMessages: { targetAddress: string; tx: PopulatedTransaction }[] = [];
    const l2ChainId = l2Networks[networkName as keyof typeof l2Networks];
    const l2NodeUrl = process.env[String(NODE_URL_ENV + l2ChainId)];
    const l2NewContractAddress = await getAddress(newContractName, l2ChainId);

    if (!l2NodeUrl || !l2NewContractAddress) throw new Error(`Missing ${networkName} network config`);

    const isPolygon = l2ChainId === 137;
    const isArbitrum = l2ChainId === 42161;

    const l2Registry = await getContractInstanceByUrl<RegistryEthers>("Registry", l2NodeUrl);

    // The l2Governor in polygon is the GovernorChildTunnel and in the rest of the l2's is the GovernorHub
    const l2Governor = await getContractInstanceByUrl<BaseContract>(
      isPolygon ? "GovernorChildTunnel" : "GovernorSpoke",
      l2NodeUrl
    );
    const l2Finder = await getContractInstanceByUrl<FinderEthers>("Finder", l2NodeUrl);

    if (await l2Registry.isContractRegistered(l2NewContractAddress)) continue;

    console.log(`Registering ${l2NewContractAddress} on ${networkName}`);

    // Fund Arbitrum if needed for next 4 transactions
    if (isArbitrum) await fundArbitrumParentMessengerForRelays(arbitrumParentMessenger, proposerSigner, 4);

    // 1. Temporarily add the GovernorChildTunnel/GovernorSpoke  as a contract creator.
    const addMemberDataTx = await l2Registry.populateTransaction.addMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      l2Governor.address
    );

    governanceMessages.push({ targetAddress: l2Registry.address, tx: addMemberDataTx });

    console.log("AddMemberData", addMemberDataTx);

    // 2. Register the new contract as a verified contract.
    const registerNewContractData = await l2Registry.populateTransaction.registerContract([], l2NewContractAddress);

    governanceMessages.push({ targetAddress: l2Registry.address, tx: registerNewContractData });

    console.log("RegisterNewContractData", registerNewContractData);

    // 3. Remove the l2Governor from being a contract creator.
    const removeMemberData = await l2Registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      l2Governor.address
    );

    governanceMessages.push({ targetAddress: l2Registry.address, tx: removeMemberData });

    console.log("RemoveMemberData", removeMemberData);

    // 4. Set contract in finder.
    const setFinderData = await l2Finder.populateTransaction.changeImplementationAddress(
      hre.ethers.utils.formatBytes32String(newContractName),
      l2NewContractAddress
    );

    governanceMessages.push({ targetAddress: l2Finder.address, tx: setFinderData });

    const relayedMessages = await relayGovernanceMessages(
      governanceMessages,
      isPolygon ? governorRootTunnel : governorHub,
      l2ChainId
    );

    console.log("ChangeImplementationAddressData", setFinderData);

    adminProposalTransactions.push(...relayedMessages);
  }

  if (!(await registry.isContractRegistered(newContractAddressMainnet))) {
    console.log(`Registering ${newContractAddressMainnet} on mainnet`);
    // Mainnet
    // 1. Temporarily add the Governor as a contract creator.
    const addGovernorToRegistryTx = await registry.populateTransaction.addMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!addGovernorToRegistryTx.data) throw new Error("addGovernorToRegistryTx.data is empty");
    console.log("AddGovernorToRegistryTx", addGovernorToRegistryTx);
    adminProposalTransactions.push({ to: registry.address, value: 0, data: addGovernorToRegistryTx.data });

    // 2. Register the new contract as a verified contract.
    const registerNewContractTx = await registry.populateTransaction.registerContract([], newContractAddressMainnet);
    if (!registerNewContractTx.data) throw new Error("registerNewContractTx.data is empty");
    console.log("RegisterNewContractTx", registerNewContractTx);
    adminProposalTransactions.push({ to: registry.address, value: 0, data: registerNewContractTx.data });

    // 3. Remove the Governor from being a contract creator.
    const removeGovernorFromRegistryTx = await registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!removeGovernorFromRegistryTx.data) throw new Error("removeGovernorFromRegistryTx.data is empty");
    console.log("RemoveGovernorFromRegistryTx", removeGovernorFromRegistryTx);
    adminProposalTransactions.push({ to: registry.address, value: 0, data: removeGovernorFromRegistryTx.data });

    // 4. Add the new contract to the Finder.
    const addNewContractToFinderTx = await finder.populateTransaction.changeImplementationAddress(
      hre.ethers.utils.formatBytes32String(newContractName),
      newContractAddressMainnet
    );
    if (!addNewContractToFinderTx.data) throw new Error("addNewContractToFinderTx.data is empty");
    console.log("AddNewContractToFinderTx", addNewContractToFinderTx);
    adminProposalTransactions.push({ to: finder.address, value: 0, data: addNewContractToFinderTx.data });
  }

  console.log("Proposing...");

  const tx = await proposer.connect(proposerSigner).propose(adminProposalTransactions, {
    gasLimit: 10_000_000,
  });

  console.log("Proposal Done.");

  console.log("PROPOSAL DATA:");
  console.log(tx.data);
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
