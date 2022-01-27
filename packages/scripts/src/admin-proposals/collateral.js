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
  relayGovernanceHubMessage,
  verifyGovernanceHubMessage,
  relayGovernanceRootTunnelMessage,
  verifyGovernanceRootTunnelMessage,
  L2_ADMIN_NETWORK_NAMES,
  validateArgvNetworks,
  getNetworksToAdministrateFromArgv,
  proposeAdminTransactions,
} = require("./utils");
const { _getDecimals } = require("../utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("../utils/constants");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // comma-delimited list of final fees to set for whitelisted collateral, set for all networks.
    "fee",
    ...L2_ADMIN_NETWORK_NAMES,
  ],
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

async function run() {
  validateArgvNetworks(argv);
  const { verify, fee } = argv;
  const { ethereum, polygon, governorHubNetworks, chainIds } = getNetworksToAdministrateFromArgv(argv);
  validateNetworks(chainIds);

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
  for (let network of governorHubNetworks) {
    networksToAdministrate.push(network.chainId);
    collateralsByNetId[network.chainId] = network.value.split(",");
  }
  let web3Providers = { 1: getWeb3ByChainId(1) }; // netID => Web3

  // Construct all mainnet contract instances we'll need using the mainnet web3 provider.
  const mainnetContracts = await setupMainnet(web3Providers[1]);

  // Store contract instances for specified L2 networks
  let contractsByNetId = {}; // netId => contracts
  for (let chainId of chainIds) {
    const networkData = await setupNetwork(chainId);
    web3Providers[chainId] = networkData.web3;
    contractsByNetId[chainId] = networkData.contracts;
    console.group(`\nℹ️  Relayer infrastructure for network ${chainId}:`);
    console.log(`- AddressWhitelist @ ${contractsByNetId[chainId].addressWhitelist.options.address}`);
    console.log(`- Store @ ${contractsByNetId[chainId].store.options.address}`);
    console.log(
      `- ${chainId === 137 ? "GovernorRootTunnel" : "GovernorHub"} @ ${
        contractsByNetId[chainId].l1Governor.options.address
      }`
    );
    console.groupEnd();
  }

  for (let chainId of Object.keys(collateralsByNetId)) {
    if (collateralsByNetId[chainId] && collateralsByNetId[chainId].length !== fees.length) {
      throw new Error("all comma-delimited input strings should result in equal length arrays");
    }
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
      "- 🔴 = Transactions to be submitted to networks with GovernorSpokes are relayed via the GovernorHub on Ethereum. Look at this test for an example:"
    );
    console.log(
      "    - https://github.com/UMAprotocol/protocol/blob/0d3cf208eaf390198400f6d69193885f45c1e90c/packages/core/test/cross-chain-oracle/chain-adapters/Arbitrum_ParentMessenger.js#L253"
    );
    console.log("- 🟢 = Transactions to be submitted directly to Ethereum contracts.");
    console.groupEnd();
    for (let i = 0; i < fees.length; i++) {
      if (ethereum && collateralsByNetId[1][i]) {
        const collateral = collateralsByNetId[1][i];
        const collateralDecimals = await _getDecimals(web3Providers[1], collateral);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        console.group(`\n🟢 Updating final fee for collateral @ ${collateral} to: ${convertedFeeAmount}`);

        // The proposal will first add a final fee for the currency if the current final fee is different from the
        // proposed new one.
        const currentFinalFee = await mainnetContracts.store.methods.computeFinalFee(collateral).call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = mainnetContracts.store.methods
            .setFinalFee(collateral, { rawValue: convertedFeeAmount })
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
        if (!(await mainnetContracts.addressWhitelist.methods.isOnWhitelist(collateral).call())) {
          const addToWhitelistData = mainnetContracts.addressWhitelist.methods.addToWhitelist(collateral).encodeABI();
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

      if (polygon && collateralsByNetId[137][i]) {
        const collateral = collateralsByNetId[137][i];
        const collateralDecimals = await _getDecimals(web3Providers[137], collateral);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        console.group(`\n🟣 (Polygon) Updating Final Fee for collateral @ ${collateral} to: ${convertedFeeAmount}`);

        const currentFinalFee = await contractsByNetId[137].store.methods.computeFinalFee(collateral).call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = contractsByNetId[137].store.methods
            .setFinalFee(collateral, { rawValue: convertedFeeAmount })
            .encodeABI();
          console.log("- setFinalFeeData", setFinalFeeData);
          adminProposalTransactions.push(
            await relayGovernanceRootTunnelMessage(
              contractsByNetId[137].store.options.address,
              setFinalFeeData,
              contractsByNetId[137].l1Governor
            )
          );
        } else {
          console.log(`- Final fee for is already equal to ${convertedFeeAmount}. Nothing to do.`);
        }

        // The proposal will then add the currency to the whitelist if it isn't already there.
        if (!(await contractsByNetId[137].addressWhitelist.methods.isOnWhitelist(collateral).call())) {
          const addToWhitelistData = contractsByNetId[137].addressWhitelist.methods
            .addToWhitelist(collateral)
            .encodeABI();
          console.log("- addToWhitelistData", addToWhitelistData);
          adminProposalTransactions.push(
            await relayGovernanceRootTunnelMessage(
              contractsByNetId[137].addressWhitelist.options.address,
              addToWhitelistData,
              contractsByNetId[137].l1Governor
            )
          );
        } else {
          console.log("- Collateral is on the whitelist. Nothing to do.");
        }
        console.groupEnd();
      }

      for (const network of governorHubNetworks) {
        if (collateralsByNetId[network.chainId][i]) {
          const collateral = collateralsByNetId[network.chainId][i];
          const collateralDecimals = await _getDecimals(web3Providers[network.chainId], collateral);
          const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
          console.group(
            `\n🔴 (${network.name}) Updating Final Fee for collateral @ ${collateral} to: ${convertedFeeAmount}`
          );

          const currentFinalFee = await contractsByNetId[network.chainId].store.methods
            .computeFinalFee(collateral)
            .call();
          if (currentFinalFee.toString() !== convertedFeeAmount) {
            const setFinalFeeData = contractsByNetId[network.chainId].store.methods
              .setFinalFee(collateral, { rawValue: convertedFeeAmount })
              .encodeABI();
            console.log("- setFinalFeeData", setFinalFeeData);
            adminProposalTransactions.push(
              await relayGovernanceHubMessage(
                contractsByNetId[network.chainId].store.options.address,
                setFinalFeeData,
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
            console.log(`- Final fee for is already equal to ${convertedFeeAmount}. Nothing to do.`);
          }

          // The proposal will then add the currency to the whitelist if it isn't already there.
          if (!(await contractsByNetId[network.chainId].addressWhitelist.methods.isOnWhitelist(collateral).call())) {
            const addToWhitelistData = contractsByNetId[network.chainId].addressWhitelist.methods
              .addToWhitelist(collateral)
              .encodeABI();
            console.log("- addToWhitelistData", addToWhitelistData);
            adminProposalTransactions.push(
              await relayGovernanceHubMessage(
                contractsByNetId[network.chainId].addressWhitelist.options.address,
                addToWhitelistData,
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
            console.log("- Collateral is on the whitelist. Nothing to do.");
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
    for (let i = 0; i < fees.length; i++) {
      if (ethereum && collateralsByNetId[1][i]) {
        const collateral = collateralsByNetId[1][i];
        const collateralDecimals = await _getDecimals(web3Providers[1], collateral);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        const currentFinalFee = await mainnetContracts.store.methods.computeFinalFee(collateral).call();
        assert.equal(currentFinalFee.toString(), convertedFeeAmount, "Final fee was not set correctly");
        assert(
          await mainnetContracts.addressWhitelist.methods.isOnWhitelist(collateral).call(),
          "Collateral is not on AddressWhitelist"
        );
        console.log(`- Collateral @ ${collateral} has correct final fee and is whitelisted on Ethereum`);
      }
      if (polygon && collateralsByNetId[137][i]) {
        const collateral = collateralsByNetId[137][i];
        const collateralDecimals = await _getDecimals(web3Providers[137], collateral);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        const currentFinalFee = await contractsByNetId[137].store.methods.computeFinalFee(collateral).call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = contractsByNetId[137].store.methods
            .setFinalFee(collateral, { rawValue: convertedFeeAmount })
            .encodeABI();
          await verifyGovernanceRootTunnelMessage(
            contractsByNetId[137].store.options.address,
            setFinalFeeData,
            contractsByNetId[137].l1Governor
          );
          console.log(
            `- GovernorRootTunnel correctly emitted events to set final fee for collateral @ ${collateral} with final fee set to ${convertedFeeAmount}`
          );
        } else {
          console.log(`- Final fee for is already equal to ${convertedFeeAmount}. Nothing to check.`);
        }
        if (!(await contractsByNetId[137].addressWhitelist.methods.isOnWhitelist(collateral).call())) {
          const addToWhitelistData = contractsByNetId[137].addressWhitelist.methods
            .addToWhitelist(collateral)
            .encodeABI();
          await verifyGovernanceRootTunnelMessage(
            contractsByNetId[137].addressWhitelist.options.address,
            addToWhitelistData,
            contractsByNetId[137].l1Governor
          );
          console.log(`- GovernorRootTunnel correctly emitted events to whitelist collateral ${collateral}`);
        } else {
          console.log("- Polygon collateral is on the whitelist. Nothing to check.");
        }
      }
      for (const network of governorHubNetworks) {
        if (collateralsByNetId[network.chainId][i]) {
          const collateral = collateralsByNetId[network.chainId][i];
          const collateralDecimals = await _getDecimals(web3Providers[network.chainId], collateral);
          const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
          const currentFinalFee = await contractsByNetId[network.chainId].store.methods
            .computeFinalFee(collateral)
            .call();
          if (currentFinalFee.toString() !== convertedFeeAmount) {
            const setFinalFeeData = contractsByNetId[network.chainId].store.methods
              .setFinalFee(collateral, { rawValue: convertedFeeAmount })
              .encodeABI();
            await verifyGovernanceHubMessage(
              contractsByNetId[network.chainId].store.options.address,
              setFinalFeeData,
              contractsByNetId[network.chainId].l1Governor,
              network.chainId
            );
            console.log(
              `- GovernorHub for ${network.name} correctly emitted events to store ${
                contractsByNetId[network.chainId].store.options.address
              } containing setFinalFeeData data`
            );
          } else {
            console.log(`- Final fee for is already equal to ${convertedFeeAmount}. Nothing to check.`);
          }
          if (!(await contractsByNetId[network.chainId].addressWhitelist.methods.isOnWhitelist(collateral).call())) {
            const addToWhitelistData = contractsByNetId[network.chainId].addressWhitelist.methods
              .addToWhitelist(collateral)
              .encodeABI();
            await verifyGovernanceHubMessage(
              contractsByNetId[network.chainId].addressWhitelist.options.address,
              addToWhitelistData,
              contractsByNetId[network.chainId].l1Governor,
              network.chainId
            );
            console.log(
              `- GovernorHub for ${network.name} correctly emitted events to address whitelist ${
                contractsByNetId[network.chainId].addressWhitelist.options.address
              } containing addToWhitelistData data`
            );
          } else {
            console.log(`- Collateral ${collateral} is on the whitelist for ${network.name}. Nothing to check.`);
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
