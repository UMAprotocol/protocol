const hre = require("hardhat");
const { getContract } = hre;
const { getWeb3ByChainId, interfaceName } = require("@uma/common");
const { _getContractAddressByName } = require("../utils");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");
const Web3 = require("Web3");
const { fromWei } = Web3.utils;

// Contract ABI's
const Registry = getContract("Registry");
const GovernorRootTunnel = getContract("GovernorRootTunnel");
const GovernorHub = getContract("GovernorHub");
const Arbitrum_ParentMessenger = getContract("Arbitrum_ParentMessenger");
const Governor = getContract("Governor");
const Finder = getContract("Finder");
const Voting = getContract("Voting");
const VotingInterface = getContract("VotingInterface");
const AddressWhitelist = getContract("AddressWhitelist");
const Store = getContract("Store");

const L2_ADMIN_NETWORKS = [137, 42161];

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
      addressWhitelist: new l2Web3.eth.Contract(
        AddressWhitelist.abi,
        await _getContractAddressByName("AddressWhitelist", netId)
      ),
      store: new l2Web3.eth.Contract(Store.abi, await _getContractAddressByName("Store", netId)),
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
  const arbitrumParentMessenger = new web3.eth.Contract(
    Arbitrum_ParentMessenger.abi,
    await _getContractAddressByName("Arbitrum_ParentMessenger", 1)
  );
  const governorRootTunnel = new web3.eth.Contract(
    GovernorRootTunnel.abi,
    await _getContractAddressByName("GovernorRootTunnel", 1)
  );
  const governorHub = new web3.eth.Contract(GovernorHub.abi, await _getContractAddressByName("GovernorHub", 1));
  const registry = new web3.eth.Contract(Registry.abi, await _getContractAddressByName("Registry", 1));
  const governor = new web3.eth.Contract(Governor.abi, await _getContractAddressByName("Governor", 1));
  const addressWhitelist = new web3.eth.Contract(
    AddressWhitelist.abi,
    await _getContractAddressByName("AddressWhitelist", 1)
  );
  const store = new web3.eth.Contract(Store.abi, await _getContractAddressByName("Store", 1));
  console.group("\nℹ️  DVM infrastructure on L1:");
  console.log(`- Finder @ ${finder.options.address}`);
  console.log(`- Voting @ ${oracle.options.address}`);
  console.log(`- VotingInterface @ ${votingInterface.options.address}`);
  console.log(`- Registry @ ${registry.options.address}`);
  console.log(`- Governor @ ${governor.options.address}`);
  console.log(`- AddressWhitelist @ ${addressWhitelist.options.address}`);
  console.log(`- Store @ ${store.options.address}`);
  console.log(`- GovernorHub @ ${governorHub.options.address}`);
  console.log(`- GovernorRootTunnel @ ${governorRootTunnel.options.address}`);
  console.log(`- ArbitrumParentMessenger @ ${arbitrumParentMessenger.options.address}`);
  console.groupEnd();
  return {
    finder,
    oracle,
    votingInterface,
    arbitrumParentMessenger,
    governorRootTunnel,
    governorHub,
    registry,
    governor,
    addressWhitelist,
    store,
  };
};

const fundArbitrumParentMessengerForOneTransaction = async (arbitrumParentMessenger, web3Provider, from) => {
  // Sending a xchain transaction to Arbitrum will fail unless Arbitrum messenger has enough ETH to pay for message:
  const l1CallValue = await arbitrumParentMessenger.methods.getL1CallValue().call();
  console.log(
    `Arbitrum xchain messages require that the Arbitrum_ParentMessenger has at least a ${l1CallValue.toString()} ETH balance.`
  );
  const sendEthTxn = await web3Provider.eth.sendTransaction({
    from: from,
    to: arbitrumParentMessenger.options.address,
    value: l1CallValue.toString(),
  });
  console.log(`Sent ETH txn: ${sendEthTxn.transactionHash}`);
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

module.exports = {
  L2_ADMIN_NETWORKS,
  validateNetworks,
  setupNetwork,
  setupMainnet,
  setupGasEstimator,
  fundArbitrumParentMessengerForOneTransaction,
};
