// Description:
// - Add new Contract Creator on Ethereum and/or Polygon.

// Run:
// - For testing, start mainnet fork in one window with `HARDHAT_CHAIN_ID=1 yarn hardhat node --fork <ARCHIVAL_NODE_URL> --no-deploy --port 9545`
// - Set NODE_URL_1 to mainnet node URL or if using a forked network, http://localhost:9545
// - (optional, or required if --polygon is not undefined) set NODE_URL_137 to a Polygon mainnet node. This will
//   be used to query contract data from Polygon when relaying proposals through the GovernorRootTunnel.
// - (optional, or required if --arbitrum is not undefined) set NODE_URL_42161 to an Arbitrum mainnet node. This will
//   be used to query contract data from Arbitrum when relaying proposals through the GovernorHub.
// - Next, open another terminal window and run `./packages/scripts/setupFork.sh` to unlock
//   accounts on the local node that we'll need to run this script.
// - Propose: node ./packages/scripts/src/admin-proposals/addContractCreator.js --ethereum 0xabc --polygon 0xdef --network mainnet-fork
// - Vote Simulate: node ./packages/src/scripts/admin-proposals/simulateVote.js --network mainnet-fork
// - Verify: node ./packages/scripts/src/admin-proposals/addContractCreator.js --verify --ethereum 0xabc --polygon 0xdef --network mainnet-fork
// - For production, set the CUSTOM_NODE_URL environment, run the script with a production network passed to the
//   `--network` flag (along with other params like --keys) like so: `node ... --network mainnet_gckms --keys deployer`

// Customizations:
// - --polygon param is optional.
// - --arbitrum param is optional.
// - --ethereum flag is optional, in which case transactions will only be relayed to other specified networks.
// - If --verify flag is set, script is assumed to be running after a Vote Simulation and updated contract state is
// verified.

// Examples:
// - Add contract creator on Ethereum only:
//    - `node ./packages/scripts/src/admin-proposals/addContractCreator.js --ethereum 0xabc --network mainnet-fork`
// - Add contract creator on Polygon only:
//    - `node ./packages/scripts/src/admin-proposals/addContractCreator.js --polygon 0xabc --network mainnet-fork`
// - Add contract creator on both:
//    - `node ./packages/scripts/src/admin-proposals/addContractCreator.js --ethereum 0xabc --polygon 0xdef --network mainnet-fork`

const assert = require("assert");
const Web3 = require("Web3");
const { fromWei } = Web3.utils;
require("dotenv").config();
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");
const { RegistryRolesEnum, getWeb3ByChainId } = require("@uma/common");
const { setupNetwork, validateNetworks, setupMainnet } = require("./utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("../utils/constants");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // address to add on Ethereum.
    "ethereum",
    // address to add on Polygon.
    "polygon",
    // address to add on arbitrum.
    "arbitrum",
  ],
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

async function run() {
  const { ethereum, polygon, arbitrum, verify } = argv;
  if (!(polygon || ethereum || arbitrum)) throw new Error("Must specify either --ethereum, --polygon or --arbitrum");

  // Parse comma-delimited CLI params into arrays
  const networksToAdministrate = [];
  if (polygon) networksToAdministrate.push(137);
  if (arbitrum) networksToAdministrate.push(42161);
  validateNetworks(networksToAdministrate);
  let web3Providers = { 1: getWeb3ByChainId(1) }; // netID => Web3

  // Construct all mainnet contract instances we'll need using the mainnet web3 provider.
  const mainnetContracts = await setupMainnet(web3Providers[1]);

  // Store contract instances for specified L2 networks
  let contractsByNetId = {}; // netId => contracts
  for (let netId of networksToAdministrate) {
    const networkData = await setupNetwork(netId);
    web3Providers[netId] = networkData.web3;
    contractsByNetId[netId] = networkData.contracts;
    console.group(`\nℹ️  Relayer infrastructure for network ${netId}:`);
    console.log(`- Registry @ ${contractsByNetId[netId].registry.options.address}`);
    console.log(
      `- ${netId === 137 ? "GovernorRootTunnel" : "GovernorHub"} @ ${
        contractsByNetId[netId].l1Governor.options.address
      }`
    );
    console.groupEnd();
  }

  // GasEstimator only needs to be connected to mainnet since we're only deploying contracts to mainnet:
  const gasEstimator = new GasEstimator(
    winston.createLogger({ silent: true }),
    60, // Time between updates.
    1
  );
  await gasEstimator.update();
  console.log(
    `⛽️ Current fast gas price for Ethereum: ${fromWei(
      gasEstimator.getCurrentFastPrice().maxFeePerGas.toString(),
      "gwei"
    )} maxFeePerGas and ${fromWei(
      gasEstimator.getCurrentFastPrice().maxPriorityFeePerGas.toString(),
      "gwei"
    )} maxPriorityFeePerGas`
  );

  if (!verify) {
    console.group("\n🌠 Proposing new Admin Proposal");

    const adminProposalTransactions = [];
    console.group("\n Key to understand the following logs:");
    console.log(
      "- 🟣 = Transactions to be submitted to the Polygon contracts are relayed via the GovernorRootTunnel on Ethereum. Look at this test for an example:"
    );
    console.log(
      "    - https://github.com/UMAprotocol/protocol/blob/349401a869e89f9b5583d34c1f282407dca021ac/packages/core/test/polygon/e2e.js#L221"
    );
    console.log(
      "- 🔴 = Transactions to be submitted to the Arbitrum contracts are relayed via the GovernorHub on Ethereum. Look at this test for an example:"
    );
    console.log(
      "    - https://github.com/UMAprotocol/protocol/blob/0d3cf208eaf390198400f6d69193885f45c1e90c/packages/core/test/cross-chain-oracle/chain-adapters/Arbitrum_ParentMessenger.js#L253"
    );
    console.log("- 🟢 = Transactions to be submitted directly to Ethereum contracts.");
    console.groupEnd();

    if (ethereum) {
      console.group(`\n🟢 Adding new contract creator @ ${ethereum}`);
      if (!(await mainnetContracts.registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, ethereum).call())) {
        const addMemberData = mainnetContracts.registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, ethereum)
          .encodeABI();
        console.log("- addMemberData", addMemberData);
        adminProposalTransactions.push({
          to: mainnetContracts.registry.options.address,
          value: 0,
          data: addMemberData,
        });
      } else {
        console.log("- Contract @ ", ethereum, "is already a contract creator. Nothing to do.");
      }

      console.groupEnd();
    }

    if (polygon) {
      console.group(`\n🟣 (Polygon) Adding new contract creator @ ${polygon}`);

      if (
        !(await contractsByNetId[137].registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, polygon).call())
      ) {
        const addMemberData = contractsByNetId[137].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, polygon)
          .encodeABI();
        console.log("- addMemberData", addMemberData);
        let relayGovernanceData = contractsByNetId[137].l1Governor.methods
          .relayGovernance(contractsByNetId[137].registry.options.address, addMemberData)
          .encodeABI();
        console.log("- relayGovernanceData", relayGovernanceData);
        adminProposalTransactions.push({
          to: contractsByNetId[137].l1Governor.options.address,
          value: 0,
          data: relayGovernanceData,
        });
      } else {
        console.log("- Contract @ ", polygon, "is already a contract creator. Nothing to do.");
      }

      console.groupEnd();
    }

    if (arbitrum) {
      console.group(`\n🔴 (Arbitrum) Adding new contract creator @ ${arbitrum}`);

      if (
        !(await contractsByNetId[42161].registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, arbitrum).call())
      ) {
        const addMemberData = contractsByNetId[42161].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, arbitrum)
          .encodeABI();
        console.log("- addMemberData", addMemberData);
        const calls = [{ to: contractsByNetId[42161].registry.options.address, data: addMemberData }];
        let relayGovernanceData = contractsByNetId[42161].l1Governor.methods.relayGovernance(42161, calls).encodeABI();
        console.log("- relayGovernanceData", relayGovernanceData);
        adminProposalTransactions.push({
          to: contractsByNetId[42161].l1Governor.options.address,
          value: 0,
          data: relayGovernanceData,
        });

        // Transaction will fail unless Arbitrum messenger has enough ETH to pay for message:
        const l1CallValue = await mainnetContracts.arbitrumParentMessenger.methods.getL1CallValue().call();
        console.log(
          `Arbitrum xchain messages require that the Arbitrum_ParentMessenger has at least a ${l1CallValue.toString()} ETH balance.`
        );
        const sendEthTxn = await web3Providers[1].eth.sendTransaction({
          from: REQUIRED_SIGNER_ADDRESSES["deployer"],
          to: mainnetContracts.arbitrumParentMessenger.options.address,
          value: l1CallValue.toString(),
        });
        console.log(`Sent ETH txn: ${sendEthTxn.transactionHash}`);
      } else {
        console.log("- Contract @ ", arbitrum, "is already a contract creator. Nothing to do.");
      }

      console.groupEnd();
    }

    // Send the proposal
    console.group(`\n📨 Sending to governor @ ${mainnetContracts.governor.options.address}`);
    console.log(`- Admin proposal contains ${adminProposalTransactions.length} transactions`);
    if (adminProposalTransactions.length > 0) {
      const txn = await mainnetContracts.governor.methods
        .propose(adminProposalTransactions)
        .send({ from: REQUIRED_SIGNER_ADDRESSES["deployer"], ...gasEstimator.getCurrentFastPrice() });
      console.log("- Transaction: ", txn?.transactionHash);

      // Print out details about new Admin proposal
      const priceRequests = await mainnetContracts.oracle.getPastEvents("PriceRequestAdded");
      const newAdminRequest = priceRequests[priceRequests.length - 1];
      console.log(
        `- New admin request {identifier: ${
          newAdminRequest.returnValues.identifier
        }, timestamp: ${newAdminRequest.returnValues.time.toString()}}`
      );
    } else {
      console.log("- 0 Transactions in Admin proposal. Nothing to do");
    }
    console.groupEnd();
  } else {
    console.group("\n🔎 Verifying execution of Admin Proposal");
    if (ethereum) {
      assert(
        await mainnetContracts.registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, ethereum),
        "Contract does not hold creator role"
      );
      console.log(`- Contract @ ${ethereum} holds creator role on Ethereum`);
    }

    if (polygon) {
      if (
        !(await contractsByNetId[137].registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, polygon).call())
      ) {
        const addMemberData = contractsByNetId[137].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, polygon)
          .encodeABI();
        const relayedRegistryTransactions = await contractsByNetId[137].l1Governor.getPastEvents(
          "RelayedGovernanceRequest",
          { filter: { to: contractsByNetId[137].registry.options.address }, fromBlock: 0 }
        );
        assert(
          relayedRegistryTransactions.find((e) => e.returnValues.data === addMemberData),
          "Could not find RelayedGovernanceRequest matching expected relayed addMemberData transaction"
        );
        console.log(
          `- GovernorRootTunnel correctly emitted events to registry ${contractsByNetId[137].registry.options.address} containing addMember data`
        );
      } else {
        console.log("- Contract @ ", polygon, "is already a contract creator on Polygon. Nothing to check.");
      }
    }

    if (arbitrum) {
      if (
        !(await contractsByNetId[42161].registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, arbitrum).call())
      ) {
        const addMemberData = contractsByNetId[42161].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, arbitrum)
          .encodeABI();
        const calls = [{ to: contractsByNetId[42161].registry.options.address, data: addMemberData }];
        const relayedRegistryTransactions = await contractsByNetId[42161].l1Governor.getPastEvents(
          "RelayedGovernanceRequest",
          {
            filter: { chainId: "42161", messenger: mainnetContracts.arbitrumParentMessenger.options.address },
            fromBlock: 0,
          }
        );
        assert(
          relayedRegistryTransactions.find((e) => e.returnValues.calls === calls),
          "Could not find RelayedGovernanceRequest matching expected relayed addMemberData transaction"
        );
        console.log(
          `- GovernorHub correctly emitted events to registry ${contractsByNetId[42161].registry.options.address} containing addMember data`
        );
      } else {
        console.log("- Contract @ ", arbitrum, "is already a contract creator on Arbitrum. Nothing to check.");
      }
    }
  }
  console.groupEnd();

  console.log("\n😇 Success!");
}

function main() {
  const startTime = Date.now();
  run()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      const timeElapsed = Date.now() - startTime;
      console.log(`Done in ${(timeElapsed / 1000).toFixed(2)}s`);
    });
}
main();
