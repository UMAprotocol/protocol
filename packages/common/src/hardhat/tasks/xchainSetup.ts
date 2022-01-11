import { Deployment } from "hardhat-deploy/types";
import { task } from "hardhat/config";
import { Contract } from "web3-eth-contract";
import { CombinedHRE } from "./types";
import { PublicNetworks } from "../../index";
import Web3 from "web3";
const { utf8ToHex, toBN } = Web3.utils;
const assert = require("assert");

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
  const chainName = PublicNetworks[chainId].name[0].toUpperCase() + PublicNetworks[chainId].name.substring(1);
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
  const chainId = await getChainId();
  let ChildMessenger;
  switch (chainId) {
    case "42161":
      ChildMessenger = await deployments.get("Arbitrum_ChildMessenger");
      break;
    case "288":
      ChildMessenger = await deployments.get("Boba_ChildMessenger");
      break;
    case "10":
      ChildMessenger = await deployments.get("Optimism_ChildMessenger");
      break;
    default:
      throw new Error("Unimplemented L2");
  }
  const Registry = await deployments.get("Registry");

  console.log(`Found Finder @ ${finder.options.address}`);

  await setupChildMessenger(finder, deployer, ChildMessenger, Registry);
});
