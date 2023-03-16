// Description:
// - Changes Finder address for specified contract name.

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - Propose: node ./packages/scripts/src/admin-proposals/changeFinderAddress.js --contract Oracle --ethereum 0xabc --polygon 0xdef --network mainnet-fork
// - Verify: Add --verify flag to Propose command.

const assert = require("assert");
require("dotenv").config();
const Web3 = require("web3");
const { utf8ToHex, toChecksumAddress } = Web3.utils;
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
  string: [
    ...L2_ADMIN_NETWORK_NAMES,
    // e.g. IdentifierWhitelist, AddressWhitelist, Oracle, or any other appropriate Finder name.
    "contract",
  ],
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

async function run() {
  validateArgvNetworks(argv);
  const { verify, contract } = argv;
  const { ethereum, polygon, governorHubNetworks, chainIds } = getNetworksToAdministrateFromArgv(argv);
  // Parse comma-delimited CLI params into arrays
  validateNetworks(chainIds);
  let web3Providers = { 1: getWeb3ByChainId(1) }; // netID => Web3

  // Construct all mainnet contract instances we'll need using the mainnet web3 provider.
  const mainnetContracts = await setupMainnet(web3Providers[1]);

  // Store contract instances for specified L2 networks
  let contractsByNetId = {}; // chainId => contracts
  for (let chainId of chainIds) {
    const networkData = await setupNetwork(chainId);
    web3Providers[chainId] = networkData.web3;
    contractsByNetId[chainId] = networkData.contracts;
    console.group(`\nℹ️  Relayer infrastructure for network ${chainId}:`);
    console.log(`- Registry @ ${contractsByNetId[chainId].registry.options.address}`);
    console.log(
      `- ${chainId === 137 ? "GovernorRootTunnel" : "GovernorHub"} @ ${
        contractsByNetId[chainId].l1Governor.options.address
      }`
    );
    console.groupEnd();
  }

  const gasEstimator = await setupGasEstimator();

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
      "- 🔴 = Transactions to be submitted to networks with GovernorSpokes contracts are relayed via the GovernorHub on Ethereum. Look at this test for an example:"
    );
    console.log(
      "    - https://github.com/UMAprotocol/protocol/blob/0d3cf208eaf390198400f6d69193885f45c1e90c/packages/core/test/cross-chain-oracle/chain-adapters/Arbitrum_ParentMessenger.js#L253"
    );
    console.log("- 🟢 = Transactions to be submitted directly to Ethereum contracts.");
    console.groupEnd();

    if (ethereum) {
      console.group(`\n🟢 Pointing Finder for "${contract}" to ${ethereum}`);
      let skip = false;
      try {
        const implementationAddress = await mainnetContracts.finder.methods
          .getImplementationAddress(utf8ToHex(contract))
          .call();
        skip = implementationAddress === toChecksumAddress(ethereum);
      } catch (err) {
        // If `getImplementationAddress` reverts, then implementation is not set yet so we shouldn't skip this
        // proposal. Not having an implementation set is an expected situation for this script so we should ignore this
        // error.
      }
      if (!skip) {
        const data = mainnetContracts.finder.methods
          .changeImplementationAddress(utf8ToHex(contract), ethereum)
          .encodeABI();
        console.log("- data", data);
        adminProposalTransactions.push({ to: mainnetContracts.finder.options.address, value: 0, data });
      } else {
        console.log("- Contract @ ", ethereum, `is already set to ${contract} in the Finder. Nothing to do.`);
      }
      console.groupEnd();
    }

    if (polygon) {
      console.group(`\n🟣 (Polygon) Pointing Finder for "${contract}" to ${polygon}`);
      let skip = false;
      try {
        const implementationAddress = await contractsByNetId[137].finder.methods
          .getImplementationAddress(utf8ToHex(contract))
          .call();
        skip = implementationAddress === toChecksumAddress(polygon);
      } catch (err) {
        // If `getImplementationAddress` reverts, then implementation is not set yet so we shouldn't skip this
        // proposal. Not having an implementation set is an expected situation for this script so we should ignore this
        // error.
      }
      if (!skip) {
        const data = contractsByNetId[137].finder.methods
          .changeImplementationAddress(utf8ToHex(contract), polygon)
          .encodeABI();
        console.log("- data", data);
        adminProposalTransactions.push(
          await relayGovernanceRootTunnelMessage(
            contractsByNetId[137].finder.options.address,
            data,
            contractsByNetId[137].l1Governor
          )
        );
      } else {
        console.log("- Contract @ ", polygon, `is already set to ${contract} in the Finder. Nothing to do.`);
      }
      console.groupEnd();
    }

    if (governorHubNetworks.length > 0) {
      for (const network of governorHubNetworks) {
        console.group(`\n🔴 (${network.name}) Pointing Finder for "${contract}" to ${network.value}`);
        let skip = false;
        try {
          const implementationAddress = await contractsByNetId[network.chainId].finder.methods
            .getImplementationAddress(utf8ToHex(contract))
            .call();
          skip = implementationAddress === toChecksumAddress(network.value);
        } catch (err) {
          // If `getImplementationAddress` reverts, then implementation is not set yet so we shouldn't skip this
          // proposal. Not having an implementation set is an expected situation for this script so we should ignore this
          // error.
        }
        if (!skip) {
          const data = contractsByNetId[network.chainId].finder.methods
            .changeImplementationAddress(utf8ToHex(contract), network.value)
            .encodeABI();
          console.log("- data", data);
          adminProposalTransactions.push(
            await relayGovernanceHubMessage(
              contractsByNetId[network.chainId].finder.options.address,
              data,
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
          console.log("- Contract @ ", network.value, `is already set to ${contract} in the Finder. Nothing to do.`);
        }
        console.groupEnd();
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
    if (ethereum) {
      assert.equal(
        await mainnetContracts.finder.methods.getImplementationAddress(utf8ToHex(contract)).call(),
        toChecksumAddress(ethereum),
        "Contract not set in Finder"
      );
      console.log(`- Contract @ ${ethereum} is set to ${contract} in Finder`);
    }

    if (polygon) {
      if (
        (await contractsByNetId[137].finder.methods.getImplementationAddress(utf8ToHex(contract)).call()) !==
        toChecksumAddress(polygon)
      ) {
        const data = contractsByNetId[137].finder.methods
          .changeImplementationAddress(utf8ToHex(contract), polygon)
          .encodeABI();
        await verifyGovernanceRootTunnelMessage(
          contractsByNetId[137].finder.options.address,
          data,
          contractsByNetId[137].l1Governor
        );
        console.log(
          `- GovernorRootTunnel correctly emitted events to finder ${contractsByNetId[137].finder.options.address} containing changeImplementationAddress data`
        );
      } else {
        console.log("- Contract @ ", polygon, `is already set to ${contract} in Finder on Polygon. Nothing to check.`);
      }
    }

    if (governorHubNetworks.length > 0) {
      for (const network of governorHubNetworks) {
        if (
          (await contractsByNetId[network.chainId].finder.methods
            .getImplementationAddress(utf8ToHex(contract))
            .call()) !== toChecksumAddress(network.value)
        ) {
          const data = contractsByNetId[network.chainId].finder.methods
            .changeImplementationAddress(utf8ToHex(contract), network.value)
            .encodeABI();
          await verifyGovernanceHubMessage(
            contractsByNetId[network.chainId].finder.options.address,
            data,
            contractsByNetId[network.chainId].l1Governor,
            network.chainId
          );
          console.log(
            `- GovernorHub for ${network.name} correctly emitted events to finder ${
              contractsByNetId[network.chainId].finder.options.address
            } containing changeImplementationAddress data`
          );
        } else {
          console.log(
            "- Contract @ ",
            network.value,
            `is already set to ${contract} in Finder on ${network.name}. Nothing to check.`
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
