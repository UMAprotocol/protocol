// Description:
// - Propose or verify Admin Proposal whitelisting new identifiers to Ethereum and/or Polygon
// Run:
// - For testing, start mainnet fork in one window with `yarn hardhat node --fork <ARCHIVAL_NODE_URL> --no-deploy`
// - (optional, or required if --polygon is not undefined) set CROSS_CHAIN_NODE_URL to a Polygon mainnet node. This will
// be used to query contract data from Polygon when relaying proposals through the GovernorRootTunnel.
// - Propose: HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/identifier.js --identifier 0xabc,0x123 --polygon 0xabc,0x123
// - Vote Simulate: HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/simulateVote.js
// - Verify: HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/identifier.js --verify --polygon 0xabc,0x123 --identifier 0xabc,0x123
// - For production, set the CUSTOM_NODE_URL environment and run the script with a different `HARDHAT_NETWORK` value,
//   for example: `HARDHAT_NETWORK=mainnet node ./packages/core/scripts/admin-proposals/identifier.js ...`

// Customizations:
// - --polygon param can be omitted, in which case transactions will only take place on Ethereum.
// - --identifier flag can also be omitted, in which case transactions will only be relayed to Polygon
// - --identifier and --polygon params must be comma delimited strings producing equal length array of identifiers to approve
// - Specific identifier or polygon-identifiers can be skipped to conform with the above constraint like so: --identifier ,, --polygon 0xab,,
// - If --verify flag is set, script is assumed to be running after a Vote Simulation and updated contract state is
// verified.

// Examples:
// - Whitelist identifiers on Ethereum only:
//    - `HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/identifier.js --identifier "POOL/USD","USD/POOL"`
// - Whitelist identifiers on Polygon only:
//    - `HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/identifier.js --polygon "POOL/USD","USD/POOL"`
// - Whitelist identifiers on both (some on Ethereum, some on Polygon):
//    - `HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/identifier.js --identifier "POOL/USD","USD/POOL" --polygon "POOL/USD",`

const hre = require("hardhat");
require("dotenv").config();
const { GasEstimator } = require("@uma/financial-templates-lib");
const Web3 = require("web3");
const winston = require("winston");
const { interfaceName } = require("@uma/common");
const { _getContractAddressByName } = require("./utils");
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

// Net ID returned by web3 when connected to a mainnet fork running on localhost.
const HARDHAT_NET_ID = 31337;
// Net ID that this script should simulate with.
const PROD_NET_ID = 1;
// Wallets we need to use to sign transactions.
const REQUIRED_SIGNER_ADDRESSES = { deployer: "0x2bAaA41d155ad8a4126184950B31F50A1513cE25" };

async function run() {
  const { identifier, polygon, verify } = argv;
  const { getContract, network, web3, assert } = hre;

  // Set up provider so that we can sign from special wallets:
  let netId = await web3.eth.net.getId();
  if (netId === HARDHAT_NET_ID) {
    console.log("🚸 Connected to a local node, attempting to impersonate accounts on forked network 🚸");
    console.table(REQUIRED_SIGNER_ADDRESSES);
    Object.keys(REQUIRED_SIGNER_ADDRESSES).map(async (signer) => {
      const result = await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [REQUIRED_SIGNER_ADDRESSES[signer]],
      });
      if (!result) throw new Error(`Failed to impersonate account ${REQUIRED_SIGNER_ADDRESSES[signer]}`);
    });
    console.log("🔐 Successfully impersonated accounts");
  } else {
    console.log("📛 Connected to a production node 📛");
  }

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
    if (!process.env.CROSS_CHAIN_NODE_URL)
      throw new Error("If --polygon is defined, you must set a CROSS_CHAIN_NODE_URL environment variable");
    crossChainWeb3 = new Web3(process.env.CROSS_CHAIN_NODE_URL);
    polygon_netId = await crossChainWeb3.eth.net.getId();
    polygon_whitelist = new crossChainWeb3.eth.Contract(
      IdentifierWhitelist.abi,
      _getContractAddressByName("IdentifierWhitelist", polygon_netId)
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
  if (netId === HARDHAT_NET_ID) netId = PROD_NET_ID;
  const whitelist = new web3.eth.Contract(
    IdentifierWhitelist.abi,
    _getContractAddressByName("IdentifierWhitelist", netId)
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
    console.log("    - https://github.com/UMAprotocol/protocol/blob/master/packages/core/test/polygon/e2e.js#L221");
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
        // Construct expected data to be relayed to Polygon contracts
        const addSupportedIdentifierData = polygon_whitelist.methods
          .addSupportedIdentifier(polygonIdentifiers[i])
          .encodeABI();
        const relayedWhitelistTransaction = await governorRootTunnel.getPastEvents("RelayedGovernanceRequest", {
          filter: { to: polygon_whitelist.options.address },
          fromBlock: 0,
        });
        assert(
          relayedWhitelistTransaction.find((e) => e.returnValues.data === addSupportedIdentifierData),
          "Could not find RelayedGovernanceRequest matching expected relayed addSupportedIdentifier transaction"
        );
        console.log(
          `- GovernorRootTunnel correctly emitted events to whitelist identifier ${
            polygonIdentifiers[i]
          } (UTF8: ${web3.utils.hexToUtf8(polygonIdentifiers[i])})`
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
