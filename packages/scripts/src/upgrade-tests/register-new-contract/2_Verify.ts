// This script verify that the new contract has been added correctly to the Registry and Finder in mainnet and that
// the relay transactions have been sent. It can be run on a local hardhat node fork of the mainnet or can be run
// directly on the mainnet to verify. To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core with the PROPOSAL_DATA logged by  ./src/upgrade-tests/register-new-contract/1_Propose.ts:
// PROPOSAL_DATA=<PROPOSAL_DATA> yarn hardhat run ./src/upgrade-tests/register-new-contract/2_Verify.ts --network localhost

import {
  assert,
  decodeData,
  decodeRelayMessages,
  FinderEthers,
  getAddress,
  getContractInstance,
  GovernorEthers,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  hre,
  newContractName,
  ProposedTransaction,
  RegistryEthers,
  RegistryRolesEnum,
  RelayTransaction,
} from "./common";

const verifyGovernanceHubMessage = async (
  governorHub: GovernorHubEthers,
  relayProposal: RelayTransaction,
  fromBlock: number
) => {
  const relayedTransactions = await governorHub.filters.RelayedGovernanceRequest(
    Number(relayProposal.transaction.params?.chainId),
    undefined,
    undefined,
    undefined
  );

  const events = await governorHub.queryFilter(relayedTransactions, fromBlock, "latest");

  const found = events.find(
    (e) =>
      e.args.calls[0].data === relayProposal.transaction.params?.calls[0].data &&
      e.args.calls[0].to == relayProposal.transaction.params?.calls[0].to
  );
  assert(found, "Could not find RelayedGovernanceRequest matching expected relayed message");
};

const verifyGovernanceRootTunnelMessage = async (
  governorRootTunnel: GovernorRootTunnelEthers,
  relayProposal: RelayTransaction,
  fromBlock: number
) => {
  const relayedTransactions = await governorRootTunnel.filters.RelayedGovernanceRequest(
    relayProposal.transaction.params.to,
    undefined
  );
  const events = await governorRootTunnel.queryFilter(relayedTransactions, fromBlock, "latest");

  assert(
    events.find((e) => e.args.data === relayProposal.transaction.params?.data),
    "Could not find RelayedGovernanceRequest matching expected relayed transaction"
  );
};

async function main() {
  const callData = process.env["PROPOSAL_DATA"];
  if (!callData) throw new Error("PROPOSAL_DATA environment variable not set");

  const networkId = await hre.ethers.provider.getNetwork().then((network) => network.chainId);

  const finder = await getContractInstance<FinderEthers>("Finder");
  const governor = await getContractInstance<GovernorEthers>("Governor");
  const registry = await getContractInstance<RegistryEthers>("Registry");

  const startLookupBlock = (await await registry.provider.getBlockNumber()) - 250; // ~ 1hour ago

  const { governorRootRelays, governorHubRelays } = decodeRelayMessages(callData);

  const registryL1Calls = decodeData(callData).params.transactions.filter(
    (transaction: ProposedTransaction) => transaction.to === registry.address
  );

  const registerContractTransactions = registryL1Calls.find(
    (transaction: ProposedTransaction) => decodeData(transaction.data).name === "registerContract"
  );

  const registerTx = decodeData(registerContractTransactions.data);

  const newContractAddressMainnet = registerTx.params.contractAddress;

  const newContractAddressCheck = await getAddress(newContractName, Number(networkId));

  console.log("Verifying that new contract address is correct...");
  assert.equal(newContractAddressMainnet, newContractAddressCheck);

  const governorRootTunnel = await getContractInstance<GovernorRootTunnelEthers>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub"); // rest of l2

  console.log("Verifying GovernorHub relays...");
  for (const relay of governorHubRelays) {
    await verifyGovernanceHubMessage(governorHub, relay, startLookupBlock);
  }
  console.log("Verified!");

  console.log("Verifying GovernorRootTunnel relays...");
  for (const relay of governorRootRelays) {
    await verifyGovernanceRootTunnelMessage(governorRootTunnel, relay, startLookupBlock);
  }
  console.log("Verified!");

  console.log("Verifying that Governor doesn't hold the creator role...");
  !(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governor.address));
  console.log("Verified!");

  console.log("Verifying that the New Contract is registered with the Registry...");
  assert(await registry.isContractRegistered(newContractAddressMainnet));
  console.log("Verified!");

  console.log("Verifying that the New Contract is registered with the Finder...");
  assert.equal(
    (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(newContractName))).toLowerCase(),
    newContractAddressMainnet.toLowerCase()
  );
  console.log("Verified!");

  console.log("Upgrade Verified!");
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
