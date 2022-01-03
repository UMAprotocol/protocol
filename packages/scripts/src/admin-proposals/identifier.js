// Description:
// - Whitelist new identifiers.

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - Propose: node ./packages/scripts/src/admin-proposals/identifier.js --ethereum ABC,DEF --polygon ABC,DEF --network mainnet-fork
// - Verify: Add --verify flag to Propose command.

require("dotenv").config();
const Web3 = require("Web3");
const { utf8ToHex, hexToUtf8 } = Web3.utils;
const assert = require("assert");
const { getWeb3ByChainId } = require("@uma/common");
const {
  setupNetwork,
  validateNetworks,
  setupMainnet,
  fundArbitrumParentMessengerForOneTransaction,
  setupGasEstimator,
} = require("./utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("../utils/constants");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // comma-delimited list of identifiers to whitelist on Ethereum.
    "ethereum",
    // comma-delimited list of identifiers to whitelist on Polygon.
    "polygon",
    // comma-delimited list of identifiers to whitelist on Arbitrum.
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
  const identifiersByNetId = {};
  let count;
  if (ethereum) {
    identifiersByNetId[1] = ethereum.split(",").map((id) => (id ? utf8ToHex(id) : null));
    count = identifiersByNetId[1].length;
  }
  if (polygon) {
    networksToAdministrate.push(137);
    identifiersByNetId[137] = polygon.split(",").map((id) => (id ? utf8ToHex(id) : null));
    count = identifiersByNetId[1].length;
  }
  if (arbitrum) {
    networksToAdministrate.push(42161);
    identifiersByNetId[42161] = arbitrum.split(",").map((id) => (id ? utf8ToHex(id) : null));
    count = identifiersByNetId[1].length;
  }
  validateNetworks(networksToAdministrate);
  let web3Providers = { 1: getWeb3ByChainId(1) }; // netID => Web3

  for (let id of Object.keys(identifiersByNetId)) {
    if (identifiersByNetId[id].length !== count)
      throw new Error("all comma-delimited input strings should result in equal length arrays");
  }
  // Construct all mainnet contract instances we'll need using the mainnet web3 provider.
  const mainnetContracts = await setupMainnet(web3Providers[1]);
  const gasEstimator = await setupGasEstimator();

  // Store contract instances for specified L2 networks
  let contractsByNetId = {}; // netId => contracts
  for (let netId of networksToAdministrate) {
    const networkData = await setupNetwork(netId);
    web3Providers[netId] = networkData.web3;
    contractsByNetId[netId] = networkData.contracts;
    console.group(`\nℹ️  Relayer infrastructure for network ${netId}:`);
    console.log(`- IdentifierWhitelist @ ${contractsByNetId[netId].identifierWhitelist.options.address}`);
    console.log(
      `- ${netId === 137 ? "GovernorRootTunnel" : "GovernorHub"} @ ${
        contractsByNetId[netId].l1Governor.options.address
      }`
    );
    console.groupEnd();
  }

  if (!verify) {
    console.group("\n🌠 Proposing new Admin Proposal");

    const adminProposalTransactions = [];
    console.group("\n Key to understand the following logs:");
    console.log(
      "- 🟣 = Transactions to be submitted to the Polygon contracts are relayed via the GovernorRootTunnel on Etheruem. Look at this test for an example:"
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

    for (let i = 0; i < count; i++) {
      if (identifiersByNetId[1] && identifiersByNetId[1][i]) {
        console.group(
          `\n🟢 Whitelisting identifier ${identifiersByNetId[1][i]} (UTF8: ${hexToUtf8(identifiersByNetId[1][i])})`
        );

        // The proposal will only whitelist a new identifier if it isn't already whitelisted.
        if (
          !(await mainnetContracts.identifierWhitelist.methods.isIdentifierSupported(identifiersByNetId[1][i]).call())
        ) {
          const addSupportedIdentifierData = mainnetContracts.identifierWhitelist.methods
            .addSupportedIdentifier(identifiersByNetId[1][i])
            .encodeABI();
          console.log("- addSupportedIdentifierData", addSupportedIdentifierData);
          adminProposalTransactions.push({
            to: mainnetContracts.identifierWhitelist.options.address,
            value: 0,
            data: addSupportedIdentifierData,
          });
        } else {
          console.log("- Identifier is already on whitelist. Nothing to do.");
        }
        console.groupEnd();
      }

      if (identifiersByNetId[137] && identifiersByNetId[137][i]) {
        console.group(
          `\n🟣 (Polygon) Whitelisting identifier ${identifiersByNetId[137][i]} (UTF8: ${hexToUtf8(
            identifiersByNetId[137][i]
          )})`
        );

        // The proposal will only whitelist a new identifier if it isn't already whitelisted.
        if (
          !(await contractsByNetId[137].identifierWhitelist.methods
            .isIdentifierSupported(identifiersByNetId[137][i])
            .call())
        ) {
          const addSupportedIdentifierData = contractsByNetId[137].identifierWhitelist.methods
            .addSupportedIdentifier(identifiersByNetId[137][i])
            .encodeABI();
          console.log("- addSupportedIdentifierData", addSupportedIdentifierData);
          const relayGovernanceData = contractsByNetId[137].l1Governor.methods
            .relayGovernance(contractsByNetId[137].identifierWhitelist.options.address, addSupportedIdentifierData)
            .encodeABI();
          console.log("- relayGovernanceData", relayGovernanceData);
          adminProposalTransactions.push({
            to: contractsByNetId[137].l1Governor.options.address,
            value: 0,
            data: relayGovernanceData,
          });
        } else {
          console.log("- Identifier is already on whitelist. Nothing to do.");
        }
        console.groupEnd();
      }

      if (identifiersByNetId[42161] && identifiersByNetId[42161][i]) {
        console.group(
          `\n🔴  (Arbitrum) Whitelisting identifier ${identifiersByNetId[42161][i]} (UTF8: ${hexToUtf8(
            identifiersByNetId[137][i]
          )})`
        );

        // The proposal will only whitelist a new identifier if it isn't already whitelisted.
        if (
          !(await contractsByNetId[42161].identifierWhitelist.methods
            .isIdentifierSupported(identifiersByNetId[42161][i])
            .call())
        ) {
          const addSupportedIdentifierData = contractsByNetId[42161].identifierWhitelist.methods
            .addSupportedIdentifier(identifiersByNetId[42161][i])
            .encodeABI();
          console.log("- addSupportedIdentifierData", addSupportedIdentifierData);
          const calls = [
            { to: contractsByNetId[42161].identifierWhitelist.options.address, data: addSupportedIdentifierData },
          ];
          const relayGovernanceData = contractsByNetId[42161].l1Governor.methods
            .relayGovernance(42161, calls)
            .encodeABI();
          console.log("- relayGovernanceData", relayGovernanceData);
          adminProposalTransactions.push({
            to: contractsByNetId[42161].l1Governor.options.address,
            value: 0,
            data: relayGovernanceData,
          });
          await fundArbitrumParentMessengerForOneTransaction(
            mainnetContracts.arbitrumParentMessenger,
            web3Providers[1],
            REQUIRED_SIGNER_ADDRESSES["deployer"]
          );
        } else {
          console.log("- Identifier is already on whitelist. Nothing to do.");
        }
        console.groupEnd();
      }
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
    for (let i = 0; i < count; i++) {
      if (identifiersByNetId[1] && identifiersByNetId[1][i]) {
        assert(
          await mainnetContracts.identifierWhitelist.methods.isIdentifierSupported(identifiersByNetId[1][i]).call(),
          "Identifier is not whitelisted"
        );
        console.log(
          `- Identifier ${identifiersByNetId[1][i]} (UTF8: ${hexToUtf8(
            identifiersByNetId[1][i]
          )}) is whitelisted on Ethereum`
        );
      }

      if (identifiersByNetId[137] && identifiersByNetId[137][i]) {
        if (
          !(await contractsByNetId[137].identifierWhitelist.methods
            .isIdentifierSupported(identifiersByNetId[137][i])
            .call())
        ) {
          const addSupportedIdentifierData = contractsByNetId[137].identifierWhitelist.methods
            .addSupportedIdentifier(identifiersByNetId[137][i])
            .encodeABI();
          const relayedWhitelistTransactions = await contractsByNetId[137].l1Governor.getPastEvents(
            "RelayedGovernanceRequest",
            { filter: { to: contractsByNetId[137].identifierWhitelist.options.address }, fromBlock: 0 }
          );
          assert(
            relayedWhitelistTransactions.find((e) => e.returnValues.data === addSupportedIdentifierData),
            "Could not find RelayedGovernanceRequest matching expected relayed addSupportedIdentifier transaction"
          );
          console.log(
            `- GovernorRootTunnel correctly emitted events to whitelist identifier ${
              identifiersByNetId[137][i]
            } (UTF8: ${hexToUtf8(identifiersByNetId[137][i])})`
          );
        } else {
          console.log(
            `- Identifier ${identifiersByNetId[137][i]} (UTF8: ${hexToUtf8(
              identifiersByNetId[137][i]
            )}) is whitelisted on polygon. Nothing to check.`
          );
        }
      }

      if (identifiersByNetId[42161] && identifiersByNetId[42161][i]) {
        if (
          !(await contractsByNetId[42161].identifierWhitelist.methods
            .isIdentifierSupported(identifiersByNetId[42161][i])
            .call())
        ) {
          const addSupportedIdentifierData = contractsByNetId[42161].identifierWhitelist.methods
            .addSupportedIdentifier(identifiersByNetId[42161][i])
            .encodeABI();
          const calls = [{ to: contractsByNetId[42161].store.options.address, data: addSupportedIdentifierData }];
          const relayedWhitelistTransactions = await contractsByNetId[42161].l1Governor.getPastEvents(
            "RelayedGovernanceRequest",
            {
              filter: { chainId: "42161", messenger: mainnetContracts.arbitrumParentMessenger.options.address },
              fromBlock: 0,
            }
          );
          assert(
            relayedWhitelistTransactions.find((e) => e.returnValues.calls === calls),
            "Could not find RelayedGovernanceRequest matching expected relayed addSupportedIdentifierData transaction"
          );
          console.log(
            `- GovernorRootTunnel correctly emitted events to whitelist identifier ${
              identifiersByNetId[42161][i]
            } (UTF8: ${hexToUtf8(identifiersByNetId[42161][i])})`
          );
        } else {
          console.log(
            `- Identifier ${identifiersByNetId[42161][i]} (UTF8: ${hexToUtf8(
              identifiersByNetId[42161][i]
            )}) is whitelisted on arbitrum. Nothing to check.`
          );
        }
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
