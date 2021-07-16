const { task, types } = require("hardhat/config");
require("dotenv").config();
const assert = require("assert");
const Web3 = require("web3");

const _whitelistIdentifier = async (web3, identifierUtf8, identifierWhitelist, deployer) => {
  const { padRight, utf8ToHex } = web3.utils;
  const identifierBytes = padRight(utf8ToHex(identifierUtf8), 64);
  if (!(await identifierWhitelist.methods.isIdentifierSupported(identifierBytes).call())) {
    const txn = await identifierWhitelist.methods.addSupportedIdentifier(identifierBytes).send({ from: deployer });
    console.log(`Whitelisted new identifier: ${identifierUtf8}, tx: ${txn.transactionHash}`);
  } else {
    console.log(`${identifierUtf8} is already approved.`);
  }
};

task("whitelist-identifiers", "Whitelist identifiers from JSON file")
  .addParam("id", "Custom identifier to whitelist", "Test Identifier", types.string)
  .setAction(async function (taskArguments, hre) {
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { id } = taskArguments;

    const IdentifierWhitelist = await deployments.get("IdentifierWhitelist");
    const identifierWhitelist = new web3.eth.Contract(IdentifierWhitelist.abi, IdentifierWhitelist.address);
    console.log(`Using IdentifierWhitelist @ ${identifierWhitelist.options.address}`);

    await _whitelistIdentifier(web3, id, identifierWhitelist, deployer);
  });

task("migrate-identifiers", "Adds all whitelisted identifiers on one IdentifierWhitelist to another")
  .addParam("from", "The contract from which to query a whitelist of identifiers.", "", types.string)
  .addOptionalParam("to", "The contract on which to whitelist new identifiers.", "", types.string)
  .addOptionalParam(
    "crosschain",
    "If true, grab identifier whitelist (deployed at 'from' address) events from CROSS_CHAIN_NODE_URL",
    false,
    types.boolean
  )
  .setAction(async function (taskArguments, hre) {
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { from, to, crosschain } = taskArguments;

    const IdentifierWhitelist = await deployments.get("IdentifierWhitelist");

    let oldWeb3;
    if (crosschain) {
      // Create new web3 provider using crosschain network.
      assert(
        process.env.CROSS_CHAIN_NODE_URL,
        "If --crosschain flag is set to true, must set a CROSS_CHAIN_NODE_URL in the environment"
      );
      oldWeb3 = new Web3(process.env.CROSS_CHAIN_NODE_URL);
    } else {
      // `--crosschain` flag not set, assume that old and new identifier whitelists are on the current network.
      oldWeb3 = web3;
    }
    const oldWhitelist = new oldWeb3.eth.Contract(IdentifierWhitelist.abi, from);
    const addedIdentifierEvents = await oldWhitelist.getPastEvents("SupportedIdentifierAdded", { fromBlock: 0 });

    // Filter out identifiers that are not currently whitelisted.
    const isIdentifierSupported = await Promise.all(
      addedIdentifierEvents.map((_event) =>
        oldWhitelist.methods.isIdentifierSupported(_event.returnValues.identifier).call()
      )
    );
    const identifiersToWhitelist = isIdentifierSupported
      .map((isOnWhitelist, i) => {
        if (isOnWhitelist) return addedIdentifierEvents[i].returnValues.identifier;
        return null;
      })
      .filter((id) => id);

    // Create table with results to display to user:
    let resultsTable = identifiersToWhitelist.map((id) => {
      return { identifierToWhitelist: id, utf8: web3.utils.hexToUtf8(id) };
    });

    if (to) {
      const newWhitelist = new web3.eth.Contract(IdentifierWhitelist.abi, to);
      const isIdentifierSupportedOnNewWhitelist = await Promise.all(
        identifiersToWhitelist.map((id) => newWhitelist.methods.isIdentifierSupported(id).call())
      );

      // Send transactions sequentially to avoid nonce collisions. Note that this might fail due to timeout if there
      // are a lot of transactions to send or the gas price to send with is too low.
      for (let i = 0; i < isIdentifierSupportedOnNewWhitelist.length; i++) {
        if (!isIdentifierSupportedOnNewWhitelist[i]) {
          const receipt = await newWhitelist.methods
            .addSupportedIdentifier(identifiersToWhitelist[i])
            .send({ from: deployer });
          console.log(
            `${i}: Added new identifier ${web3.utils.hexToUtf8(identifiersToWhitelist[i])} (${receipt.transactionHash})`
          );
          resultsTable[i] = { ...resultsTable[i], txn: receipt.transactionHash };
        } else {
          // Explicitly push message so that `txn` and `identifier` line up in table to print to console.
          resultsTable[i] = { ...resultsTable[i], txn: "Already whitelisted" };
        }
      }
    }

    console.group("Identifiers to Whitelist");
    console.table(resultsTable);
    console.groupEnd();
  });
