const hre = require("hardhat");
const { getContract } = hre;
const { getWeb3ByChainId, interfaceName, MAX_UINT_VAL } = require("@uma/common");
const { _getContractAddressByName } = require("../utils");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");
const Web3 = require("web3");
const { fromWei, toBN } = Web3.utils;
const assert = require("assert");

// Contract ABI's
const Registry = getContract("Registry");
const Proposer = getContract("Proposer");
const GovernorRootTunnel = getContract("GovernorRootTunnel");
const GovernorHub = getContract("GovernorHub");
const GovernorChildTunnel = getContract("GovernorChildTunnel");
const GovernorSpoke = getContract("GovernorSpoke");
const Arbitrum_ParentMessenger = getContract("Arbitrum_ParentMessenger");
const Governor = getContract("Governor");
const Finder = getContract("Finder");
const Voting = getContract("Voting");
const ExpandedERC20 = getContract("ExpandedERC20");
const VotingInterface = getContract("VotingInterface");
const AddressWhitelist = getContract("AddressWhitelist");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Store = getContract("Store");
const Multicall2 = getContract("Multicall2");

const L2_ADMIN_NETWORKS = [137, 42161, 10, 288];

const L2_ADMIN_NETWORK_NAMES = [
  // address to add on Ethereum.
  "ethereum",
  // address to add on Polygon.
  "polygon",
  // address to add on arbitrum.
  "arbitrum",
  // address to add on optimism.
  "optimism",
  // address to add on boba.
  "boba",
];

const validateArgvNetworks = (argv) => {
  let networksIncluded = 0;
  for (const network of L2_ADMIN_NETWORK_NAMES) {
    if (Object.keys(argv).includes(network)) networksIncluded++;
  }
  if (networksIncluded === 0)
    throw new Error("Must specify either --ethereum, --polygon, --arbitrum, --optimism, or --boba");
};

const getNetworksToAdministrateFromArgv = (argv) => {
  const networksToAdministrate = {
    ethereum: argv.ethereum,
    polygon: argv.polygon,
    governorHubNetworks: [],
    chainIds: [],
  };
  for (const networkName of L2_ADMIN_NETWORK_NAMES) {
    if (Object.keys(argv).includes(networkName) && argv[networkName] !== undefined) {
      switch (networkName) {
        case "polygon":
          networksToAdministrate.chainIds.push(137);
          break;
        case "arbitrum":
          networksToAdministrate.governorHubNetworks.push({
            chainId: 42161,
            name: "arbitrum",
            value: argv["arbitrum"],
          });
          networksToAdministrate.chainIds.push(42161);
          break;
        case "boba":
          networksToAdministrate.governorHubNetworks.push({ chainId: 288, name: "boba", value: argv["boba"] });
          networksToAdministrate.chainIds.push(288);
          break;
        case "optimism":
          networksToAdministrate.governorHubNetworks.push({ chainId: 10, name: "optimism", value: argv["optimism"] });
          networksToAdministrate.chainIds.push(10);
          break;
        default:
          break;
      }
    }
  }
  return networksToAdministrate;
};

const validateNetworks = (netIds) => {
  netIds.forEach((_id) => {
    if (!L2_ADMIN_NETWORKS.includes(_id)) throw new Error(`Invalid net ID ${netIds}`);
  });
};

const setupNetwork = async (netId) => {
  const l2Web3 = getWeb3ByChainId(netId);
  const l1Web3 = getWeb3ByChainId(1);
  return {
    web3: l2Web3,
    contracts: {
      registry: new l2Web3.eth.Contract(Registry.abi, await _getContractAddressByName("Registry", netId)),
      l1Governor:
        netId === 137
          ? new l1Web3.eth.Contract(GovernorRootTunnel.abi, await _getContractAddressByName("GovernorRootTunnel", 1))
          : new l1Web3.eth.Contract(GovernorHub.abi, await _getContractAddressByName("GovernorHub", 1)),
      l2Governor:
        netId === 137
          ? new l2Web3.eth.Contract(
              GovernorChildTunnel.abi,
              await _getContractAddressByName("GovernorChildTunnel", netId)
            )
          : new l2Web3.eth.Contract(GovernorSpoke.abi, await _getContractAddressByName("GovernorSpoke", netId)),
      addressWhitelist: new l2Web3.eth.Contract(
        AddressWhitelist.abi,
        await _getContractAddressByName("AddressWhitelist", netId)
      ),
      identifierWhitelist: new l2Web3.eth.Contract(
        IdentifierWhitelist.abi,
        await _getContractAddressByName("IdentifierWhitelist", netId)
      ),
      store: new l2Web3.eth.Contract(Store.abi, await _getContractAddressByName("Store", netId)),
      finder: new l2Web3.eth.Contract(Finder.abi, await _getContractAddressByName("Finder", netId)),
    },
  };
};

const setupMainnet = async (web3) => {
  const finder = new web3.eth.Contract(Finder.abi, await _getContractAddressByName("Finder", 1));
  const oracleAddress = await finder.methods
    .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    .call();
  const oracle = new web3.eth.Contract(Voting.abi, oracleAddress);
  const votingInterface = new web3.eth.Contract(VotingInterface.abi, oracleAddress);
  const governorRootTunnel = new web3.eth.Contract(
    GovernorRootTunnel.abi,
    await _getContractAddressByName("GovernorRootTunnel", 1)
  );
  const governorHub = new web3.eth.Contract(GovernorHub.abi, await _getContractAddressByName("GovernorHub", 1));
  const registry = new web3.eth.Contract(Registry.abi, await _getContractAddressByName("Registry", 1));
  const governor = new web3.eth.Contract(Governor.abi, await _getContractAddressByName("Governor", 1));
  const proposer = new web3.eth.Contract(Proposer.abi, await _getContractAddressByName("Proposer", 1));
  const addressWhitelist = new web3.eth.Contract(
    AddressWhitelist.abi,
    await _getContractAddressByName("AddressWhitelist", 1)
  );
  const identifierWhitelist = new web3.eth.Contract(
    IdentifierWhitelist.abi,
    await _getContractAddressByName("IdentifierWhitelist", 1)
  );

  const multicall = new web3.eth.Contract(Multicall2.abi, await _getContractAddressByName("Multicall2", 1));

  const store = new web3.eth.Contract(Store.abi, await _getContractAddressByName("Store", 1));
  console.group("\nℹ️  DVM infrastructure on L1:");
  console.log(`- Finder @ ${finder.options.address}`);
  console.log(`- Voting @ ${oracle.options.address}`);
  console.log(`- VotingInterface @ ${votingInterface.options.address}`);
  console.log(`- Registry @ ${registry.options.address}`);
  console.log(`- Proposer @ ${proposer.options.address}`);
  console.log(`- Governor @ ${governor.options.address}`);
  console.log(`- AddressWhitelist @ ${addressWhitelist.options.address}`);
  console.log(`- IdentifierWhitelist @ ${identifierWhitelist.options.address}`);
  console.log(`- Store @ ${store.options.address}`);
  console.log(`- GovernorHub @ ${governorHub.options.address}`);
  console.log(`- GovernorRootTunnel @ ${governorRootTunnel.options.address}`);
  console.log(`- Multicall2 @ ${multicall.options.address}`);
  console.groupEnd();
  return {
    finder,
    oracle,
    votingInterface,
    governorRootTunnel,
    governorHub,
    registry,
    governor,
    addressWhitelist,
    identifierWhitelist,
    store,
    proposer,
    multicall,
  };
};

const fundArbitrumParentMessengerForOneTransaction = async (web3Provider, from, gasPriceObj) => {
  // Sending a xchain transaction to Arbitrum will fail unless Arbitrum messenger has enough ETH to pay for message:
  const arbitrumParentMessenger = new web3Provider.eth.Contract(
    Arbitrum_ParentMessenger.abi,
    await _getContractAddressByName("Arbitrum_ParentMessenger", 1)
  );
  const l1CallValue = await arbitrumParentMessenger.methods.getL1CallValue().call();
  console.log(
    `Arbitrum xchain messages require that the Arbitrum_ParentMessenger has at least a ${l1CallValue.toString()} ETH balance.`
  );
  if (toBN(await web3Provider.eth.getBalance(arbitrumParentMessenger.options.address)) < toBN(l1CallValue)) {
    const sendEthTxn = await web3Provider.eth.sendTransaction({
      from: from,
      to: arbitrumParentMessenger.options.address,
      value: l1CallValue.toString(),
      ...gasPriceObj,
    });
    console.log(`Sent ETH txn: ${sendEthTxn.transactionHash}`);
  } else {
    console.log("Arbitrum messenger has enough ETH");
  }
};

const setupGasEstimator = async () => {
  // GasEstimator only needs to be connected to mainnet since we're only sending transactions via mainnet contracts.
  const gasEstimator = new GasEstimator(
    winston.createLogger({ silent: true }),
    60, // Time between updates.
    1
  );
  await gasEstimator.update();
  console.log(
    `⛽️ Current fast gas price for Ethereum: ${fromWei(
      gasEstimator.getCurrentFastPrice().maxFeePerGas.toString(),
      "gwei"
    )} maxFeePerGas and ${fromWei(
      gasEstimator.getCurrentFastPrice().maxPriorityFeePerGas.toString(),
      "gwei"
    )} maxPriorityFeePerGas`
  );
  return gasEstimator;
};

// Returns transaction object to send to the GovernorHub on L1 in order to relay a message
// to the targetAddress on the network specified by the networkId.
const relayGovernanceHubMessage = async (targetAddress, message, governorHub, chainId) => {
  const calls = [{ to: targetAddress, data: message }];
  let relayGovernanceData = governorHub.methods.relayGovernance(chainId, calls).encodeABI();
  console.log("- relayGovernanceData", relayGovernanceData);
  return { to: governorHub.options.address, value: 0, data: relayGovernanceData };
};
const verifyGovernanceHubMessage = async (targetAddress, message, governorHub, chainId) => {
  const relayedTransactions = await governorHub.getPastEvents("RelayedGovernanceRequest", {
    filter: { chainId },
    fromBlock: 0,
  });
  assert(
    relayedTransactions.find(
      (e) => e.returnValues.calls[0].to === targetAddress && e.returnValues.calls[0].data === message
    ),
    "Could not find RelayedGovernanceRequest matching expected relayed message"
  );
};

const relayGovernanceRootTunnelMessage = async (targetAddress, message, governorRootTunnel) => {
  const relayGovernanceData = governorRootTunnel.methods.relayGovernance(targetAddress, message).encodeABI();
  console.log("- relayGovernanceData", relayGovernanceData);
  return { to: governorRootTunnel.options.address, value: 0, data: relayGovernanceData };
};
const verifyGovernanceRootTunnelMessage = async (targetAddress, message, governorRootTunnel) => {
  const relayedTransactions = await governorRootTunnel.getPastEvents("RelayedGovernanceRequest", {
    filter: { to: targetAddress },
    fromBlock: 0,
  });
  assert(
    relayedTransactions.find((e) => e.returnValues.data === message),
    "Could not find RelayedGovernanceRequest matching expected relayed transaction"
  );
};

const proposeAdminTransactions = async (web3, adminProposalTransactions, caller, gasPriceObj) => {
  const proposer = new web3.eth.Contract(Proposer.abi, await _getContractAddressByName("Proposer", 1));
  console.group(`\n📨 Sending to proposer @ ${proposer.options.address}`);
  console.log(`- Admin proposal contains ${adminProposalTransactions.length} transactions`);
  if (adminProposalTransactions.length > 0) {
    const finder = new web3.eth.Contract(Finder.abi, await _getContractAddressByName("Finder", 1));
    const oracleAddress = await finder.methods
      .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
      .call();
    const oracle = new web3.eth.Contract(Voting.abi, oracleAddress);
    const votingToken = new web3.eth.Contract(ExpandedERC20.abi, await _getContractAddressByName("VotingToken", 1));

    // Caller must have 5000 voting token in wallet and have approved proposer contract to pull them.
    const votingTokenBalance = toBN(await votingToken.methods.balanceOf(caller).call());
    const requiredVotingTokenBalance = toBN(await proposer.methods.bond().call());
    if (votingTokenBalance.lt(requiredVotingTokenBalance)) {
      throw new Error(
        `Caller only has ${votingTokenBalance.toString()} UMA, but submitting a proposal requires ${requiredVotingTokenBalance.toString()} UMA.`
      );
    } else {
      console.log("- Proposer has sufficient UMA balance");
    }
    const votingTokenAllowance = toBN(await votingToken.methods.allowance(caller, proposer.options.address).call());
    if (votingTokenAllowance.lt(requiredVotingTokenBalance)) {
      console.log(`- Approving proposer @ ${proposer.options.address} to spend unlimited UMA from caller...`);
      const approvalTxn = await votingToken.methods
        .approve(proposer.options.address, MAX_UINT_VAL)
        .send({ from: caller, ...gasPriceObj });
      console.log(`- Transaction: ${approvalTxn?.transactionHash}`);
    } else {
      console.log("- Proposer has sufficient allowance");
    }

    const txn = await proposer.methods.propose(adminProposalTransactions).send({ from: caller, ...gasPriceObj });
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
};

module.exports = {
  L2_ADMIN_NETWORK_NAMES,
  L2_ADMIN_NETWORKS,
  validateArgvNetworks,
  validateNetworks,
  getNetworksToAdministrateFromArgv,
  setupNetwork,
  setupMainnet,
  setupGasEstimator,
  fundArbitrumParentMessengerForOneTransaction,
  relayGovernanceHubMessage,
  verifyGovernanceHubMessage,
  relayGovernanceRootTunnelMessage,
  verifyGovernanceRootTunnelMessage,
  proposeAdminTransactions,
};
