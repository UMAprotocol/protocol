import { Deployment } from "hardhat-deploy/types";
import { interfaceName } from "../../Constants";
import { isPublicNetwork, PublicNetworks } from "../../PublicNetworks";
import { task } from "hardhat/config";
import { Contract } from "web3-eth-contract";
import { CombinedHRE } from "./types";
import Web3 from "web3";
const { utf8ToHex, toBN } = Web3.utils;
const assert = require("assert");

const L2_CHAIN_NAMES = ["arbitrum", "optimism", "boba"];
L2_CHAIN_NAMES.forEach((chainName) =>
  assert(isPublicNetwork(chainName), "L2_CHAIN_NAMES contains invalid public network name")
);

const getChainNameForId = (chainId: number): string => {
  const network = PublicNetworks[chainId];
  if (!network || !network.name) throw new Error("Cannot find chain name with ID");
  function capitalizeFirstLetter(_string: string): string {
    return _string.charAt(0).toUpperCase() + _string.slice(1);
  }
  return capitalizeFirstLetter(network.name);
};
const getChainIdForName = (chainName: string): number => {
  let id: number | undefined = undefined;
  Object.keys(PublicNetworks).map((chainId: string) => {
    if (PublicNetworks[Number(chainId)].name === chainName) {
      id = Number(chainId);
    }
  });
  if (id === undefined) throw new Error("Cannot find chain ID for name");
  return id;
};

async function setupHub(hub: Contract, deployer: string, parentMessenger: string, childChainId: number) {
  const [owner, existingParentMessenger] = await Promise.all([
    hub.methods.owner().call(),
    hub.methods.messengers(childChainId).call(),
  ]);

  assert(owner === deployer, `Accounts[0] (${deployer}) is not equal to hub owner (${owner})`);
  if (existingParentMessenger !== parentMessenger) {
    console.log(`Setting hub messenger for ID ${childChainId} to ${parentMessenger}...`);
    const setMessengerTxn = await hub.methods.setMessenger(childChainId, parentMessenger).send({ from: deployer });
    console.log(`...txn: ${setMessengerTxn.transactionHash}`);
  }
}

async function setupParentMessenger(
  messenger: Contract,
  deployer: string,
  childMessenger: Deployment,
  oracleHub: Deployment,
  governorHub: Deployment,
  oracleSpoke: Deployment,
  governorSpoke: Deployment
) {
  const contractState = await Promise.all([
    messenger.methods.getL1CallValue().call(),
    messenger.methods.owner().call(),
    messenger.methods.childMessenger().call(),
    messenger.methods.oracleHub().call(),
    messenger.methods.oracleSpoke().call(),
    messenger.methods.governorHub().call(),
    messenger.methods.governorSpoke().call(),
  ]);
  const messengerOwner = contractState[1];
  const messengerChildMessenger = contractState[2];
  const messengerOracleHub = contractState[3];
  const messengerOracleSpoke = contractState[4];
  const messengerGovernorHub = contractState[5];
  const messengerGovernorSpoke = contractState[6];

  // Submit parent messenger local transactions:
  assert(
    messengerOwner === deployer,
    `Accounts[0] (${deployer}) is not equal to parent messenger owner (${messengerOwner})`
  );
  if (messengerChildMessenger !== childMessenger.address) {
    console.log(`Setting child messenger to ${childMessenger.address}...`);
    const setChildMessengerTxn = await messenger.methods
      .setChildMessenger(childMessenger.address)
      .send({ from: deployer });
    console.log(`...txn: ${setChildMessengerTxn.transactionHash}`);
  }
  if (messengerOracleHub !== oracleHub.address) {
    console.log(`Setting oracle hub to ${oracleHub.address}...`);
    const setOracleHubTxn = await messenger.methods.setOracleHub(oracleHub.address).send({ from: deployer });
    console.log(`...txn: ${setOracleHubTxn.transactionHash}`);
  }
  if (messengerGovernorHub !== governorHub.address) {
    console.log(`Setting governor hub to ${governorHub.address}...`);
    const setGovernorHubTxn = await messenger.methods.setGovernorHub(governorHub.address).send({ from: deployer });
    console.log(`...txn: ${setGovernorHubTxn.transactionHash}`);
  }
  if (messengerOracleSpoke !== oracleSpoke.address) {
    console.log(`Setting oracle spoke to ${oracleSpoke.address}...`);
    const setOracleSpokeTxn = await messenger.methods.setOracleSpoke(oracleSpoke.address).send({ from: deployer });
    console.log(`...txn: ${setOracleSpokeTxn.transactionHash}`);
  }
  if (messengerGovernorSpoke !== governorSpoke.address) {
    console.log(`Setting governor spoke to ${governorSpoke.address}...`);
    const setGovernorSpokeTxn = await messenger.methods
      .setGovernorSpoke(governorSpoke.address)
      .send({ from: deployer });
    console.log(`...txn: ${setGovernorSpokeTxn.transactionHash}`);
  }

  return contractState;
}

async function setupChildMessenger(
  finder: Contract,
  deployer: string,
  childMessenger: Deployment,
  registry: Deployment
) {
  const [finderChildMessenger, finderRegistry, finderOwner] = await Promise.all([
    finder.methods.interfacesImplemented(utf8ToHex("ChildMessenger")).call(),
    finder.methods.interfacesImplemented(utf8ToHex("Registry")).call(),
    finder.methods.owner().call(),
  ]);

  // Submit Finder transactions:
  assert(finderOwner === deployer, `Accounts[0] (${deployer}) is not equal to finder owner (${finderOwner})`);
  if (finderChildMessenger !== childMessenger.address) {
    console.log(`Setting finder ChildMessenger to ${childMessenger.address}...`);
    const setMessengerTxn = await finder.methods
      .changeImplementationAddress(utf8ToHex("ChildMessenger"), childMessenger.address)
      .send({ from: deployer });
    console.log(`...txn: ${setMessengerTxn.transactionHash}`);
  }
  if (finderRegistry !== registry.address) {
    console.log(`Setting finder Registry to ${registry.address}...`);
    const setRegistryTxn = await finder.methods
      .changeImplementationAddress(utf8ToHex("Registry"), registry.address)
      .send({ from: deployer });
    console.log(`...txn: ${setRegistryTxn.transactionHash}`);
  }
}

async function setupOvmBasedL1Chain(hre_: any, chainId: number) {
  const chainName = getChainNameForId(chainId);
  const hre = hre_ as CombinedHRE;
  const { deployments, getNamedAccounts, web3, companionNetworks } = hre;
  const { deployer } = await getNamedAccounts();

  const ParentMessenger = await deployments.get(`${chainName}_ParentMessenger`);
  const messenger = new web3.eth.Contract(ParentMessenger.abi, ParentMessenger.address);
  const OracleHub = await deployments.get("OracleHub");
  const oracleHub = new web3.eth.Contract(OracleHub.abi, OracleHub.address);
  const GovernorHub = await deployments.get("GovernorHub");
  const governorHub = new web3.eth.Contract(GovernorHub.abi, GovernorHub.address);

  console.log(`Found ParentMessenger @ ${messenger.options.address}`);
  console.log(`Found OracleHub @ ${oracleHub.options.address}`);
  console.log(`Found GovernorHub @ ${governorHub.options.address}`);

  const OracleSpoke = await companionNetworks.optimism.deployments.get("OracleSpoke");
  const ChildMessenger = await companionNetworks.optimism.deployments.get(`${chainName}_ChildMessenger`);
  const GovernorSpoke = await companionNetworks.optimism.deployments.get("GovernorSpoke");

  await setupParentMessenger(messenger, deployer, ChildMessenger, OracleHub, GovernorHub, OracleSpoke, GovernorSpoke);

  // Submit parent messenger cross-chain transactions:
  console.log(`Setting child oracle spoke address to ${OracleSpoke.address}...`);
  const setChildOracleSpokeTxn = await messenger.methods
    .setChildOracleSpoke(OracleSpoke.address)
    .send({ from: deployer });
  console.log(`...txn: ${setChildOracleSpokeTxn.transactionHash}`);
  console.log(`Setting child parent messenger to ${messenger.options.address}...`);
  const setChildParentMessengerTxn = await messenger.methods
    .setChildParentMessenger(messenger.options.address)
    .send({ from: deployer });
  console.log(`...txn: ${setChildParentMessengerTxn.transactionHash}`);

  // Submit oracle hub transactions:
  await setupHub(oracleHub, deployer, messenger.options.address, chainId);

  // Submit governor hub transactions:
  await setupHub(governorHub, deployer, messenger.options.address, chainId);
}

task("setup-l1-arbitrum-xchain", "Configures L1 cross chain smart contracts for Arbitrum bridge").setAction(
  async function (_, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, getNamedAccounts, web3, companionNetworks } = hre;
    const { deployer } = await getNamedAccounts();

    const ParentMessenger = await deployments.get("Arbitrum_ParentMessenger");
    const messenger = new web3.eth.Contract(ParentMessenger.abi, ParentMessenger.address);
    const OracleHub = await deployments.get("OracleHub");
    const oracleHub = new web3.eth.Contract(OracleHub.abi, OracleHub.address);
    const GovernorHub = await deployments.get("GovernorHub");
    const governorHub = new web3.eth.Contract(GovernorHub.abi, GovernorHub.address);

    console.log(`Found ParentMessenger @ ${messenger.options.address}`);
    console.log(`Found OracleHub @ ${oracleHub.options.address}`);
    console.log(`Found GovernorHub @ ${governorHub.options.address}`);

    const OracleSpoke = await companionNetworks.arbitrum.deployments.get("OracleSpoke");
    const ChildMessenger = await companionNetworks.arbitrum.deployments.get("Arbitrum_ChildMessenger");
    const GovernorSpoke = await companionNetworks.arbitrum.deployments.get("GovernorSpoke");

    const contractState = await setupParentMessenger(
      messenger,
      deployer,
      ChildMessenger,
      OracleHub,
      GovernorHub,
      OracleSpoke,
      GovernorSpoke
    );
    const requiredL1CallValue = contractState[0];

    // The following calls require that the caller has enough gas to cover each cross chain transaction, which requires
    // at most (l2GasLimit * l2GasPrice + maxSubmissionCost) ETH to be included in the transaction. What will happen
    // is that the user will send ETH to the parent messenger, which will include it as msg.value in a transaction
    // to the inbox.
    const amountOfCrossChainTransactions = 2;
    const requiredEthForOneTransaction = toBN(requiredL1CallValue.toString());
    const requiredEth = requiredEthForOneTransaction.mul(toBN(amountOfCrossChainTransactions));
    const userEthBalance = await web3.eth.getBalance(deployer);
    console.log(
      `\n${amountOfCrossChainTransactions} cross chain transactions each require ${requiredEthForOneTransaction.toString()} ETH (gasLimit * gasPrice + submissionCost)`
    );
    assert(
      toBN(userEthBalance).gt(requiredEth),
      "User has insufficient ETH balance to pay for cross chain transactions"
    );

    // Submit parent messenger cross-chain transactions:
    // First, send ETH to the parent messenger to cover both transactions.
    let messengerBalance = await web3.eth.getBalance(messenger.options.address);
    if (toBN(messengerBalance.toString()).lt(requiredEthForOneTransaction)) {
      console.log(`Sending ${requiredEthForOneTransaction.toString()} ETH to the messenger`);
      const sendEthTxn = await web3.eth.sendTransaction({
        to: messenger.options.address,
        from: deployer,
        value: requiredEthForOneTransaction.toString(),
      });
      console.log(`...txn: ${sendEthTxn.transactionHash}`);
    }
    console.log(`Setting child oracle spoke address to ${OracleSpoke.address}...`);
    const setChildOracleSpokeTxn = await messenger.methods
      .setChildOracleSpoke(OracleSpoke.address)
      .send({ from: deployer });
    console.log(`...txn: ${setChildOracleSpokeTxn.transactionHash}`);
    messengerBalance = await web3.eth.getBalance(messenger.options.address);
    if (toBN(messengerBalance.toString()).lt(requiredEthForOneTransaction)) {
      console.log(`Sending ${requiredEthForOneTransaction.toString()} ETH to the messenger`);
      const sendEthTxn = await web3.eth.sendTransaction({
        to: messenger.options.address,
        from: deployer,
        value: requiredEthForOneTransaction.toString(),
      });
      console.log(`...txn: ${sendEthTxn.transactionHash}`);
    }
    console.log(`Setting child parent messenger to ${messenger.options.address}...`);
    const setChildParentMessengerTxn = await messenger.methods
      .setChildParentMessenger(messenger.options.address)
      .send({ from: deployer });
    console.log(`...txn: ${setChildParentMessengerTxn.transactionHash}`);

    // Submit oracle hub transactions:
    await setupHub(oracleHub, deployer, messenger.options.address, 42161);

    // Submit governor hub transactions:
    await setupHub(governorHub, deployer, messenger.options.address, 42161);
  }
);

task("setup-l1-boba-xchain", "Configures L1 cross chain smart contracts for Boba bridge").setAction(async function (
  _,
  hre_
) {
  await setupOvmBasedL1Chain(hre_, 288);
});

task("setup-l1-optimism-xchain", "Configures L1 cross chain smart contracts for Optimism bridge").setAction(
  async function (_, hre_) {
    await setupOvmBasedL1Chain(hre_, 10);
  }
);

task("setup-l2-xchain", "Configures L2 cross chain smart contracts").setAction(async function (_, hre_) {
  const hre = hre_ as CombinedHRE;
  const { deployments, getNamedAccounts, web3, getChainId } = hre;
  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");
  const finder = new web3.eth.Contract(Finder.abi, Finder.address);
  const chainId = Number(await getChainId());
  const chainName = getChainNameForId(chainId);
  const ChildMessenger = await deployments.get(`${chainName}_ChildMessenger`);
  const Registry = await deployments.get("Registry");

  console.log(`Found Finder @ ${finder.options.address}`);

  await setupChildMessenger(finder, deployer, ChildMessenger, Registry);
});

task("verify-xchain", "Checks ownership state of cross chain smart contracts")
  .addParam("l2", "Chain name of the child messenger to check")
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, web3, companionNetworks } = hre;
    const { l2 } = taskArguments;

    assert(L2_CHAIN_NAMES.includes(l2), "Unsupported L2 chain name");
    const l2ChainId = getChainIdForName(l2);
    const l2ChainName = getChainNameForId(l2ChainId);
    assert(process.env[`NODE_URL_${l2ChainId}`], `Must set NODE_URL_${l2ChainId} in the environment`);
    const l1Web3 = web3;
    const l2Web3 = new Web3(process.env[`NODE_URL_${l2ChainId}`] as string);
    const companionNetworkGet = (contractName: string) =>
      companionNetworks[l2ChainName.toLowerCase()].deployments.get(contractName);

    const [
      governorHub,
      oracleHub,
      governor,
      parentMessenger,
      childMessenger,
      oracleSpoke,
      governorSpoke,
      l1Registry,
      l2Registry,
      l2Store,
      l2IdentifierWhitelist,
      l2AddressWhitelist,
      l2OptimisticOracle,
      l2Finder,
    ] = await Promise.all([
      deployments.get("GovernorHub"),
      deployments.get("OracleHub"),
      deployments.get("Governor"),
      deployments.get(`${l2ChainName}_ParentMessenger`),
      companionNetworkGet(`${l2ChainName}_ChildMessenger`),
      companionNetworkGet(`OracleSpoke`),
      companionNetworkGet(`GovernorSpoke`),
      deployments.get("Registry"),
      companionNetworkGet(`Registry`),
      companionNetworkGet(`Store`),
      companionNetworkGet(`IdentifierWhitelist`),
      companionNetworkGet(`AddressWhitelist`),
      companionNetworkGet(`OptimisticOracle`),
      companionNetworkGet(`Finder`),
    ]);

    /** ***********************************
     * Begin: Checking L1 State
     *************************************/
    console.group("\n🌕 Verifying L1 contract state 🌕");

    console.group("GovernorHub");
    const governorHubContract = new l1Web3.eth.Contract(governorHub.abi, governorHub.address);
    const [governorHubOwner, governorHubMessenger] = await Promise.all([
      governorHubContract.methods.owner().call(),
      governorHubContract.methods.messengers(l2ChainId).call(),
    ]);
    console.log(`- Owner set to Governor: ${governorHubOwner === governor.address ? "✅" : "❌"}`);
    console.log(
      `- Messenger for chain ID ${l2ChainId} set to ParentMessenger: ${
        governorHubMessenger === parentMessenger.address ? "✅" : "❌"
      }`
    );
    console.groupEnd();

    console.group("OracleHub");
    const oracleHubContract = new l1Web3.eth.Contract(oracleHub.abi, oracleHub.address);
    const [oracleHubOwner, oracleHubMessenger] = await Promise.all([
      oracleHubContract.methods.owner().call(),
      oracleHubContract.methods.messengers(l2ChainId).call(),
    ]);
    console.log(`- Owner set to Governor: ${oracleHubOwner === governor.address ? "✅" : "❌"}`);
    console.log(
      `- Messenger for chain ID ${l2ChainId} set to ParentMessenger: ${
        oracleHubMessenger === parentMessenger.address ? "✅" : "❌"
      }`
    );
    console.groupEnd();

    console.group(`${l2ChainName}_ParentMessenger`);
    const parentMessengerContract = new l1Web3.eth.Contract(parentMessenger.abi, parentMessenger.address);
    const [
      parentMessengerOwner,
      parentMessengerChildChainId,
      parentMessengerChildMessenger,
      parentMessengerOracleHub,
      parentMessengerGovernorHub,
      parentMessengerOracleSpoke,
      parentMessengerGovernorSpoke,
    ] = await Promise.all([
      parentMessengerContract.methods.owner().call(),
      parentMessengerContract.methods.childChainId().call(),
      parentMessengerContract.methods.childMessenger().call(),
      parentMessengerContract.methods.oracleHub().call(),
      parentMessengerContract.methods.governorHub().call(),
      parentMessengerContract.methods.oracleSpoke().call(),
      parentMessengerContract.methods.governorSpoke().call(),
    ]);
    console.log(`- Owner set to Governor: ${parentMessengerOwner === governor.address ? "✅" : "❌"}`);
    console.log(
      `- Child chain ID set to ${l2ChainId}: ${Number(parentMessengerChildChainId) === l2ChainId ? "✅" : "❌"}`
    );
    console.log(
      `- Set childMessenger address: ${parentMessengerChildMessenger === childMessenger.address ? "✅" : "❌"}`
    );
    console.log(`- Set oracleHub address: ${parentMessengerOracleHub === oracleHub.address ? "✅" : "❌"}`);
    console.log(`- Set governorHub address: ${parentMessengerGovernorHub === governorHub.address ? "✅" : "❌"}`);
    console.log(`- Set oracleSpoke address: ${parentMessengerOracleSpoke === oracleSpoke.address ? "✅" : "❌"}`);
    console.log(`- Set governorSpoke address: ${parentMessengerGovernorSpoke === governorSpoke.address ? "✅" : "❌"}`);
    console.groupEnd();

    console.group("Registry");
    const l1RegistryContract = new l1Web3.eth.Contract(l1Registry.abi, l1Registry.address);
    const [oracleHubRegistered] = await Promise.all([
      l1RegistryContract.methods.isContractRegistered(oracleHub.address).call(),
    ]);
    console.log(`- OracleHub registered: ${oracleHubRegistered ? "✅" : "❌"}`);
    console.groupEnd();

    console.groupEnd();
    /** ***********************************
     * End: Checking L1 State
     *************************************/

    /** ***********************************
     * Begin: Checking L2 State
     *************************************/
    console.group("\n🌚 Verifying L2 contract state 🌚");

    console.group("Registry");
    const l2RegistryContract = new l2Web3.eth.Contract(l2Registry.abi, l2Registry.address);
    const [optimisticOracleRegistered, l2RegistryOwner] = await Promise.all([
      l2RegistryContract.methods.isContractRegistered(l2OptimisticOracle.address).call(),
      l2RegistryContract.methods.getMember(0).call(),
    ]);
    console.log(`- OptimisticOracle registered: ${optimisticOracleRegistered ? "✅" : "❌"}`);
    console.log(`- Owned by GovernorSpoke: ${l2RegistryOwner === governorSpoke.address ? "✅" : "❌"}`);
    console.groupEnd();

    console.group("Store");
    const l2StoreContract = new l2Web3.eth.Contract(l2Store.abi, l2Store.address);
    const [l2StoreOwner] = await Promise.all([l2StoreContract.methods.getMember(0).call()]);
    console.log(`- Owned by GovernorSpoke: ${l2StoreOwner === governorSpoke.address ? "✅" : "❌"}`);
    console.groupEnd();

    console.group("IdentifierWhitelist");
    const l2IdentifierWhitelistContract = new l2Web3.eth.Contract(
      l2IdentifierWhitelist.abi,
      l2IdentifierWhitelist.address
    );
    const [l2IdentifierWhitelistOwner] = await Promise.all([l2IdentifierWhitelistContract.methods.owner().call()]);
    console.log(`- Owned by GovernorSpoke: ${l2IdentifierWhitelistOwner === governorSpoke.address ? "✅" : "❌"}`);
    console.groupEnd();

    console.group("AddressWhitelist");
    const l2AddressWhitelistContract = new l2Web3.eth.Contract(l2AddressWhitelist.abi, l2AddressWhitelist.address);
    const [l2AddressWhitelistOwner] = await Promise.all([l2AddressWhitelistContract.methods.owner().call()]);
    console.log(`- Owned by GovernorSpoke: ${l2AddressWhitelistOwner === governorSpoke.address ? "✅" : "❌"}`);
    console.groupEnd();

    console.group(`${l2ChainName}_ChildMessenger`);
    const childMessengerContract = new l2Web3.eth.Contract(childMessenger.abi, childMessenger.address);
    const [childMessengerOracleSpoke, childMessengerParentMessenger] = await Promise.all([
      childMessengerContract.methods.oracleSpoke().call(),
      childMessengerContract.methods.parentMessenger().call(),
    ]);
    console.log(`- Set oracleSpoke: ${childMessengerOracleSpoke === oracleSpoke.address ? "✅" : "❌"}`);
    console.log(`- Set parentMessenger: ${childMessengerParentMessenger === parentMessenger.address ? "✅" : "❌"}`);
    console.groupEnd();

    console.group("Finder");
    const l2FinderContract = new l2Web3.eth.Contract(l2Finder.abi, l2Finder.address);
    const [
      l2FinderOwner,
      l2FinderStore,
      l2FinderIdentifierWhitelist,
      l2FinderAddressWhitelist,
      l2FinderOracle,
      l2FinderOptimisticOracle,
      l2FinderChildMessenger,
    ] = await Promise.all([
      l2FinderContract.methods.owner().call(),
      l2FinderContract.methods.interfacesImplemented(utf8ToHex(interfaceName.Store)).call(),
      l2FinderContract.methods.interfacesImplemented(utf8ToHex(interfaceName.IdentifierWhitelist)).call(),
      l2FinderContract.methods.interfacesImplemented(utf8ToHex(interfaceName.CollateralWhitelist)).call(),
      l2FinderContract.methods.interfacesImplemented(utf8ToHex(interfaceName.Oracle)).call(),
      l2FinderContract.methods.interfacesImplemented(utf8ToHex(interfaceName.OptimisticOracle)).call(),
      l2FinderContract.methods.interfacesImplemented(utf8ToHex(interfaceName.ChildMessenger)).call(),
    ]);
    console.log(`- Owned by GovernorSpoke: ${l2FinderOwner === governorSpoke.address ? "✅" : "❌"}`);
    console.log(`- Set "${interfaceName.Store}" in Finder: ${l2FinderStore === l2Store.address ? "✅" : "❌"}`);
    console.log(
      `- Set "${interfaceName.IdentifierWhitelist}": ${
        l2FinderIdentifierWhitelist === l2IdentifierWhitelist.address ? "✅" : "❌"
      }`
    );
    console.log(
      `- Set "${interfaceName.CollateralWhitelist}" in Finder: ${
        l2FinderAddressWhitelist === l2AddressWhitelist.address ? "✅" : "❌"
      }`
    );
    console.log(
      `- Set "${interfaceName.Oracle}" in Finder (to OracleSpoke): ${
        l2FinderOracle === oracleSpoke.address ? "✅" : "❌"
      }`
    );
    console.log(
      `- Set "${interfaceName.OptimisticOracle}" in Finder: ${
        l2FinderOptimisticOracle === l2OptimisticOracle.address ? "✅" : "❌"
      }`
    );
    console.log(
      `- Set "${interfaceName.ChildMessenger}" in Finder: ${
        l2FinderChildMessenger === childMessenger.address ? "✅" : "❌"
      }`
    );
    console.groupEnd();

    console.groupEnd();
    /** ***********************************
     * End: Checking L2 State
     *************************************/
  });
