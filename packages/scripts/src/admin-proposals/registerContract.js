// Description:
// - Register new contract that can submit price requests to the DVM.

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - Propose: node ./packages/scripts/src/admin-proposals/registerContract.js --ethereum 0xabc --polygon 0xdef --network mainnet-fork
// - Verify: Add --verify flag to Propose command.

require("dotenv").config();
const assert = require("assert");
const Web3 = require("web3");
const { utf8ToHex, toChecksumAddress } = Web3.utils;
const { getWeb3ByChainId, interfaceName, RegistryRolesEnum } = require("@uma/common");
const {
  setupNetwork,
  validateNetworks,
  setupMainnet,
  fundArbitrumParentMessengerForOneTransaction,
  setupGasEstimator,
} = require("./utils");
const { REQUIRED_SIGNER_ADDRESSES } = require("../utils/constants");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // address to register on Ethereum.
    "ethereum",
    // address to register on Polygon.
    "polygon",
    // address to register on Arbitrum.
    "arbitrum",
    // contract name in Finder to set newly registered contract to.
    "finderName",
  ],
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

async function run() {
  const { ethereum, polygon, arbitrum, finderName, verify } = argv;
  if (!(polygon || ethereum || arbitrum)) throw new Error("Must specify either --ethereum, --polygon or --arbitrum");

  // Parse comma-delimited CLI params into arrays
  const networksToAdministrate = [];
  if (polygon) networksToAdministrate.push(137);
  if (arbitrum) networksToAdministrate.push(42161);
  validateNetworks(networksToAdministrate);
  let web3Providers = { 1: getWeb3ByChainId(1) }; // netID => Web3

  // Verify argv params:
  if (finderName !== undefined) {
    assert(Object.keys(interfaceName).includes(finderName), "finderName must be valid interface name");
  }

  // Construct all mainnet contract instances we'll need using the mainnet web3 provider.
  const mainnetContracts = await setupMainnet(web3Providers[1]);

  // Store contract instances for specified L2 networks
  let contractsByNetId = {}; // netId => contracts
  for (let netId of networksToAdministrate) {
    const networkData = await setupNetwork(netId);
    web3Providers[netId] = networkData.web3;
    contractsByNetId[netId] = networkData.contracts;
    console.group(`\nℹ️  Relayer infrastructure for network ${netId}:`);
    console.log(`- Registry @ ${contractsByNetId[netId].registry.options.address}`);
    console.log(
      `- ${netId === 137 ? "GovernorRootTunnel" : "GovernorHub"} @ ${
        contractsByNetId[netId].l1Governor.options.address
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
    if (ethereum) {
      console.group(`\n🟢 Registering new contract @ ${ethereum}`);
      if (!(await mainnetContracts.registry.methods.isContractRegistered(ethereum).call())) {
        // 1. Temporarily add the Governor as a contract creator.
        const addMemberData = mainnetContracts.registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, mainnetContracts.governor.options.address)
          .encodeABI();
        console.log("- addMemberData", addMemberData);
        adminProposalTransactions.push({
          to: mainnetContracts.registry.options.address,
          value: 0,
          data: addMemberData,
        });

        // 2. Register the contract as a verified contract.
        const registerContractData = mainnetContracts.registry.methods.registerContract([], ethereum).encodeABI();
        console.log("- registerContractData", registerContractData);
        adminProposalTransactions.push({
          to: mainnetContracts.registry.options.address,
          value: 0,
          data: registerContractData,
        });

        // 3. Remove the Governor from being a contract creator.
        const removeMemberData = mainnetContracts.registry.methods
          .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, mainnetContracts.governor.options.address)
          .encodeABI();
        console.log("- removeMemberData", removeMemberData);
        adminProposalTransactions.push({
          to: mainnetContracts.registry.options.address,
          value: 0,
          data: removeMemberData,
        });

        // 4. Set contract in finder.
        if (finderName !== undefined) {
          const setFinderData = mainnetContracts.finder.methods
            .changeImplementationAddress(utf8ToHex(interfaceName[finderName]), ethereum)
            .encodeABI();
          console.log("- changeImplementationAddressData", setFinderData);
          adminProposalTransactions.push({
            to: mainnetContracts.finder.options.address,
            value: 0,
            data: setFinderData,
          });
        }
      } else {
        console.log("- Contract @ ", ethereum, "is already registered. Nothing to do.");
      }

      console.groupEnd();
    }

    if (polygon) {
      console.group(`\n🟣 (Polygon) Registering new contract @ ${polygon}`);

      if (!(await contractsByNetId[137].registry.methods.isContractRegistered(polygon).call())) {
        // 1. Temporarily add the GovernorChildTunnel as a contract creator.
        const addMemberData = contractsByNetId[137].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, contractsByNetId[137].l1Governor.options.address)
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

        // 2. Register the contract as a verified contract.
        const registerContractData = contractsByNetId[137].registry.methods.registerContract([], polygon).encodeABI();
        console.log("- registerContractData", registerContractData);
        relayGovernanceData = contractsByNetId[137].l1Governor.methods
          .relayGovernance(contractsByNetId[137].registry.options.address, registerContractData)
          .encodeABI();
        console.log("- relayGovernanceData", relayGovernanceData);
        adminProposalTransactions.push({
          to: contractsByNetId[137].l1Governor.options.address,
          value: 0,
          data: relayGovernanceData,
        });

        // 3. Remove the GovernorChildTunnel from being a contract creator.
        const removeMemberData = contractsByNetId[137].registry.methods
          .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, contractsByNetId[137].l1Governor.options.address)
          .encodeABI();
        console.log("- removeMemberData", removeMemberData);
        relayGovernanceData = contractsByNetId[137].l1Governor.methods
          .relayGovernance(contractsByNetId[137].registry.options.address, removeMemberData)
          .encodeABI();
        console.log("- relayGovernanceData", relayGovernanceData);
        adminProposalTransactions.push({
          to: contractsByNetId[137].l1Governor.options.address,
          value: 0,
          data: relayGovernanceData,
        });

        // 4. Set contract in finder.
        if (finderName !== undefined) {
          const setFinderData = contractsByNetId[137].finder.methods
            .changeImplementationAddress(utf8ToHex(interfaceName[finderName]), polygon)
            .encodeABI();
          console.log("- changeImplementationAddressData", setFinderData);
          relayGovernanceData = contractsByNetId[137].l1Governor.methods
            .relayGovernance(contractsByNetId[137].finder.options.address, setFinderData)
            .encodeABI();
          console.log("- relayGovernanceData", relayGovernanceData);
          adminProposalTransactions.push({
            to: contractsByNetId[137].l1Governor.options.address,
            value: 0,
            data: relayGovernanceData,
          });
        }
      } else {
        console.log("- Contract @ ", polygon, "is already registered. Nothing to do.");
      }

      console.groupEnd();
    }

    if (arbitrum) {
      console.group(`\n🔴 (Arbitrum) Registering new contract @ ${arbitrum}`);

      if (!(await contractsByNetId[42161].registry.methods.isContractRegistered(arbitrum).call())) {
        // 1. Temporarily add the GovernorChildTunnel as a contract creator.
        const addMemberData = contractsByNetId[42161].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, contractsByNetId[42161].l1Governor.options.address)
          .encodeABI();
        console.log("- addMemberData", addMemberData);
        let relayGovernanceData = contractsByNetId[42161].l1Governor.methods
          .relayGovernance(42161, [{ to: contractsByNetId[42161].registry.options.address, data: addMemberData }])
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

        // 2. Register the contract as a verified contract.
        const registerContractData = contractsByNetId[42161].registry.methods
          .registerContract([], arbitrum)
          .encodeABI();
        console.log("- registerContractData", registerContractData);
        relayGovernanceData = contractsByNetId[42161].l1Governor.methods
          .relayGovernance(42161, [
            { to: contractsByNetId[42161].registry.options.address, data: registerContractData },
          ])
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

        // 3. Remove the GovernorChildTunnel from being a contract creator.
        const removeMemberData = contractsByNetId[42161].registry.methods
          .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, contractsByNetId[42161].l1Governor.options.address)
          .encodeABI();
        console.log("- removeMemberData", removeMemberData);
        relayGovernanceData = contractsByNetId[42161].l1Governor.methods
          .relayGovernance(42161, [{ to: contractsByNetId[42161].registry.options.address, data: removeMemberData }])
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

        // 4. Set contract in finder.
        if (finderName !== undefined) {
          const setFinderData = contractsByNetId[42161].finder.methods
            .changeImplementationAddress(utf8ToHex(interfaceName[finderName]), arbitrum)
            .encodeABI();
          console.log("- changeImplementationAddressData", setFinderData);
          relayGovernanceData = contractsByNetId[42161].l1Governor.methods
            .relayGovernance(42161, [{ to: contractsByNetId[42161].finder.options.address, data: setFinderData }])
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
        }
      } else {
        console.log("- Contract @ ", arbitrum, "is already registered. Nothing to do.");
      }

      console.groupEnd();
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
        await mainnetContracts.registry.methods.isContractRegistered(ethereum).call(),
        "Contract is not registered"
      );
      assert(
        !(await mainnetContracts.registry.methods
          .holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, mainnetContracts.governor.options.address)
          .call()),
        "Governor still holds creator role"
      );
      if (finderName !== undefined) {
        assert.equal(
          await mainnetContracts.finder.methods.getImplementationAddress(utf8ToHex(interfaceName[finderName])).call(),
          toChecksumAddress(ethereum),
          "Finder contract not set"
        );
      }
      console.log(`- Contract @ ${ethereum} is registered on Ethereum`);
    }

    if (polygon) {
      if (!(await contractsByNetId[137].registry.methods.isContractRegistered(polygon).call())) {
        const addMemberData = contractsByNetId[137].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, contractsByNetId[137].l1Governor.options.address)
          .encodeABI();
        const registerContractData = contractsByNetId[137].registry.methods.registerContract([], polygon).encodeABI();
        const removeMemberData = contractsByNetId[137].registry.methods
          .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, contractsByNetId[137].l1Governor.options.address)
          .encodeABI();
        const relayedRegistryTransactions = await contractsByNetId[137].l1Governor.getPastEvents(
          "RelayedGovernanceRequest",
          { filter: { to: contractsByNetId[137].registry.options.address }, fromBlock: 0 }
        );
        const relayedRegisterContractEvent = relayedRegistryTransactions.find(
          (e) => e.returnValues.data === registerContractData
        );
        // It's hard to test whether the addMember and removeMember transactions were relayed as well, since those
        // governance transactions could have been executed many blocks before and after the registerContract
        // transaction respectively. For now, we'll make the loose assumption that they were executed within a
        // reasonable range of blocks, which will be true when testing against a Mainnet fork.
        const beforeRelayedRegistryTransactions = await contractsByNetId[137].l1Governor.getPastEvents(
          "RelayedGovernanceRequest",
          {
            filter: { to: contractsByNetId[137].registry.options.address },
            fromBlock: relayedRegisterContractEvent.blockNumber - 1,
            toBlock: relayedRegisterContractEvent.blockNumber,
          }
        );
        assert(
          beforeRelayedRegistryTransactions.find((e) => e.returnValues.data === addMemberData),
          "Could not find RelayedGovernanceRequest matching expected relayed addMemberData transaction"
        );
        const afterRelayedRegistryTransactions = await contractsByNetId[137].l1Governor.getPastEvents(
          "RelayedGovernanceRequest",
          {
            filter: { to: contractsByNetId[137].registry.options.address },
            fromBlock: relayedRegisterContractEvent.blockNumber,
            toBlock: relayedRegisterContractEvent.blockNumber + 1,
          }
        );
        assert(
          afterRelayedRegistryTransactions.find((e) => e.returnValues.data === removeMemberData),
          "Could not find RelayedGovernanceRequest matching expected relayed removeMemberData transaction"
        );
        if (finderName !== undefined) {
          const setFinderData = contractsByNetId[137].finder.methods
            .changeImplementationAddress(utf8ToHex(interfaceName[finderName]), polygon)
            .encodeABI();
          const relayedFinderTransactions = await contractsByNetId[137].l1Governor.getPastEvents(
            "RelayedGovernanceRequest",
            { filter: { to: contractsByNetId[137].finder.options.address }, fromBlock: 0 }
          );
          assert(
            relayedFinderTransactions.find((e) => e.returnValues.data === setFinderData),
            "Could not find RelayedGovernanceRequest matching expected relayed setFinderData transaction"
          );
        }
        console.log(
          `- GovernorRootTunnel correctly emitted events to registry ${contractsByNetId[137].registry.options.address} preceded and followed by addMember and removeMember respectively`
        );
      } else {
        console.log("- Contract @ ", polygon, "is already registered on Polygon. Nothing to check.");
      }
    }

    if (arbitrum) {
      if (!(await contractsByNetId[42161].registry.methods.isContractRegistered(arbitrum).call())) {
        const addMemberData = contractsByNetId[42161].registry.methods
          .addMember(RegistryRolesEnum.CONTRACT_CREATOR, contractsByNetId[42161].l1Governor.options.address)
          .encodeABI();
        const registerContractData = contractsByNetId[42161].registry.methods
          .registerContract([], arbitrum)
          .encodeABI();
        const removeMemberData = contractsByNetId[42161].registry.methods
          .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, contractsByNetId[42161].l1Governor.options.address)
          .encodeABI();
        const relayedTransactions = await contractsByNetId[42161].l1Governor.getPastEvents("RelayedGovernanceRequest", {
          filter: { chainId: "42161", messenger: mainnetContracts.arbitrumParentMessenger.options.address },
          fromBlock: 0,
        });
        const relayedRegisterContractEvent = relayedTransactions.find(
          (e) =>
            e.returnValues.calls ===
            [{ to: contractsByNetId[42161].registry.options.address, data: registerContractData }]
        );
        // It's hard to test whether the addMember and removeMember transactions were relayed as well, since those
        // governance transactions could have been executed many blocks before and after the registerContract
        // transaction respectively. For now, we'll make the loose assumption that they were executed within a
        // reasonable range of blocks, which will be true when testing against a Mainnet fork.
        const beforeRelayedRegistryTransactions = await contractsByNetId[42161].l1Governor.getPastEvents(
          "RelayedGovernanceRequest",
          {
            filter: { chainId: "42161", messenger: mainnetContracts.arbitrumParentMessenger.options.address },
            fromBlock: relayedRegisterContractEvent.blockNumber - 1,
            toBlock: relayedRegisterContractEvent.blockNumber,
          }
        );
        assert(
          beforeRelayedRegistryTransactions.find(
            (e) =>
              e.returnValues.calls === [{ to: contractsByNetId[42161].registry.options.address, data: addMemberData }]
          ),
          "Could not find RelayedGovernanceRequest matching expected relayed addMemberData transaction"
        );
        const afterRelayedRegistryTransactions = await contractsByNetId[42161].l1Governor.getPastEvents(
          "RelayedGovernanceRequest",
          {
            filter: { chainId: "42161", messenger: mainnetContracts.arbitrumParentMessenger.options.address },
            fromBlock: relayedRegisterContractEvent.blockNumber,
            toBlock: relayedRegisterContractEvent.blockNumber + 1,
          }
        );
        assert(
          afterRelayedRegistryTransactions.find(
            (e) =>
              e.returnValues.calls ===
              [{ to: contractsByNetId[42161].registry.options.address, data: removeMemberData }]
          ),
          "Could not find RelayedGovernanceRequest matching expected relayed removeMemberData transaction"
        );
        if (finderName !== undefined) {
          assert.equal(
            await contractsByNetId[42161].finder.methods
              .getImplementationAddress(utf8ToHex(interfaceName[finderName]))
              .call(),
            toChecksumAddress(arbitrum),
            "Finder contract not set"
          );
        }
        console.log(
          `- GovernorRootTunnel correctly emitted events to registry ${contractsByNetId[42161].registry.options.address} preceded and followed by addMember and removeMember respectively`
        );
      } else {
        console.log("- Contract @ ", arbitrum, "is already registered on Arbitrum. Nothing to check.");
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
