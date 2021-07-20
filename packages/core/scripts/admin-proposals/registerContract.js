// Description:
// - Register new financial contract on Ethereum and/or Polygon.

// Run:
// - For testing, start mainnet fork in one window with `yarn hardhat node --fork <ARCHIVAL_NODE_URL> --no-deploy --port 9545`
// - (optional, or required if --polygon is not undefined) set POLYGON_NODE_URL to a Polygon mainnet node. This will
//   be used to query contract data from Polygon when relaying proposals through the GovernorRootTunnel.
// - Propose: HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/registerContract.js --ethereum 0xabc --polygon 0xdef
// - Vote Simulate: HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/simulateVote.js
// - Verify: HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/registerContract.js --verify --ethereum 0xabc --polygon 0xdef
// - For production, set the CUSTOM_NODE_URL environment, run the script the Truffle `--network` flag (along with other
//   params like --keys) because production setting will try to set web3 equal to `getWeb3()` instead of `hre.web3`.
//   for example: `node ./packages/core/scripts/admin-proposals/registerContract.js ... --network mainnet_gckms --keys deployer`

// Customizations:
// - --polygon param can be omitted, in which case transactions will only take place on Ethereum.
// - --ethereum flag can also be omitted, in which case transactions will only be relayed to Polygon
// - If --verify flag is set, script is assumed to be running after a Vote Simulation and updated contract state is
// verified.

// Examples:
// - Register contract on Ethereum only:
//    - `HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/registerContract.js --ethereum 0xabc`
// - Register contract on Polygon only:
//    - `HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/registerContract.js --polygon 0xabc`
// - Register contract on both:
//    - `HARDHAT_NETWORK=localhost node ./packages/core/scripts/admin-proposals/registerContract.js --ethereum 0xabc --polygon 0xdef`

const hre = require("hardhat");
const { getContract } = hre;
require("dotenv").config();
const assert = require("assert");
const { GasEstimator } = require("@uma/financial-templates-lib");
const Web3 = require("web3");
const winston = require("winston");
const { RegistryRolesEnum, interfaceName } = require("@uma/common");
const { _getContractAddressByName, _setupWeb3 } = require("./utils");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // address to register on Ethereum
    "ethereum",
    // address to register on Polygon. Required if --ethereum is omitted
    "polygon",
  ],
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

// Wallets we need to use to sign transactions.
const REQUIRED_SIGNER_ADDRESSES = { deployer: "0x2bAaA41d155ad8a4126184950B31F50A1513cE25" };

async function run() {
  const { ethereum, polygon, verify } = argv;
  const { web3, netId } = await _setupWeb3(hre, REQUIRED_SIGNER_ADDRESSES);

  // Contract ABI's
  const Registry = getContract("Registry");
  const GovernorRootTunnel = getContract("GovernorRootTunnel");
  const GovernorChildTunnel = getContract("GovernorChildTunnel");
  const Governor = getContract("Governor");
  const Finder = getContract("Finder");
  const Voting = getContract("Voting");

  // Parse comma-delimited CLI params into arrays
  let ethereumContractToRegister = ethereum;
  let polygonContractToRegister = polygon;
  let crossChainWeb3;

  // If polygon address is specified, initialize Governance relay infrastructure contracts
  let polygon_netId;
  let polygon_registry;
  let polygon_governor;
  if (!(polygonContractToRegister || ethereumContractToRegister))
    throw new Error("Must specify either --ethereum or --polygon or both");
  else if (polygonContractToRegister) {
    if (!process.env.POLYGON_NODE_URL)
      throw new Error("If --polygon is defined, you must set a POLYGON_NODE_URL environment variable");
    crossChainWeb3 = new Web3(process.env.POLYGON_NODE_URL);
    polygon_netId = await crossChainWeb3.eth.net.getId();
    polygon_registry = new crossChainWeb3.eth.Contract(
      Registry.abi,
      _getContractAddressByName("Registry", polygon_netId)
    );
    polygon_governor = new crossChainWeb3.eth.Contract(
      GovernorChildTunnel.abi,
      _getContractAddressByName("GovernorChildTunnel", polygon_netId)
    );
  }

  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  const registry = new web3.eth.Contract(Registry.abi, _getContractAddressByName("Registry", netId));
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
  const governorRootTunnel = new web3.eth.Contract(
    GovernorRootTunnel.abi,
    _getContractAddressByName("GovernorRootTunnel", netId)
  );
  const finder = new web3.eth.Contract(Finder.abi, _getContractAddressByName("Finder", netId));
  const oracleAddress = await finder.methods
    .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    .call();
  const oracle = new web3.eth.Contract(Voting.abi, oracleAddress);

  if (polygonContractToRegister) {
    console.group("\nℹ️  Relayer infrastructure for Polygon transactions:");
    console.log(`- Registry @ ${polygon_registry.options.address}`);
    console.log(`- GovernorRootTunnel @ ${governorRootTunnel.options.address}`);
    console.log(`- GovernorChildTunnel @ ${polygon_governor.options.address}`);
    console.groupEnd();
  }
  console.group("\nℹ️  DVM infrastructure for Ethereum transactions:");
  console.log(`- Registry @ ${registry.options.address}`);
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
    if (ethereumContractToRegister) {
      console.group(`\n🟢 Registering new contract @ ${ethereumContractToRegister}`);
      if (!(await registry.methods.isContractRegistered(ethereumContractToRegister).call())) {
        // 1. Temporarily add the Governor as a contract creator.
        const addMemberData = registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, governor.options.address)
          .encodeABI();
        console.log("- addMemberData", addMemberData);
        adminProposalTransactions.push({ to: registry.options.address, value: 0, data: addMemberData });

        // 2. Register the contract as a verified contract.
        const registerContractData = registry.methods.registerContract([], ethereumContractToRegister).encodeABI();
        console.log("- registerContractData", registerContractData);
        adminProposalTransactions.push({ to: registry.options.address, value: 0, data: registerContractData });

        // 3. Remove the Governor from being a contract creator.
        const removeMemberData = registry.methods
          .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, governor.options.address)
          .encodeABI();
        console.log("- removeMemberData", removeMemberData);
        adminProposalTransactions.push({ to: registry.options.address, value: 0, data: removeMemberData });
      } else {
        console.log("- Contract @ ", ethereumContractToRegister, "is already registered. Nothing to do.");
      }

      console.groupEnd();
    }

    if (polygonContractToRegister) {
      console.group(`\n🟣 (Polygon) Registering new contract @ ${polygonContractToRegister}`);

      if (!(await polygon_registry.methods.isContractRegistered(polygonContractToRegister).call())) {
        // 1. Temporarily add the GovernorChildTunnel as a contract creator.
        const addMemberData = polygon_registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, polygon_governor.options.address)
          .encodeABI();
        console.log("- addMemberData", addMemberData);
        let relayGovernanceData = governorRootTunnel.methods
          .relayGovernance(polygon_registry.options.address, addMemberData)
          .encodeABI();
        console.log("- relayGovernanceData", relayGovernanceData);
        adminProposalTransactions.push({ to: governorRootTunnel.options.address, value: 0, data: relayGovernanceData });

        // 2. Register the contract as a verified contract.
        const registerContractData = polygon_registry.methods
          .registerContract([], polygonContractToRegister)
          .encodeABI();
        console.log("- registerContractData", registerContractData);
        relayGovernanceData = governorRootTunnel.methods
          .relayGovernance(polygon_registry.options.address, registerContractData)
          .encodeABI();
        console.log("- relayGovernanceData", relayGovernanceData);
        adminProposalTransactions.push({ to: governorRootTunnel.options.address, value: 0, data: relayGovernanceData });

        // 3. Remove the GovernorChildTunnel from being a contract creator.
        const removeMemberData = polygon_registry.methods
          .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, polygon_governor.options.address)
          .encodeABI();
        console.log("- removeMemberData", removeMemberData);
        relayGovernanceData = governorRootTunnel.methods
          .relayGovernance(polygon_registry.options.address, removeMemberData)
          .encodeABI();
        console.log("- relayGovernanceData", relayGovernanceData);
        adminProposalTransactions.push({ to: governorRootTunnel.options.address, value: 0, data: relayGovernanceData });
      } else {
        console.log("- Contract @ ", polygonContractToRegister, "is already registered. Nothing to do.");
      }

      console.groupEnd();
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
    if (ethereumContractToRegister) {
      assert(
        await registry.methods.isContractRegistered(ethereumContractToRegister).call(),
        "Contract is not registered"
      );
      assert(
        !(await registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governor.options.address).call()),
        "Governor still holds creator role"
      );
      console.log(`- Contract @ ${ethereumContractToRegister} is registered on Ethereum`);
    }

    if (polygonContractToRegister) {
      const addMemberData = polygon_registry.methods
        .addMember(RegistryRolesEnum.CONTRACT_CREATOR, polygon_governor.options.address)
        .encodeABI();
      const registerContractData = polygon_registry.methods.registerContract([], polygonContractToRegister).encodeABI();
      const removeMemberData = polygon_registry.methods
        .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, polygon_governor.options.address)
        .encodeABI();
      const relayedRegistryTransactions = await governorRootTunnel.getPastEvents("RelayedGovernanceRequest", {
        filter: { to: polygon_registry.options.address },
        fromBlock: 0,
      });
      const relayedRegisterContractEvent = relayedRegistryTransactions.find(
        (e) => e.returnValues.data === registerContractData
      );
      // It's hard to test whether the addMember and removeMember transactions were relayed as well, since those
      // governance transactions could have been executed many blocks before and after the registerContract
      // transaction respectively. For now, we'll make the loose assumption that they were executed within a
      // reasonable range of blocks, which will be true when testing against a Mainnet fork.
      const beforeRelayedRegistryTransactions = await governorRootTunnel.getPastEvents("RelayedGovernanceRequest", {
        filter: { to: polygon_registry.options.address },
        fromBlock: relayedRegisterContractEvent.blockNumber - 1,
        toBlock: relayedRegisterContractEvent.blockNumber,
      });
      assert(
        beforeRelayedRegistryTransactions.find((e) => e.returnValues.data === addMemberData),
        "Could not find RelayedGovernanceRequest matching expected relayed addMemberData transaction"
      );
      const afterRelayedRegistryTransactions = await governorRootTunnel.getPastEvents("RelayedGovernanceRequest", {
        filter: { to: polygon_registry.options.address },
        fromBlock: relayedRegisterContractEvent.blockNumber,
        toBlock: relayedRegisterContractEvent.blockNumber + 1,
      });
      assert(
        afterRelayedRegistryTransactions.find((e) => e.returnValues.data === removeMemberData),
        "Could not find RelayedGovernanceRequest matching expected relayed removeMemberData transaction"
      );
      console.log(
        `- GovernorRootTunnel correctly emitted events to registry ${polygon_registry.options.address} preceded and followed by addMember and removeMember respectively`
      );
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
