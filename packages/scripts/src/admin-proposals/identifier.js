// Description:
// - Whitelist new identifiers.

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - Propose: node ./packages/scripts/src/admin-proposals/identifier.js --ethereum ABC,DEF --polygon ABC,DEF --network mainnet-fork
// - Verify: Add --verify flag to Propose command.

require("dotenv").config();
const Web3 = require("web3");
const { utf8ToHex, hexToUtf8 } = Web3.utils;
const assert = require("assert");
const { getWeb3ByChainId } = require("@uma/common");
const {
  setupNetwork,
  validateNetworks,
  setupMainnet,
  fundArbitrumParentMessengerForOneTransaction,
  setupGasEstimator,
  relayGovernanceHubMessage,
  verifyGovernanceHubMessage,
  relayGovernanceRootTunnelMessage,
  verifyGovernanceRootTunnelMessage,
  L2_ADMIN_NETWORK_NAMES,
  validateArgvNetworks,
  getNetworksToAdministrateFromArgv,
  proposeAdminTransactions,
} = require("./utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("../utils/constants");
const argv = require("minimist")(process.argv.slice(), {
  string: L2_ADMIN_NETWORK_NAMES,
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

async function run() {
  validateArgvNetworks(argv);
  const { verify } = argv;
  const { ethereum, polygon, governorHubNetworks, chainIds } = getNetworksToAdministrateFromArgv(argv);
  validateNetworks(chainIds);

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
    if (!count) count = identifiersByNetId[137].length;
  }
  for (let network of governorHubNetworks) {
    networksToAdministrate.push(network.chainId);
    identifiersByNetId[network.chainId] = network.value.split(",").map((id) => (id ? utf8ToHex(id) : null));
    if (!count) count = identifiersByNetId[network.chainId].length;
  }
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
      "- 🔴 = Transactions to be submitted to networks with GovernorSpokes are relayed via the GovernorHub on Ethereum. Look at this test for an example:"
    );
    console.log(
      "    - https://github.com/UMAprotocol/protocol/blob/0d3cf208eaf390198400f6d69193885f45c1e90c/packages/core/test/cross-chain-oracle/chain-adapters/Arbitrum_ParentMessenger.js#L253"
    );
    console.log("- 🟢 = Transactions to be submitted directly to Ethereum contracts.");
    console.groupEnd();

    for (let i = 0; i < count; i++) {
      if (ethereum && identifiersByNetId[1][i]) {
        const identifier = identifiersByNetId[1][i];
        console.group(`\n🟢 Whitelisting identifier ${identifier} (UTF8: ${hexToUtf8(identifier)})`);

        // The proposal will only whitelist a new identifier if it isn't already whitelisted.
        if (!(await mainnetContracts.identifierWhitelist.methods.isIdentifierSupported(identifier).call())) {
          const addSupportedIdentifierData = mainnetContracts.identifierWhitelist.methods
            .addSupportedIdentifier(identifier)
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

      if (polygon && identifiersByNetId[137][i]) {
        const identifier = identifiersByNetId[137][i];
        console.group(`\n🟣 (Polygon) Whitelisting identifier ${identifier} (UTF8: ${hexToUtf8(identifier)})`);

        // The proposal will only whitelist a new identifier if it isn't already whitelisted.
        if (!(await contractsByNetId[137].identifierWhitelist.methods.isIdentifierSupported(identifier).call())) {
          const addSupportedIdentifierData = contractsByNetId[137].identifierWhitelist.methods
            .addSupportedIdentifier(identifier)
            .encodeABI();
          console.log("- addSupportedIdentifierData", addSupportedIdentifierData);
          adminProposalTransactions.push(
            await relayGovernanceRootTunnelMessage(
              contractsByNetId[137].identifierWhitelist.options.address,
              addSupportedIdentifierData,
              contractsByNetId[137].l1Governor
            )
          );
        } else {
          console.log("- Identifier is already on whitelist. Nothing to do.");
        }
        console.groupEnd();
      }

      for (const network of governorHubNetworks) {
        if (identifiersByNetId[network.chainId][i]) {
          const identifier = identifiersByNetId[network.chainId][i];
          console.group(
            `\n🔴  (${network.name}) Whitelisting identifier ${identifier} (UTF8: ${hexToUtf8(identifier)})`
          );

          // The proposal will only whitelist a new identifier if it isn't already whitelisted.
          if (
            !(await contractsByNetId[network.chainId].identifierWhitelist.methods
              .isIdentifierSupported(identifiersByNetId[network.chainId][i])
              .call())
          ) {
            const addSupportedIdentifierData = contractsByNetId[network.chainId].identifierWhitelist.methods
              .addSupportedIdentifier(identifier)
              .encodeABI();
            console.log("- addSupportedIdentifierData", addSupportedIdentifierData);
            adminProposalTransactions.push(
              await relayGovernanceHubMessage(
                contractsByNetId[network.chainId].identifierWhitelist.options.address,
                addSupportedIdentifierData,
                contractsByNetId[network.chainId].l1Governor,
                network.chainId
              )
            );
            if (network.chainId === 42161) {
              await fundArbitrumParentMessengerForOneTransaction(
                web3Providers[1],
                REQUIRED_SIGNER_ADDRESSES["deployer"],
                gasEstimator.getCurrentFastPrice()
              );
            }
          } else {
            console.log("- Identifier is already on whitelist. Nothing to do.");
          }
          console.groupEnd();
        }
      }
    }

    // Send the proposal
    await proposeAdminTransactions(
      web3Providers[1],
      adminProposalTransactions,
      REQUIRED_SIGNER_ADDRESSES["deployer"],
      gasEstimator.getCurrentFastPrice()
    );
  } else {
    console.group("\n🔎 Verifying execution of Admin Proposal");
    for (let i = 0; i < count; i++) {
      if (ethereum && identifiersByNetId[1][i]) {
        const identifier = identifiersByNetId[1][i];
        assert(
          await mainnetContracts.identifierWhitelist.methods.isIdentifierSupported(identifier).call(),
          "Identifier is not whitelisted"
        );
        console.log(`- Identifier ${identifier} (UTF8: ${hexToUtf8(identifier)}) is whitelisted on Ethereum`);
      }

      if (polygon && identifiersByNetId[137][i]) {
        const identifier = identifiersByNetId[137][i];
        if (!(await contractsByNetId[137].identifierWhitelist.methods.isIdentifierSupported(identifier).call())) {
          const addSupportedIdentifierData = contractsByNetId[137].identifierWhitelist.methods
            .addSupportedIdentifier(identifier)
            .encodeABI();
          await verifyGovernanceRootTunnelMessage(
            contractsByNetId[137].identifierWhitelist.options.address,
            addSupportedIdentifierData,
            contractsByNetId[137].l1Governor
          );
          console.log(
            `- polygon GovernorRootTunnel correctly emitted events to whitelist identifier ${identifier} (UTF8: ${hexToUtf8(
              identifier
            )})`
          );
        } else {
          console.log(
            `- Identifier ${identifier} (UTF8: ${hexToUtf8(identifier)}) is whitelisted on polygon. Nothing to check.`
          );
        }
      }
      for (const network of governorHubNetworks) {
        if (identifiersByNetId[network.chainId][i]) {
          const identifier = identifiersByNetId[network.chainId][i];
          if (
            !(await contractsByNetId[network.chainId].identifierWhitelist.methods
              .isIdentifierSupported(identifier)
              .call())
          ) {
            const addSupportedIdentifierData = contractsByNetId[network.chainId].identifierWhitelist.methods
              .addSupportedIdentifier(identifier)
              .encodeABI();
            await verifyGovernanceHubMessage(
              contractsByNetId[network.chainId].identifierWhitelist.options.address,
              addSupportedIdentifierData,
              contractsByNetId[network.chainId].l1Governor
            );
            console.log(
              `- ${
                network.name
              } GovernorHub on correctly emitted events to whitelist identifier ${identifier} (UTF8: ${hexToUtf8(
                identifier
              )})`
            );
          } else {
            console.log(
              `- Identifier ${identifier} (UTF8: ${hexToUtf8(identifier)}) is whitelisted on ${
                network.name
              }. Nothing to check.`
            );
          }
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
