// Description:
// - Whitelist new collateral tokens.

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - Propose: node ./packages/scripts/src/admin-proposals/collateral.js --ethereum 0xabc,0x123 --fee 0.1,0.2 --polygon 0xdef,0x456 --network mainnet-fork
// - Verify: Add --verify flag to Propose command.

const assert = require("assert");
require("dotenv").config();
const { parseUnits } = require("@ethersproject/units");
const { getWeb3ByChainId } = require("@uma/common");
const {
  setupNetwork,
  validateNetworks,
  setupMainnet,
  fundArbitrumParentMessengerForOneTransaction,
  setupGasEstimator,
} = require("./utils");
const { _getDecimals } = require("../utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("../utils/constants");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // comma-delimited list of final fees to set for whitelisted collateral, set for all networks.
    "fee",
    // comma-delimited list of collateral addresses to whitelist.
    "ethereum",
    // comma-delimited list of Polygon collateral addresses to whitelist.
    "polygon",
    // comma-delimited list of Arbitrum collateral addresses to whitelist.
    "arbitrum",
  ],
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

async function run() {
  const { ethereum, fee, polygon, arbitrum, verify } = argv;
  if (!(polygon || ethereum || arbitrum)) throw new Error("Must specify either --ethereum, --polygon or --arbitrum");

  // Parse comma-delimited CLI params into arrays
  const networksToAdministrate = [];
  const collateralsByNetId = {};
  const fees = fee.split(",");
  if (ethereum) {
    collateralsByNetId[1] = ethereum.split(",");
  }
  if (polygon) {
    networksToAdministrate.push(137);
    collateralsByNetId[137] = polygon.split(",");
  }
  if (arbitrum) {
    networksToAdministrate.push(42161);
    collateralsByNetId[42161] = arbitrum.split(",");
  }
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
    console.log(`- AddressWhitelist @ ${contractsByNetId[netId].addressWhitelist.options.address}`);
    console.log(`- Store @ ${contractsByNetId[netId].store.options.address}`);
    console.log(
      `- ${netId === 137 ? "GovernorRootTunnel" : "GovernorHub"} @ ${
        contractsByNetId[netId].l1Governor.options.address
      }`
    );
    console.groupEnd();
  }

  if (
    (collateralsByNetId[1] && collateralsByNetId[1].length !== fees.length) ||
    (collateralsByNetId[137] && collateralsByNetId[137].length !== fees.length) ||
    (collateralsByNetId[42161] && collateralsByNetId[42161].length !== fees.length)
  ) {
    throw new Error("all comma-delimited input strings should result in equal length arrays");
  }

  const gasEstimator = await setupGasEstimator();

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
    for (let i = 0; i < fees.length; i++) {
      if (collateralsByNetId[1] && collateralsByNetId[1][i]) {
        const collateralDecimals = await _getDecimals(web3Providers[1], collateralsByNetId[1][i]);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        console.group(`\n🟢 Updating final fee for collateral @ ${collateralsByNetId[1][i]} to: ${convertedFeeAmount}`);

        // The proposal will first add a final fee for the currency if the current final fee is different from the
        // proposed new one.
        const currentFinalFee = await mainnetContracts.store.methods.computeFinalFee(collateralsByNetId[1][i]).call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = mainnetContracts.store.methods
            .setFinalFee(collateralsByNetId[1][i], { rawValue: convertedFeeAmount })
            .encodeABI();
          console.log("- setFinalFeeData", setFinalFeeData);
          adminProposalTransactions.push({
            to: mainnetContracts.store.options.address,
            value: 0,
            data: setFinalFeeData,
          });
        } else {
          console.log(`- Final fee for is already equal to ${convertedFeeAmount}. Nothing to do.`);
        }

        // The proposal will then add the currency to the whitelist if it isn't already there.
        if (!(await mainnetContracts.addressWhitelist.methods.isOnWhitelist(collateralsByNetId[1][i]).call())) {
          const addToWhitelistData = mainnetContracts.addressWhitelist.methods
            .addToWhitelist(collateralsByNetId[1][i])
            .encodeABI();
          console.log("- addToWhitelistData", addToWhitelistData);
          adminProposalTransactions.push({
            to: mainnetContracts.addressWhitelist.options.address,
            value: 0,
            data: addToWhitelistData,
          });
        } else {
          console.log("- Collateral is on the whitelist. Nothing to do.");
        }
        console.groupEnd();
      }

      if (collateralsByNetId[137] && collateralsByNetId[137][i]) {
        const collateralDecimals = await _getDecimals(web3Providers[137], collateralsByNetId[137][i]);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        console.group(
          `\n🟣 (Polygon) Updating Final Fee for collateral @ ${collateralsByNetId[137][i]} to: ${convertedFeeAmount}`
        );

        const currentFinalFee = await contractsByNetId[137].store.methods
          .computeFinalFee(collateralsByNetId[137][i])
          .call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = contractsByNetId[137].store.methods
            .setFinalFee(collateralsByNetId[137][i], { rawValue: convertedFeeAmount })
            .encodeABI();
          console.log("- setFinalFeeData", setFinalFeeData);
          const relayGovernanceData = contractsByNetId[137].l1Governor.methods
            .relayGovernance(contractsByNetId[137].store.options.address, setFinalFeeData)
            .encodeABI();
          console.log("- relayGovernanceData", relayGovernanceData);
          adminProposalTransactions.push({
            to: contractsByNetId[137].l1Governor.options.address,
            value: 0,
            data: relayGovernanceData,
          });
        } else {
          console.log(`- Final fee for is already equal to ${convertedFeeAmount}. Nothing to do.`);
        }

        // The proposal will then add the currency to the whitelist if it isn't already there.
        if (!(await contractsByNetId[137].addressWhitelist.methods.isOnWhitelist(collateralsByNetId[137][i]).call())) {
          const addToWhitelistData = contractsByNetId[137].addressWhitelist.methods
            .addToWhitelist(collateralsByNetId[137][i])
            .encodeABI();
          console.log("- addToWhitelistData", addToWhitelistData);
          const relayGovernanceData = contractsByNetId[137].l1Governor.methods
            .relayGovernance(contractsByNetId[137].addressWhitelist.options.address, addToWhitelistData)
            .encodeABI();
          console.log("- relayGovernanceData", relayGovernanceData);
          adminProposalTransactions.push({
            to: contractsByNetId[137].l1Governor.options.address,
            value: 0,
            data: relayGovernanceData,
          });
        } else {
          console.log("- Collateral is on the whitelist. Nothing to do.");
        }
        console.groupEnd();
      }

      if (collateralsByNetId[42161] && collateralsByNetId[42161][i]) {
        const collateralDecimals = await _getDecimals(web3Providers[42161], collateralsByNetId[42161][i]);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        console.group(
          `\n🔴 (Arbitrum) Updating Final Fee for collateral @ ${collateralsByNetId[42161][i]} to: ${convertedFeeAmount}`
        );

        const currentFinalFee = await contractsByNetId[42161].store.methods.computeFinalFee(polygon[i]).call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = contractsByNetId[42161].store.methods
            .setFinalFee(collateralsByNetId[42161][i], { rawValue: convertedFeeAmount })
            .encodeABI();
          console.log("- setFinalFeeData", setFinalFeeData);
          const calls = [{ to: contractsByNetId[42161].store.options.address, data: setFinalFeeData }];
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
          console.log(`- Final fee for is already equal to ${convertedFeeAmount}. Nothing to do.`);
        }

        // The proposal will then add the currency to the whitelist if it isn't already there.
        if (
          !(await contractsByNetId[42161].addressWhitelist.methods.isOnWhitelist(collateralsByNetId[42161][i]).call())
        ) {
          const addToWhitelistData = contractsByNetId[42161].addressWhitelist.methods
            .addToWhitelist(collateralsByNetId[42161][i])
            .encodeABI();
          console.log("- addToWhitelistData", addToWhitelistData);
          const calls = [{ to: contractsByNetId[42161].store.options.address, data: addToWhitelistData }];
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
          console.log("- Collateral is on the whitelist. Nothing to do.");
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
    for (let i = 0; i < fees.length; i++) {
      if (collateralsByNetId[1] && collateralsByNetId[1][i]) {
        const collateralDecimals = await _getDecimals(web3Providers[1], collateralsByNetId[1][i]);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        const currentFinalFee = await mainnetContracts.store.methods.computeFinalFee(collateralsByNetId[1][i]).call();
        assert.equal(currentFinalFee.toString(), convertedFeeAmount, "Final fee was not set correctly");
        assert(
          await mainnetContracts.addressWhitelist.methods.isOnWhitelist(collateralsByNetId[1][i]).call(),
          "Collateral is not on AddressWhitelist"
        );
        console.log(`- Collateral @ ${collateralsByNetId[1][i]} has correct final fee and is whitelisted on Ethereum`);
      }
      if (collateralsByNetId[137] && collateralsByNetId[137][i]) {
        const collateralDecimals = await _getDecimals(web3Providers[137], collateralsByNetId[137][i]);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        const currentFinalFee = await contractsByNetId[137].store.methods
          .computeFinalFee(collateralsByNetId[137][i])
          .call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = contractsByNetId[137].store.methods
            .setFinalFee(collateralsByNetId[137][i], { rawValue: convertedFeeAmount })
            .encodeABI();
          const relayedStoreTransactions = await contractsByNetId[137].l1Governor.getPastEvents(
            "RelayedGovernanceRequest",
            { filter: { to: contractsByNetId[137].store.options.address }, fromBlock: 0 }
          );
          assert(
            relayedStoreTransactions.find((e) => e.returnValues.data === setFinalFeeData),
            "Could not find RelayedGovernanceRequest matching expected relayed setFinalFee transaction"
          );
          console.log(
            `- GovernorRootTunnel correctly emitted events to set final fee for collateral @ ${collateralsByNetId[137][i]} with final fee set to ${convertedFeeAmount}`
          );
        } else {
          console.log(`- Final fee for is already equal to ${convertedFeeAmount}. Nothing to check.`);
        }
        if (!(await contractsByNetId[137].addressWhitelist.methods.isOnWhitelist(collateralsByNetId[137][i]).call())) {
          const addToWhitelistData = contractsByNetId[137].addressWhitelist.methods
            .addToWhitelist(collateralsByNetId[137][i])
            .encodeABI();
          const relayedWhitelistTransactions = await contractsByNetId[137].l1Governor.getPastEvents(
            "RelayedGovernanceRequest",
            { filter: { to: contractsByNetId[137].addressWhitelist.options.address }, fromBlock: 0 }
          );
          assert(
            relayedWhitelistTransactions.find((e) => e.returnValues.data === addToWhitelistData),
            "Could not find RelayedGovernanceRequest matching expected relayed addToWhitelist transaction"
          );
          console.log(`- GovernorRootTunnel correctly emitted events to whitelist collateral ${polygon[i]}`);
        } else {
          console.log("- Polygon collateral is on the whitelist. Nothing to check.");
        }
      }
      if (collateralsByNetId[42161] && collateralsByNetId[42161][i]) {
        const collateralDecimals = await _getDecimals(web3Providers[42161], collateralsByNetId[42161][i]);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        const currentFinalFee = await contractsByNetId[42161].store.methods.computeFinalFee(polygon[i]).call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = contractsByNetId[42161].store.methods
            .setFinalFee(collateralsByNetId[42161][i], { rawValue: convertedFeeAmount })
            .encodeABI();
          const calls = [{ to: contractsByNetId[42161].store.options.address, data: setFinalFeeData }];
          const relayedStoreTransactions = await contractsByNetId[42161].l1Governor.getPastEvents(
            "RelayedGovernanceRequest",
            {
              filter: { chainId: "42161", messenger: mainnetContracts.arbitrumParentMessenger.options.address },
              fromBlock: 0,
            }
          );

          assert(
            relayedStoreTransactions.find((e) => e.returnValues.calls === calls),
            "Could not find RelayedGovernanceRequest matching expected relayed setFinalFee transaction"
          );
          console.log(
            `- GovernorRootTunnel correctly emitted events to set final fee for collateral @ ${collateralsByNetId[42161][i]} with final fee set to ${convertedFeeAmount}`
          );
        } else {
          console.log(`- Final fee for is already equal to ${convertedFeeAmount}. Nothing to check.`);
        }
        if (
          !(await contractsByNetId[42161].addressWhitelist.methods.isOnWhitelist(collateralsByNetId[42161][i]).call())
        ) {
          const addToWhitelistData = contractsByNetId[42161].addressWhitelist.methods
            .addToWhitelist(collateralsByNetId[42161][i])
            .encodeABI();
          const calls = [{ to: contractsByNetId[42161].store.options.address, data: addToWhitelistData }];
          const relayedWhitelistTransactions = await contractsByNetId[42161].l1Governor.getPastEvents(
            "RelayedGovernanceRequest",
            {
              filter: { chainId: "42161", messenger: mainnetContracts.arbitrumParentMessenger.options.address },
              fromBlock: 0,
            }
          );

          assert(
            relayedWhitelistTransactions.find((e) => e.returnValues.calls === calls),
            "Could not find RelayedGovernanceRequest matching expected relayed addToWhitelist transaction"
          );
          console.log(`- GovernorRootTunnel correctly emitted events to whitelist collateral ${arbitrum[i]}`);
        } else {
          console.log("- Arbitrum collateral is on the whitelist. Nothing to check.");
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
