// Description:
// - Propose or verify Admin Proposal whitelisting new collateral types to Ethereum and/or Polygon.

// Run:
// - For testing, start mainnet fork in one window with `yarn hardhat node --fork <ARCHIVAL_NODE_URL> --no-deploy --port 9545`
// - (optional, or required if --polygon is not undefined) set POLYGON_NODE_URL to a Polygon mainnet node. This will
//   be used to query contract data from Polygon when relaying proposals through the GovernorRootTunnel.
// - Next, open another terminal window and run `node ./packages/core/scripts/admin-proposals/setup.sh` to unlock
//   accounts on the local node that we'll need to run this script.
// - Propose: node ./packages/core/scripts/admin-proposals/collateral.js --collateral 0xabc,0x123 --fee 0.1,0.2 --polygon 0xdef,0x456 --network mainnet-fork
// - Vote Simulate: node ./packages/core/scripts/admin-proposals/simulateVote.js --network mainnet-fork
// - Verify: node ./packages/core/scripts/admin-proposals/collateral.js --verify --collateral 0xabc,0x123 --fee 0.1,0.2 --polygon 0xdef,0x456 --network mainnet-fork
// - For production, set the CUSTOM_NODE_URL environment, run the script with a production network passed to the
//   `--network` flag (along with other params like --keys) like so: `node ... --network mainnet_gckms --keys deployer`

// Customizations:
// - --polygon param can be omitted, in which case transactions will only take place on Ethereum.
// - --collateral flag can also be omitted, in which case transactions will only be relayed to Polygon
// - --fee, ---collateral, --polygon param all must be comma delimited strings resulting in equal length arrays
// - Specific collateral or polygon addresses can be skipped to conform with the above constraint like so: --collateral ,, --polygonCollateral 0xab,,
// - If --verify flag is set, script is assumed to be running after a Vote Simulation and updated contract state is
// verified.

// Examples:
// - Whitelist collateral on Ethereum only:
//    - `node ./packages/core/scripts/admin-proposals/collateral.js --collateral 0xabc,0x123 --network mainnet-fork`
// - Whitelist collateral on Polygon only:
//    - `node ./packages/core/scripts/admin-proposals/collateral.js --polygon 0xabc,0x123 --network mainnet-fork`
// - Whitelist collateral on both (some on Ethereum, some on Polygon):
//    - `node ./packages/core/scripts/admin-proposals/collateral.js --collateral 0xabc,0x123 --polygon 0xdef, --network mainnet-fork`

const hre = require("hardhat");
const { getContract } = hre;
require("dotenv").config();
const assert = require("assert");
const { GasEstimator } = require("@uma/financial-templates-lib");
const Web3 = require("web3");
const winston = require("winston");
const { parseUnits } = require("@ethersproject/units");
const { interfaceName } = require("@uma/common");
const { _getDecimals, _getContractAddressByName, _setupWeb3 } = require("./utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("./constants");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // comma-delimited list of final fees to set for whitelisted collateral.
    "fees",
    // comma-delimited list of collateral addresses to whitelist. Required if --polygon is omitted.
    "collateral",
    // comma-delimited list of Polygon collateral addresses to whitelist. Required if --collateral is omitted
    "polygon",
  ],
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

async function run() {
  const { collateral, fee, polygon, verify } = argv;
  const { web3, netId } = await _setupWeb3();

  // Contract ABI's
  const ERC20 = getContract("ERC20");
  const AddressWhitelist = getContract("AddressWhitelist");
  const Store = getContract("Store");
  const GovernorRootTunnel = getContract("GovernorRootTunnel");
  const Governor = getContract("Governor");
  const Finder = getContract("Finder");
  const Voting = getContract("Voting");

  // Parse comma-delimited CLI params into arrays
  let collaterals;
  let fees = fee.split(",");
  let polygonCollaterals;
  let crossChainWeb3;

  // If polygon collateral is specified, initialize Governance relay infrastructure contracts
  let polygon_netId;
  let polygon_whitelist;
  let polygon_store;
  if (polygon) {
    if (collateral) collaterals = collateral.split(",");
    polygonCollaterals = polygon.split(",");
    if (!process.env.POLYGON_NODE_URL)
      throw new Error("If --polygon is defined, you must set a POLYGON_NODE_URL environment variable");
    crossChainWeb3 = new Web3(process.env.POLYGON_NODE_URL);
    polygon_netId = await crossChainWeb3.eth.net.getId();
    polygon_whitelist = new crossChainWeb3.eth.Contract(
      AddressWhitelist.abi,
      _getContractAddressByName("AddressWhitelist", polygon_netId)
    );
    polygon_store = new crossChainWeb3.eth.Contract(Store.abi, _getContractAddressByName("Store", polygon_netId));
  } else if (collateral) {
    collaterals = collateral.split(",");
  } else {
    throw new Error("Must specify either --polygon or --collateral or both");
  }

  if (
    (collaterals && collaterals.length !== fees.length) ||
    (polygonCollaterals && polygonCollaterals.length !== fees.length)
  ) {
    throw new Error("all comma-delimited input strings should result in equal length arrays");
  }

  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  const whitelist = new web3.eth.Contract(AddressWhitelist.abi, _getContractAddressByName("AddressWhitelist", netId));
  const store = new web3.eth.Contract(Store.abi, _getContractAddressByName("Store", netId));
  const gasEstimator = new GasEstimator(
    winston.createLogger({ silent: true }),
    60, // Time between updates.
    netId
  );
  await gasEstimator.update();
  console.log(
    `⛽️ Current fast gas price for Ethereum: ${web3.utils.fromWei(
      gasEstimator.getCurrentFastPrice().toString(),
      "gwei"
    )} gwei`
  );
  const governor = new web3.eth.Contract(Governor.abi, _getContractAddressByName("Governor", netId));
  const finder = new web3.eth.Contract(Finder.abi, _getContractAddressByName("Finder", netId));
  const oracleAddress = await finder.methods
    .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    .call();
  const oracle = new web3.eth.Contract(Voting.abi, oracleAddress);
  const governorRootTunnel = new web3.eth.Contract(
    GovernorRootTunnel.abi,
    _getContractAddressByName("GovernorRootTunnel", netId)
  );
  if (polygonCollaterals) {
    console.group("\nℹ️  Relayer infrastructure for Polygon transactions:");
    console.log(`- Store @ ${polygon_store.options.address}`);
    console.log(`- AddressWhitelist @ ${polygon_whitelist.options.address}`);
    console.log(`- GovernorRootTunnel @ ${governorRootTunnel.options.address}`);
    console.groupEnd();
  }
  console.group("\nℹ️  DVM infrastructure for Ethereum transactions:");
  console.log(`- Store @ ${store.options.address}`);
  console.log(`- AddressWhitelist @ ${whitelist.options.address}`);
  console.log(`- Finder @ ${finder.options.address}`);
  console.log(`- Oracle @ ${oracle.options.address}`);
  console.log(`- Governor @ ${governor.options.address}`);
  console.groupEnd();

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
    console.log("- 🟢 = Transactions to be submitted directly to Ethereum contracts.");
    console.groupEnd();
    for (let i = 0; i < fees.length; i++) {
      if (collaterals && collaterals[i]) {
        const collateralDecimals = await _getDecimals(web3, collaterals[i], ERC20);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        console.group(`\n🟢 Updating final fee for collateral @ ${collaterals[i]} to: ${convertedFeeAmount}`);

        // The proposal will first add a final fee for the currency if the current final fee is different from the
        // proposed new one.
        const currentFinalFee = await store.methods.computeFinalFee(collaterals[i]).call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = store.methods
            .setFinalFee(collaterals[i], { rawValue: convertedFeeAmount })
            .encodeABI();
          console.log("- setFinalFeeData", setFinalFeeData);
          adminProposalTransactions.push({ to: store.options.address, value: 0, data: setFinalFeeData });
        } else {
          console.log("- Final fee for ", collaterals[i], `is already equal to ${convertedFeeAmount}. Nothing to do.`);
        }

        // The proposal will then add the currency to the whitelist if it isn't already there.
        if (!(await whitelist.methods.isOnWhitelist(collaterals[i]).call())) {
          const addToWhitelistData = whitelist.methods.addToWhitelist(collaterals[i]).encodeABI();
          console.log("- addToWhitelistData", addToWhitelistData);
          adminProposalTransactions.push({ to: whitelist.options.address, value: 0, data: addToWhitelistData });
        } else {
          console.log("- Collateral", collateral, "is on the whitelist. Nothing to do.");
        }
        console.groupEnd();
      }

      if (polygonCollaterals && polygonCollaterals[i]) {
        const collateralDecimals = await _getDecimals(crossChainWeb3, polygonCollaterals[i], ERC20);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        console.group(
          `\n🟣 (Polygon) Updating Final Fee for collateral @ ${polygonCollaterals[i]} to: ${convertedFeeAmount}`
        );

        const currentFinalFee = await polygon_store.methods.computeFinalFee(polygonCollaterals[i]).call();
        if (currentFinalFee.toString() !== convertedFeeAmount) {
          const setFinalFeeData = polygon_store.methods
            .setFinalFee(polygonCollaterals[i], { rawValue: convertedFeeAmount })
            .encodeABI();
          console.log("- setFinalFeeData", setFinalFeeData);
          const relayGovernanceData = governorRootTunnel.methods
            .relayGovernance(polygon_store.options.address, setFinalFeeData)
            .encodeABI();
          console.log("- relayGovernanceData", relayGovernanceData);
          adminProposalTransactions.push({
            to: governorRootTunnel.options.address,
            value: 0,
            data: relayGovernanceData,
          });
        } else {
          console.log("- Final fee for ", collaterals[i], `is already equal to ${convertedFeeAmount}. Nothing to do.`);
        }

        // The proposal will then add the currency to the whitelist if it isn't already there.
        if (!(await polygon_whitelist.methods.isOnWhitelist(polygonCollaterals[i]).call())) {
          const addToWhitelistData = polygon_whitelist.methods.addToWhitelist(polygonCollaterals[i]).encodeABI();
          console.log("- addToWhitelistData", addToWhitelistData);
          const relayGovernanceData = governorRootTunnel.methods
            .relayGovernance(polygon_whitelist.options.address, addToWhitelistData)
            .encodeABI();
          console.log("- relayGovernanceData", relayGovernanceData);
          adminProposalTransactions.push({
            to: governorRootTunnel.options.address,
            value: 0,
            data: relayGovernanceData,
          });
        } else {
          console.log("- Collateral", collateral, "is on the whitelist. Nothing to do.");
        }
        console.groupEnd();
      }
    }

    // Send the proposal
    console.group(`\n📨 Sending to governor @ ${governor.options.address}`);
    console.log(`- Admin proposal contains ${adminProposalTransactions.length} transactions`);
    if (adminProposalTransactions.length > 0) {
      const txn = await governor.methods
        .propose(adminProposalTransactions)
        .send({ from: REQUIRED_SIGNER_ADDRESSES["deployer"], gasPrice: gasEstimator.getCurrentFastPrice() });
      console.log("- Transaction: ", txn?.transactionHash);

      // Print out details about new Admin proposal
      const priceRequests = await oracle.getPastEvents("PriceRequestAdded");
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
      if (collaterals && collaterals[i]) {
        const collateralDecimals = await _getDecimals(web3, collaterals[i], ERC20);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        const currentFinalFee = await store.methods.computeFinalFee(collaterals[i]).call();
        assert.equal(currentFinalFee.toString(), convertedFeeAmount, "Final fee was not set correctly");
        assert(await whitelist.methods.isOnWhitelist(collaterals[i]).call(), "Collateral is not on AddressWhitelist");
        console.log(`- Collateral @ ${collaterals[i]} has correct final fee and is whitelisted on Ethereum`);
      }
      if (polygonCollaterals && polygonCollaterals[i]) {
        // Construct expected data to be relayed to Polygon contracts
        const collateralDecimals = await _getDecimals(crossChainWeb3, polygonCollaterals[i], ERC20);
        const convertedFeeAmount = parseUnits(fees[i], collateralDecimals).toString();
        const setFinalFeeData = polygon_store.methods
          .setFinalFee(polygonCollaterals[i], { rawValue: convertedFeeAmount })
          .encodeABI();
        const addToWhitelistData = polygon_whitelist.methods.addToWhitelist(polygonCollaterals[i]).encodeABI();
        const relayedStoreTransactions = await governorRootTunnel.getPastEvents("RelayedGovernanceRequest", {
          filter: { to: polygon_store.options.address },
          fromBlock: 0,
        });
        assert(
          relayedStoreTransactions.find((e) => e.returnValues.data === setFinalFeeData),
          "Could not find RelayedGovernanceRequest matching expected relayed setFinalFee transaction"
        );
        const relayedWhitelistTransactions = await governorRootTunnel.getPastEvents("RelayedGovernanceRequest", {
          filter: { to: polygon_whitelist.options.address },
          fromBlock: 0,
        });
        assert(
          relayedWhitelistTransactions.find((e) => e.returnValues.data === addToWhitelistData),
          "Could not find RelayedGovernanceRequest matching expected relayed addToWhitelist transaction"
        );
        console.log(
          `- GovernorRootTunnel correctly emitted events to whitelist collateral ${polygonCollaterals[i]} with final fee set to ${convertedFeeAmount}`
        );
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
