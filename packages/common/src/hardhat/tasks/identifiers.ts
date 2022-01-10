import { task, types } from "hardhat/config";
import assert from "assert";
import Web3 from "web3";
import dotenv from "dotenv";
import type { Contract } from "web3-eth-contract";
import type { TransactionReceipt } from "web3-core";
import type { CombinedHRE } from "./types";
import { getMulticallAddress } from "../../Constants";
dotenv.config();

const _whitelistIdentifier = async (
  web3: Web3,
  identifierUtf8: string,
  identifierWhitelist: Contract,
  deployer: string
) => {
  const { padRight, utf8ToHex } = web3.utils;
  const identifierBytes = padRight(utf8ToHex(identifierUtf8), 64);
  if (!(await identifierWhitelist.methods.isIdentifierSupported(identifierBytes).call())) {
    const txn = await identifierWhitelist.methods.addSupportedIdentifier(identifierBytes).send({ from: deployer });
    console.log(`Whitelisted new identifier: ${identifierUtf8}, tx: ${txn.transactionHash}`);
  } else {
    console.log(`${identifierUtf8} is already approved.`);
  }
};

function isString(input: string | null): input is string {
  return typeof input === "string";
}

async function checkIfIdentifiersAreSupported(
  identifiersToCheck: string[],
  web3: Web3,
  whitelistToCheck: Contract,
  hre: CombinedHRE
): Promise<boolean[]> {
  const networkId = await web3.eth.getChainId();
  console.log(
    `Checking whitelist status of ${identifiersToCheck.length} identifiers on the whitelist @ ${whitelistToCheck.options.address} on network ID ${networkId} `
  );
  try {
    const multicallAddress = getMulticallAddress(networkId);
    console.log(`Using multicall contract @ ${multicallAddress} to reduce web3 requests`);
    const Multicall2 = hre.getContract("Multicall2");
    const multicall = new web3.eth.Contract(Multicall2.abi, multicallAddress);
    const calls = identifiersToCheck.map((id) => ({
      target: whitelistToCheck.options.address,
      callData: whitelistToCheck.methods.isIdentifierSupported(id).encodeABI(),
    }));
    const result = await multicall.methods.aggregate(calls).call();
    return result.returnData.map((_result: string) => {
      // Multicall contract returns results as bytes, so we need to check return value against bytes representation of
      // Boolean value.
      return _result === "0x0000000000000000000000000000000000000000000000000000000000000001";
    });
  } catch (err) {
    console.log(
      `No multicall contract found for network ${networkId}, submitting ${identifiersToCheck.length} web3 requests, sit tight`
    );
    return await Promise.all(identifiersToCheck.map((id) => whitelistToCheck.methods.isIdentifierSupported(id).call()));
  }
}

task("whitelist-identifiers", "Whitelist identifiers from JSON file")
  .addParam("id", "Custom identifier to whitelist", "Test Identifier", types.string)
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { id } = taskArguments;

    const IdentifierWhitelist = await deployments.get("IdentifierWhitelist");
    const identifierWhitelist = new web3.eth.Contract(IdentifierWhitelist.abi, IdentifierWhitelist.address);
    console.log(`Using IdentifierWhitelist @ ${identifierWhitelist.options.address}`);

    await _whitelistIdentifier(web3, id, identifierWhitelist, deployer);
  });

task(
  "migrate-identifiers",
  "Adds all whitelisted identifiers on one IdentifierWhitelist to another. Can be used to migrate identifiers on the same network or cross network."
)
  .addParam("from", "The contract from which to query a whitelist of identifiers.", "", types.string)
  .addOptionalParam("to", "The contract on which to whitelist new identifiers.", "", types.string)
  .addOptionalParam(
    "crosschain",
    "If true, grab identifier whitelist events from CROSS_CHAIN_NODE_URL",
    false,
    types.boolean
  )
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { from, to, crosschain } = taskArguments;

    const IdentifierWhitelist = await deployments.get("IdentifierWhitelist");

    // Log to user what the expected action will be:
    if (crosschain) {
      if (to) {
        console.log(`Migrating identifiers cross-network from ${from} to ${to}`);
      } else {
        console.log(`Migrating identifiers cross-network from ${from} to ${IdentifierWhitelist.address}`);
      }
    } else {
      if (to) {
        console.log(`Migrating identifiers on the local network from ${from} to ${to}`);
      } else {
        console.log(`Migrating identifiers on the local network from ${from} to ${IdentifierWhitelist.address}`);
      }
    }

    let oldWeb3: Web3;
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
    console.log(
      `Checking current whitelist status of ${addedIdentifierEvents.length} identifiers on source identifier whitelist`
    );
    const isIdentifierSupported = await checkIfIdentifiersAreSupported(
      addedIdentifierEvents.map((e) => e.returnValues.identifier),
      oldWeb3,
      oldWhitelist,
      hre
    );

    const identifiersToWhitelist = isIdentifierSupported
      .map((isOnWhitelist, i) => {
        // Cast to help typescript discern the type.
        if (isOnWhitelist) return addedIdentifierEvents[i].returnValues.identifier as string;
        return null;
      })
      .filter(isString);

    console.log(`Found ${identifiersToWhitelist.length} identifiers that are currently whitelisted on ${from}`);
    interface TableElement {
      identifierToWhitelist: string;
      utf8: string;
      txn?: string;
    }

    // Create table with results to display to user:
    const resultsTable: TableElement[] = identifiersToWhitelist.map((id) => {
      return { identifierToWhitelist: id, utf8: web3.utils.hexToUtf8(id) };
    });

    // If `to` address is specified, use that address, otherwise grab address from deployments folder.
    const newWhitelistAddress = to ? to : IdentifierWhitelist.address;
    const newWhitelist = new web3.eth.Contract(IdentifierWhitelist.abi, newWhitelistAddress);
    const isIdentifierSupportedOnNewWhitelist = await checkIfIdentifiersAreSupported(
      identifiersToWhitelist,
      web3,
      newWhitelist,
      hre
    );

    console.log(
      `Found ${
        isIdentifierSupportedOnNewWhitelist.filter((isSupported) => !isSupported).length
      } identifiers to whitelist on ${newWhitelistAddress}`
    );

    // Send transactions sequentially to avoid nonce collisions. Note that this might fail due to timeout if there
    // are a lot of transactions to send or the gas price to send with is too low.
    let nonce = await web3.eth.getTransactionCount(deployer);
    for (let i = 0; i < isIdentifierSupportedOnNewWhitelist.length; i++) {
      if (!isIdentifierSupportedOnNewWhitelist[i]) {
        const receipt = (await newWhitelist.methods
          .addSupportedIdentifier(identifiersToWhitelist[i])
          .send({ from: deployer, nonce })) as TransactionReceipt;
        nonce++;
        console.log(
          `${i}: Added new identifier ${web3.utils.hexToUtf8(identifiersToWhitelist[i])} (${receipt.transactionHash})`
        );
        resultsTable[i] = { ...resultsTable[i], txn: receipt.transactionHash };
      } else {
        // Explicitly push message so that `txn` and `identifier` line up in table to print to console.
        resultsTable[i] = { ...resultsTable[i], txn: "Already whitelisted" };
      }
    }

    console.group("Identifiers to Whitelist");
    console.table(resultsTable);
    console.groupEnd();
  });
