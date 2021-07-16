const { task, types } = require("hardhat/config");
require("dotenv").config();
const assert = require("assert");
const { GasEstimator } = require("@uma/financial-templates-lib");
const Web3 = require("web3");
const winston = require("winston");
const { parseUnits } = require("@ethersproject/units");
const { interfaceName } = require("@uma/common");

// Run:
// - set CUSTOM_NODE_URL in environment to an Ethereum mainnet node with archival data. This script connects to a fork
// of the node pointed to by CUSTOM_NODE_URL and the `hardhat fork` task requires archival data. More details here:
// https://hardhat.org/guides/mainnet-forking.html
// - (optional) set CROSS_CHAIN_NODE_URL to a Polygon mainnet node with archival data. This will be used to query
// contract data from Polygon when relaying proposals through the GovernorRootTunnel.
// - Propose: yarn hardhat collateral-umip --network custom-node-fork --collateral 0xabc --fee 0.1 --polygon 0xdef --collateral 0x123 --fee 400 --polygon 0x456
// - Vote Simulate: yarn hardhat vote-simulate --network custom-node-fork
// - Verify: yarn hardhat collateral-umip --network custom-node-fork --verify --collateral 0xabc --fee 0.1 --polygon 0xdef --collateral 0x123 --fee 400 --polygon 0x456

// 1. Params: --collateral, --fee, --polygon, --verify
// 2. Params are comma-delimited, must all be the same length
// 3. If --verify flag is passed, script is assumed to be running after a Vote Simulation and updated contract state is
// verified.

task("collateral-umip", "Propose or verify Admin Proposal whitelisting new collateral types to Ethereum and/or Polygon")
  .addOptionalParam(
    "collateral",
    "comma-delimited list of collateral addresses to whitelist. Required if --ethereumOnly flag is True",
    undefined,
    types.string
  )
  .addParam("fee", "comma-delimited list of final fees to set for whitelisted collateral", undefined, types.string)
  .addOptionalParam("verify", "False if verifying, True for proposing. Default False.", false, types.boolean)
  .addOptionalParam(
    "relayPolygon",
    "True if relaying to the Polygon whitelist, False for only whitelisting on Ethereum. Default False.",
    false,
    types.boolean
  )
  .addOptionalParam(
    "polygon",
    "comma-delimited list of Polygon collateral addresses to whitelist",
    undefined,
    types.string
  )
  .setAction(async function (taskArguments, hre) {
    const { collateral, fee, polygon, verify, relayPolygon } = taskArguments;
    const { web3, getContract } = hre;

    const REQUIRED_SIGNER_ADDRESSES = [
      "0x2bAaA41d155ad8a4126184950B31F50A1513cE25", // UMA Deployer
    ];
    // Set up provider so that we can sign from special wallets:
    REQUIRED_SIGNER_ADDRESSES.map(async (address) => {
      await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
    });

    const ERC20 = getContract("ERC20");
    const AddressWhitelist = getContract("AddressWhitelist");
    const Store = getContract("Store");
    const GovernorRootTunnel = getContract("GovernorRootTunnel");
    const Governor = getContract("Governor");
    const Finder = getContract("Finder");
    const Voting = getContract("Voting");

    let collaterals;
    let fees = fee.split(",");
    let polygonCollaterals;
    let crossChainWeb3;

    if (relayPolygon) {
      collaterals = collateral.split(",");
    } else {
      if (collateral) collaterals = collateral.split(",");
      polygonCollaterals = polygon.split(",");
      if (!process.env.CROSS_CHAIN_NODE_URL)
        throw new Error("If --relayPolygon is True, you must set a CROSS_CHAIN_NODE_URL environment variable");
      crossChainWeb3 = new Web3(process.env.CROSS_CHAIN_NODE_URL);
    }

    assert.ok(
      collaterals &&
        collaterals.length === fees.length &&
        polygonCollaterals &&
        polygonCollaterals.length === collaterals.length,
      "all comma-delimited input strings should result in equal length arrays"
    );

    // Eth contracts
    const netId = await web3.eth.net.getId();
    console.log("Connected to network id", netId);
    const whitelist = new web3.eth.Contract(AddressWhitelist.abi, _getContractAddressByName("AddressWhitelist", netId));
    const store = new web3.eth.Contract(Store.abi, _getContractAddressByName("Store", netId));
    const gasEstimator = new GasEstimator(
      winston.createLogger({ silent: true }),
      60, // Time between updates.
      netId
    );
    const governorRootTunnel = new web3.eth.Contract(
      GovernorRootTunnel.abi,
      _getContractAddressByName("GovernorRootTunnel", netId)
    );
    const governor = new web3.eth.Contract(Governor.abi, _getContractAddressByName("Governor", netId));
    const finder = new web3.eth.Contract(Finder.abi, _getContractAddressByName("Finder", netId));
    const oracle = new web3.eth.Contract(Voting.abi, _getContractAddressByName("Voting", netId));

    // Polygon contracts
    const polygon_netId = await crossChainWeb3.eth.net.getId();
    const polygon_whitelist = new crossChainWeb3.eth.Contract(
      AddressWhitelist.abi,
      _getContractAddressByName("AddressWhitelist", polygon_netId)
    );
    const polygon_store = new web3.eth.Contract(Store.abi, _getContractAddressByName("Store", polygon_netId));

    if (verify) {
      console.group("Proposing new Admin Proposal");

      const adminProposalTransactions = [];
      for (let i = 0; i < fees.length; i++) {
        if (collaterals) {
          const collateralDecimals = await _getDecimals(web3, collaterals[i], ERC20);
          const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
          console.log(`- Updating Final Fee for collateral @ ${collaterals[i]} to: ${convertedFeeAmount}`);

          // The proposal will first add a final fee for the currency if the current final fee is different from the
          // proposed new one.
          const currentFinalFee = await store.methods.computeFinalFee(collaterals[i]).call();
          if (currentFinalFee.toString() !== convertedFeeAmount) {
            const addFinalFeeToStoreTx = store.contract.methods
              .setFinalFee(collaterals[i], { rawValue: convertedFeeAmount })
              .encodeABI();
            console.log("- addFinalFeeToStoreTx", addFinalFeeToStoreTx);
            adminProposalTransactions.push({ to: store.options.address, value: 0, data: addFinalFeeToStoreTx });
          } else {
            console.log(
              "- Final fee for ",
              collaterals[i],
              `is already equal to ${convertedFeeAmount}. Nothing to do.`
            );
          }

          // The proposal will then add the currency to the whitelist if it isn't already there.
          if (!(await whitelist.methods.isOnWhitelist(collaterals[i]).call())) {
            console.log("- Collateral", collaterals[i], "is not on the whitelist. Adding it.");
            const addCollateralToWhitelistTx = whitelist.contract.methods.addToWhitelist(collaterals[i]).encodeABI();
            console.log("- addCollateralToWhitelistTx", addCollateralToWhitelistTx);
            adminProposalTransactions.push({
              to: whitelist.options.address,
              value: 0,
              data: addCollateralToWhitelistTx,
            });
          } else {
            console.log("- Collateral", collateral, "is on the whitelist. Nothing to do.");
          }
        }

        if (polygonCollaterals) {
          console.group("- Relaying equivalent Polygon transactions:");
          console.log(`- Polygon Store @ ${polygon_store.options.address}`);
          console.log(`- Polygon AddressWhitelist @ ${polygon_whitelist.options.address}`);
          console.log(`- GovernorRootTunnel @ ${governorRootTunnel.options.address}`);
          console.groupEnd();

          const collateralDecimals = await _getDecimals(crossChainWeb3, polygonCollaterals[i], ERC20);
          const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
          console.log(
            `- (Polygon) Updating Final Fee for collateral @ ${polygonCollaterals[i]} to: ${convertedFeeAmount}`
          );

          const currentFinalFee = await polygon_store.methods.computeFinalFee(polygonCollaterals[i]).call();
          if (currentFinalFee.toString() !== convertedFeeAmount) {
            const polygonFinalFeeData = polygon_store.contract.methods
              .setFinalFee(polygonCollaterals[i], { rawValue: convertedFeeAmount })
              .encodeABI();
            console.log("- (Polygon) finalFeeData", polygonFinalFeeData);
            const relayFinalFeeTx = governorRootTunnel.contract.methods
              .relayGovernance(polygon_store.options.address, polygonFinalFeeData)
              .encodeABI();
            console.log("- relayFinalFeeTx", relayFinalFeeTx);
            adminProposalTransactions.push({ to: governorRootTunnel.options.address, value: 0, data: relayFinalFeeTx });
          } else {
            console.log(
              "- Final fee for ",
              collaterals[i],
              `is already equal to ${convertedFeeAmount}. Nothing to do.`
            );
          }

          // The proposal will then add the currency to the whitelist if it isn't already there.
          if (!(await polygon_whitelist.methods.isOnWhitelist(polygonCollaterals[i]).call())) {
            const polygonCollateralWhitelistData = polygon_whitelist.contract.methods
              .addToWhitelist(polygonCollaterals[i])
              .encodeABI();
            console.log("- (Polygon) collateralWhitelistData", polygonCollateralWhitelistData);
            const relayCollateralWhitelistTx = governorRootTunnel.contract.methods
              .relayGovernance(polygon_whitelist.options.address, polygonCollateralWhitelistData)
              .encodeABI();
            console.log("- relayCollateralWhitelistTx", relayCollateralWhitelistTx);
            adminProposalTransactions.push({
              to: governorRootTunnel.options.address,
              value: 0,
              data: relayCollateralWhitelistTx,
            });
          } else {
            console.log("- Collateral", collateral, "is on the whitelist. Nothing to do.");
          }
        }
      }

      // Send the proposal
      console.log(`- Sending to governor @ ${governor.options.address}`);
      await gasEstimator.update();
      console.log(`- Admin proposal contains ${adminProposalTransactions.length} transactions`);
      const txn = await governor.propose(adminProposalTransactions, {
        from: REQUIRED_SIGNER_ADDRESSES[0],
        gasPrice: gasEstimator.getCurrentFastPrice(),
      });
      console.log("- Transaction: ", txn?.tx);
      const oracleAddress = await finder.methods
        .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
        .call();
      console.log(`- Governor submitting admin request to Voting @ ${oracleAddress}`);

      // Print out details about new Admin proposal
      const priceRequests = await oracle.getPastEvents("PriceRequestAdded");
      const newAdminRequest = priceRequests[priceRequests.length - 1];
      console.log(
        `- New admin request {identifier: ${
          newAdminRequest.args.identifier
        }, timestamp: ${newAdminRequest.args.time.toString()}}`
      );
    } else {
      console.group("Verifying execution of Admin Proposal");
    }
    console.groupEnd();
  });

// This function resolves the decimals for a collateral token. A decimals override is optionally passed in to override
// the contract's decimal value.
async function _getDecimals(web3, collateralAddress, ERC20) {
  const collateral = new web3.eth.Contract(ERC20.abi, collateralAddress);
  try {
    return (await collateral.methods.decimals().call()).toString();
  } catch (error) {
    throw new Error("Failed to query .decimals() for ERC20" + error.message);
  }
}

const CONTRACT_ADDRESSES = {};
function _getContractAddressByName(contractName, networkId) {
  if (!CONTRACT_ADDRESSES[networkId]) CONTRACT_ADDRESSES[networkId] = require(`../../networks/${networkId}.json`);
  return CONTRACT_ADDRESSES[networkId].find((x) => x.contractName === contractName).address;
}
