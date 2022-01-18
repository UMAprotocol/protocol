// Description:
// - Adds new Contract Creator to Registry.

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - Propose: node ./packages/scripts/src/admin-proposals/addContractCreator.js --ethereum 0xabc --polygon 0xdef --network mainnet-fork
// - Verify: Add --verify flag to Propose command.

const assert = require("assert");
require("dotenv").config();
const { RegistryRolesEnum, getWeb3ByChainId } = require("@uma/common");
const {
  setupNetwork,
  validateNetworks,
  setupMainnet,
  fundArbitrumParentMessengerForOneTransaction,
  setupGasEstimator,
  relayGovernanceHubMessage,
  verifyGovernanceHubMessage,
  L2_ADMIN_NETWORK_NAMES,
  validateArgvNetworks,
  getNetworksToAdministrateFromArgv,
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
      console.group(`\n🟢 Adding new contract creator @ ${ethereum}`);
      if (!(await mainnetContracts.registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, ethereum).call())) {
        const addMemberData = mainnetContracts.registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, ethereum)
          .encodeABI();
        console.log("- addMemberData", addMemberData);
        adminProposalTransactions.push({
          to: mainnetContracts.registry.options.address,
          value: 0,
          data: addMemberData,
        });
      } else {
        console.log("- Contract @ ", ethereum, "is already a contract creator. Nothing to do.");
      }

      console.groupEnd();
    }

    if (polygon) {
      console.group(`\n🟣 (Polygon) Adding new contract creator @ ${polygon}`);

      if (
        !(await contractsByNetId[137].registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, polygon).call())
      ) {
        const addMemberData = contractsByNetId[137].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, polygon)
          .encodeABI();
        console.log("- addMemberData", addMemberData);
        let relayGovernanceData = contractsByNetId[137].l1Governor.methods
          .relayGovernance(contractsByNetId[137].registry.options.address, addMemberData)
          .encodeABI();
        console.log("- relayGovernanceData", relayGovernanceData);
        adminProposalTransactions.push({
          to: contractsByNetId[137].l1Governor.options.address,
          value: 0,
          data: relayGovernanceData,
        });
      } else {
        console.log("- Contract @ ", polygon, "is already a contract creator. Nothing to do.");
      }

      console.groupEnd();
    }

    if (governorHubNetworks.length > 0) {
      for (const network of governorHubNetworks) {
        console.group(`\n🔴 (${network.name}) Adding new contract creator @ ${network.value}`);
        if (
          !(await contractsByNetId[network.chainId].registry.methods
            .holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, network.value)
            .call())
        ) {
          const addMemberData = contractsByNetId[network.chainId].registry.methods
            .addMember(RegistryRolesEnum.CONTRACT_CREATOR, network.value)
            .encodeABI();
          console.log("- addMemberData", addMemberData);
          adminProposalTransactions.push(
            await relayGovernanceHubMessage(
              contractsByNetId[network.chainId].registry.options.address,
              addMemberData,
              contractsByNetId[network.chainId].l1Governor,
              network.chainId
            )
          );
          if (network.chainId === 137) {
            await fundArbitrumParentMessengerForOneTransaction(web3Providers[1], REQUIRED_SIGNER_ADDRESSES["deployer"]);
          }
        } else {
          console.log("- Contract @ ", network.value, "is already a contract creator. Nothing to do.");
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
    if (ethereum) {
      assert(
        await mainnetContracts.registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, ethereum),
        "Contract does not hold creator role"
      );
      console.log(`- Contract @ ${ethereum} holds creator role on Ethereum`);
    }

    if (polygon) {
      if (
        !(await contractsByNetId[137].registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, polygon).call())
      ) {
        const addMemberData = contractsByNetId[137].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, polygon)
          .encodeABI();
        const relayedRegistryTransactions = await contractsByNetId[137].l1Governor.getPastEvents(
          "RelayedGovernanceRequest",
          { filter: { to: contractsByNetId[137].registry.options.address }, fromBlock: 0 }
        );
        assert(
          relayedRegistryTransactions.find((e) => e.returnValues.data === addMemberData),
          "Could not find RelayedGovernanceRequest matching expected relayed addMemberData transaction"
        );
        console.log(
          `- GovernorRootTunnel correctly emitted events to registry ${contractsByNetId[137].registry.options.address} containing addMember data`
        );
      } else {
        console.log("- Contract @ ", polygon, "is already a contract creator on Polygon. Nothing to check.");
      }
    }

    if (governorHubNetworks.length > 0) {
      for (const network of governorHubNetworks) {
        if (
          !(await contractsByNetId[network.chainId].registry.methods
            .holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, network.value)
            .call())
        ) {
          const addMemberData = contractsByNetId[network.chainId].registry.methods
            .addMember(RegistryRolesEnum.CONTRACT_CREATOR, network.value)
            .encodeABI();
          await verifyGovernanceHubMessage(
            contractsByNetId[network.chainId].registry.options.address,
            addMemberData,
            contractsByNetId[network.chainId].l1Governor,
            network.chainId
          );
          console.log(
            `- GovernorHub for ${network.name} correctly emitted events to registry ${
              contractsByNetId[network.chainId].registry.options.address
            } containing addMember data`
          );
        } else {
          console.log("- Contract @ ", network.value, "is already a contract creator. Nothing to check.");
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
