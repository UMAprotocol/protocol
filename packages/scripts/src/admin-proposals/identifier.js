// Description:
// - Propose or verify Admin Proposal whitelisting new identifiers to Ethereum and/or Polygon
// Run:
// - For testing, start mainnet fork in one window with `yarn hardhat node --fork <ARCHIVAL_NODE_URL> --no-deploy --port 9545`
// - (optional, or required if --polygon is not undefined) set POLYGON_NODE_URL to a Polygon mainnet node. This will
// be used to query contract data from Polygon when relaying proposals through the GovernorRootTunnel.
// - Next, open another terminal window and run `./packages/scripts/setupFork.sh` to unlock
//   accounts on the local node that we'll need to run this script.
// - Propose: node ./packages/scripts/src/admin-proposals/identifier.js --identifier 0xabc,0x123 --polygon 0xabc,0x123 --network mainnet-fork
// - Vote Simulate: node ./packages/scripts/src/admin-proposals/simulateVote.js --network mainnet-fork
// - Verify: node ./packages/scripts/src/admin-proposals/identifier.js --verify --polygon 0xabc,0x123 --identifier 0xabc,0x123 --network mainnet-fork
// - For production, set the CUSTOM_NODE_URL environment, run the script with a production network passed to the
//   `--network` flag (along with other params like --keys) like so: `node ... --network mainnet_gckms --keys deployer`

// Customizations:
// - --polygon param can be omitted, in which case transactions will only take place on Ethereum.
// - --identifier flag can also be omitted, in which case transactions will only be relayed to Polygon
// - --identifier and --polygon params must be comma delimited strings producing equal length array of identifiers to approve
// - Specific identifier or polygon-identifiers can be skipped to conform with the above constraint like so: --identifier ,, --polygon 0xab,,
// - If --verify flag is set, script is assumed to be running after a Vote Simulation and updated contract state is
// verified.

// Examples:
// - Whitelist identifiers on Ethereum only:
//    - `node ./packages/scripts/src/admin-proposals/identifier.js --identifier "POOL/USD","USD/POOL" --network mainnet-fork`
// - Whitelist identifiers on Polygon only:
//    - `node ./packages/scripts/src/admin-proposals/identifier.js --polygon "POOL/USD","USD/POOL" --network mainnet-fork`
// - Whitelist identifiers on both (some on Ethereum, some on Polygon):
//    - `node ./packages/scripts/src/admin-proposals/identifier.js --identifier "POOL/USD","USD/POOL" --polygon "POOL/USD", --network mainnet-fork`

const hre = require("hardhat");
const { getContract } = hre;
require("dotenv").config();
const assert = require("assert");
const { GasEstimator } = require("@uma/financial-templates-lib");
const Web3 = require("web3");
const winston = require("winston");
const { interfaceName } = require("@uma/common");
const { _getContractAddressByName, _setupWeb3 } = require("../utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("../utils/constants");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // comma-delimited list of identifiers to whitelist on Ethereum. Required if --polygon is omitted.
    "identifier",
    // comma-delimited list of identifiers to whitelist on Polygon. Required if --identifier is omitted.
    "polygon",
  ],
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

async function run() {
  const { identifier, polygon, verify } = argv;
  const { web3, netId } = await _setupWeb3();

  // Contract ABI's
  const IdentifierWhitelist = getContract("IdentifierWhitelist");
  const GovernorRootTunnel = getContract("GovernorRootTunnel");
  const Governor = getContract("Governor");
  const Finder = getContract("Finder");
  const Voting = getContract("Voting");

  // Parse comma-delimited CLI params into arrays
  let identifiers;
  let polygonIdentifiers;
  let crossChainWeb3;
  let count;

  // If polygon identifiers are specified, initialize Governance relay infrastructure contracts
  let polygon_netId;
  let polygon_whitelist;
  if (polygon) {
    if (identifier) identifiers = identifier.split(",").map((id) => (id ? web3.utils.utf8ToHex(id) : null));
    polygonIdentifiers = polygon.split(",").map((id) => (id ? web3.utils.utf8ToHex(id) : null));
    if (!process.env.POLYGON_NODE_URL)
      throw new Error("If --polygon is defined, you must set a POLYGON_NODE_URL environment variable");
    crossChainWeb3 = new Web3(process.env.POLYGON_NODE_URL);
    polygon_netId = await crossChainWeb3.eth.net.getId();
    polygon_whitelist = new crossChainWeb3.eth.Contract(
      IdentifierWhitelist.abi,
      await _getContractAddressByName("IdentifierWhitelist", polygon_netId)
    );
    count = polygonIdentifiers.length;
  } else if (identifier) {
    identifiers = identifier.split(",").map((id) => (id ? web3.utils.utf8ToHex(id) : null));
    count = identifiers.length;
  } else {
    throw new Error("Must specify either --polygon or --identifier or both");
  }

  if (polygonIdentifiers && identifiers && polygonIdentifiers.length !== identifiers.length) {
    throw new Error("all comma-delimited input strings should result in equal length arrays");
  }

  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  const whitelist = new web3.eth.Contract(
    IdentifierWhitelist.abi,
    await _getContractAddressByName("IdentifierWhitelist", netId)
  );
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
  const governor = new web3.eth.Contract(Governor.abi, await _getContractAddressByName("Governor", netId));
  const finder = new web3.eth.Contract(Finder.abi, await _getContractAddressByName("Finder", netId));
  const oracleAddress = await finder.methods
    .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    .call();
  const oracle = new web3.eth.Contract(Voting.abi, oracleAddress);
  const governorRootTunnel = new web3.eth.Contract(
    GovernorRootTunnel.abi,
    await _getContractAddressByName("GovernorRootTunnel", netId)
  );
  if (polygonIdentifiers) {
    console.group("\nℹ️  Relayer infrastructure for Polygon transactions:");
    console.log(`- IdentifierWhitelist @ ${polygon_whitelist.options.address}`);
    console.log(`- GovernorRootTunnel @ ${governorRootTunnel.options.address}`);
    console.groupEnd();
  }
  console.group("\nℹ️  DVM infrastructure for Ethereum transactions:");
  console.log(`- IdentifierWhitelist @ ${whitelist.options.address}`);
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

    for (let i = 0; i < count; i++) {
      if (identifiers && identifiers[i]) {
        console.group(`\n🟢 Whitelisting identifier ${identifiers[i]} (UTF8: ${web3.utils.hexToUtf8(identifiers[i])})`);

        // The proposal will only whitelist a new identifier if it isn't already whitelisted.
        if (!(await whitelist.methods.isIdentifierSupported(identifiers[i]).call())) {
          const addSupportedIdentifierData = whitelist.methods.addSupportedIdentifier(identifiers[i]).encodeABI();
          console.log("- addSupportedIdentifierData", addSupportedIdentifierData);
          adminProposalTransactions.push({ to: whitelist.options.address, value: 0, data: addSupportedIdentifierData });
        } else {
          console.log("- Identifier is already on whitelist. Nothing to do.");
        }
        console.groupEnd();
      }

      if (polygonIdentifiers && polygonIdentifiers[i]) {
        console.group(
          `\n🟣 (Polygon) Whitelisting identifier ${polygonIdentifiers[i]} (UTF8: ${web3.utils.hexToUtf8(
            polygonIdentifiers[i]
          )})`
        );

        // The proposal will only whitelist a new identifier if it isn't already whitelisted.
        if (!(await polygon_whitelist.methods.isIdentifierSupported(polygonIdentifiers[i]).call())) {
          const addSupportedIdentifierData = polygon_whitelist.methods
            .addSupportedIdentifier(polygonIdentifiers[i])
            .encodeABI();
          console.log("- addSupportedIdentifierData", addSupportedIdentifierData);
          const relayGovernanceData = governorRootTunnel.methods
            .relayGovernance(polygon_whitelist.options.address, addSupportedIdentifierData)
            .encodeABI();
          console.log("- relayGovernanceData", relayGovernanceData);
          adminProposalTransactions.push({
            to: governorRootTunnel.options.address,
            value: 0,
            data: relayGovernanceData,
          });
        } else {
          console.log("- Identifier is already on whitelist. Nothing to do.");
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
    for (let i = 0; i < count; i++) {
      if (identifiers && identifiers[i]) {
        assert(await whitelist.methods.isIdentifierSupported(identifiers[i]).call(), "Identifier is not whitelisted");
        console.log(
          `- Identifier ${identifiers[i]} (UTF8: ${web3.utils.hexToUtf8(identifiers[i])}) is whitelisted on Ethereum`
        );
      }

      if (polygonIdentifiers && polygonIdentifiers[i]) {
        if (!(await polygon_whitelist.methods.isIdentifierSupported(polygonIdentifiers[i]).call())) {
          // Construct expected data to be relayed to Polygon contracts
          const addSupportedIdentifierData = polygon_whitelist.methods
            .addSupportedIdentifier(polygonIdentifiers[i])
            .encodeABI();
          const relayedWhitelistTransactions = await governorRootTunnel.getPastEvents("RelayedGovernanceRequest", {
            filter: { to: polygon_whitelist.options.address },
            fromBlock: 0,
          });
          assert(
            relayedWhitelistTransactions.find((e) => e.returnValues.data === addSupportedIdentifierData),
            "Could not find RelayedGovernanceRequest matching expected relayed addSupportedIdentifier transaction"
          );
          console.log(
            `- GovernorRootTunnel correctly emitted events to whitelist identifier ${
              polygonIdentifiers[i]
            } (UTF8: ${web3.utils.hexToUtf8(polygonIdentifiers[i])})`
          );
        } else {
          console.log(
            `- Identifier ${identifiers[i]} (UTF8: ${web3.utils.hexToUtf8(
              polygonIdentifiers[i]
            )}) is whitelisted on Polygon. Nothing to check.`
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
