import { Web3Contract } from "./../../ContractUtils";
import { task, types } from "hardhat/config";
import assert from "assert";
import Web3 from "web3";
import dotenv from "dotenv";
import { getEventsWithPaginatedBlockSearch, ZERO_ADDRESS } from "../../index";
import fetch from "node-fetch";

import type { CombinedHRE } from "./types";

dotenv.config();

task("migrate-collateral-whitelist", "Migrate collateral whitelist, extracted from one EVM chain to another")
  .addParam("l1chainid", "Chain Id of the origin chain (normally 1 for L1 ethereum)", "1", types.string)
  .addParam("l2chainid", "Chain Id of the destination chain to write the new whitelist to", "", types.string)
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, getNamedAccounts, web3, companionNetworks } = hre;

    assert(
      process.env[`NODE_URL_${taskArguments.l1chainid}`],
      `Must set NODE_URL_${taskArguments.l1chainid} in the environment`
    );
    assert(
      process.env[`NODE_URL_${taskArguments.l2chainid}`],
      `Must set NODE_URL_${taskArguments.l2chainid} in the environment`
    );

    const l1ChainId = Number(taskArguments.l1chainid);
    const l2ChainId = Number(taskArguments.l2chainid);

    const l1Web3 = new Web3(process.env[`NODE_URL_${l1ChainId}`] as string);
    assert((await web3.eth.getChainId()) == l2ChainId, "Provided network must match to l2ChainId");
    const l2Web3 = web3;
    const { deployer } = await getNamedAccounts();

    console.log(`Running Batch Collateral whitelister from ${l1ChainId}->${l2ChainId} on account ${deployer}`);

    console.log("Finding L1 whitelist...");
    const l1TokenWhitelistArray = await fetchFullL1Whitelist(l1Web3, companionNetworks);
    console.log("found a total of " + l1TokenWhitelistArray.length + " L1 tokens on the whitelist");

    console.log("Finding associated L2 tokens for whitelisted l1 tokens...");
    const associatedL2Tokens = await Promise.all(
      l1TokenWhitelistArray.map((l1TokenWhitelist: any) =>
        findL2TokenForL1Token(l2Web3, l2ChainId, l1TokenWhitelist.l1TokenAddress)
      )
    );

    // Remove any tokens that are not found on L2.
    const combineSet = l1TokenWhitelistArray
      .map((l1TokenWhitelist: any, index: any) => {
        return { ...l1TokenWhitelist, l2TokenAddress: associatedL2Tokens[index] };
      })
      .filter((tokenList: any) => tokenList.l2TokenAddress !== ZERO_ADDRESS);

    console.log(`Found the following ${combineSet.length} L1->L2 mapping and the associated final fees`);
    console.table(combineSet);

    console.log("Removing any tokens that are already on the L2 whitelist...");
    const l2TokenWhitelistContract = await deployments.get("AddressWhitelist");
    const l2TokenWhitelist = new l2Web3.eth.Contract(l2TokenWhitelistContract.abi, l2TokenWhitelistContract.address);
    const currentBlock = await l2Web3.eth.getBlockNumber();
    const blockLookBack = 99999; // We need to use paginated query on L2 as some L2s limit how far you can look back
    // such as arbitrum which has a 100k block lookback restriction.

    const eventResults = await Promise.all([
      getEventsWithPaginatedBlockSearch(
        l2TokenWhitelist as Web3Contract,
        "AddedToWhitelist",
        0,
        currentBlock,
        blockLookBack
      ),
      getEventsWithPaginatedBlockSearch(
        l2TokenWhitelist as Web3Contract,
        "RemovedFromWhitelist",
        0,
        currentBlock,
        blockLookBack
      ),
    ]);

    const l2AddedToWhitelistTokens = eventResults[0].eventData.map((event) => event.returnValues.addedAddress);
    const l2RemovedFromWhitelistTokens = eventResults[1].eventData.map((event) => event.returnValues.removedAddress);

    const l2WhitelistedAddressArray = l2AddedToWhitelistTokens.filter((address) => {
      return !l2RemovedFromWhitelistTokens.includes(address);
    });

    const filteredCombinedSet = combineSet.filter((element: any) => {
      return !l2WhitelistedAddressArray.includes(element.l2TokenAddress);
    });

    console.log(
      `Adding ${filteredCombinedSet.length} tokens the the L2 token whitelist on ${l2TokenWhitelist.options.address}...`
    );
    console.table(filteredCombinedSet);
    const l2StoreContract = await deployments.get("AddressWhitelist");
    const l2Store = new l2Web3.eth.Contract(l2StoreContract.abi, l2StoreContract.address);

    let nonce = await l2Web3.eth.getTransactionCount(deployer);
    for (let index = 0; index < filteredCombinedSet.length; index++) {
      console.log(
        `Whitelisting ${filteredCombinedSet[index].symbol} at ${filteredCombinedSet[index].l1TokenAddress} with fee ${filteredCombinedSet[index].finalFee}...`
      );
      const whitelistTx = await l2TokenWhitelist.methods
        .addToWhitelist(filteredCombinedSet[index].l2TokenAddress)
        .send({ from: deployer, nonce });
      nonce++;
      const finalFeeTx = await l2Store.methods
        .setFinalFee(filteredCombinedSet[index].l2TokenAddress, { rawValue: filteredCombinedSet[index].finalFee })
        .send({ from: deployer, nonce });
      nonce++;
      console.log(`addToWhitelist tx: ${whitelistTx.transactionHash}, setFinalFee: ${finalFeeTx.transactionHash}`);
    }
    console.log("DONE!");
  });

async function fetchFullL1Whitelist(l1Web3: Web3, companionNetworks: any) {
  const l1TokenWhitelistContract = await companionNetworks.mainnet.deployments.get("AddressWhitelist");
  console.log("l1TokenWhitelistContract", l1TokenWhitelistContract.address);
  const l1TokenWhitelist = new l1Web3.eth.Contract(l1TokenWhitelistContract.abi, l1TokenWhitelistContract.address);

  const [l1whitelistEvents, removeL1WhitelistEvents] = await Promise.all([
    l1TokenWhitelist.getPastEvents("AddedToWhitelist", { fromBlock: 0, toBlock: "latest" }),
    l1TokenWhitelist.getPastEvents("RemovedFromWhitelist", { fromBlock: 0, toBlock: "latest" }),
  ]);

  const l1AddedToWhitelistTokens = l1whitelistEvents.map((event) => event.returnValues.addedAddress);
  const l1RemovedFromWhitelistTokens = removeL1WhitelistEvents.map((event) => event.returnValues.removedAddress);

  const whitelistedAddressArray = l1AddedToWhitelistTokens.filter((address) => {
    return !l1RemovedFromWhitelistTokens.includes(address);
  });

  const l1StoreContract = await companionNetworks.mainnet.deployments.get("Store");
  const l1Store = new l1Web3.eth.Contract(l1StoreContract.abi, l1StoreContract.address);

  const finalFeesArray = await Promise.all(
    whitelistedAddressArray.map((address) => l1Store.methods.finalFees(address).call())
  );

  const tokenAbi = [
    {
      inputs: [],
      name: "symbol",
      outputs: [
        {
          internalType: "string",
          name: "",
          type: "string",
        },
      ],
      stateMutability: "view",
      type: "function",
    },
  ];

  const symbols = (
    await Promise.allSettled(
      whitelistedAddressArray.map((address) =>
        new l1Web3.eth.Contract(tokenAbi as any, address).methods.symbol().call()
      )
    )
  ).map((result) => {
    return result.status === "fulfilled" ? result.value : "NO-SYMBOL";
  });

  return whitelistedAddressArray.map((l1TokenAddress, index) => {
    return { l1TokenAddress, finalFee: finalFeesArray[index], symbol: symbols[index] };
  });
}

async function findL2TokenForL1Token(l2Web3: Web3, l2chainid: number, l1TokenAddress: string) {
  if (l2chainid == 10) {
    const foundOnChain = await _findL2TokenForOvmChain(l2Web3, l1TokenAddress);
    if (foundOnChain != ZERO_ADDRESS) return foundOnChain;
    else return await _findL2TokenFromTokenList(l2chainid, l1TokenAddress);
  }
  if (l2chainid == 288) {
    return await _findL2TokenForOvmChain(l2Web3, l1TokenAddress);
  }

  if (l2chainid == 42161) {
    return await _findL2TokenFromTokenList(l2chainid, l1TokenAddress);
  }
}

async function _findL2TokenFromTokenList(l2chainid: number, l1TokenAddress: string) {
  if (l2chainid == 10) {
    const response = await fetch("https://static.optimism.io/optimism.tokenlist.json");
    const body = await response.text();
    const tokenList = JSON.parse(body).tokens;
    const searchSymbol = tokenList.find((element: any) => element.chainId == 1 && element.address == l1TokenAddress)
      ?.symbol;
    if (!searchSymbol) return ZERO_ADDRESS;
    return tokenList.find((element: any) => element.chainId == 10 && element.symbol == searchSymbol).address;
  }
  if (l2chainid == 42161) {
    const response = await fetch("https://bridge.arbitrum.io/token-list-42161.json");
    const body = await response.text();
    const tokenList = JSON.parse(body).tokens;
    const l2Address = tokenList.find((element: any) => element.extensions.l1Address == l1TokenAddress.toLowerCase())
      ?.address;
    return l2Address ?? ZERO_ADDRESS;
  }
  return ZERO_ADDRESS;
}

async function _findL2TokenForOvmChain(l2Web3: Web3, l1TokenAddress: string) {
  const optimismL2StandardERC20 = "0x4200000000000000000000000000000000000010";
  const L2StandardBridgeAbi = [
    {
      anonymous: false,
      inputs: [
        { indexed: true, internalType: "address", name: "_l1Token", type: "address" },
        { indexed: true, internalType: "address", name: "_l2Token", type: "address" },
        { indexed: true, internalType: "address", name: "_from", type: "address" },
        { indexed: false, internalType: "address", name: "_to", type: "address" },
        { indexed: false, internalType: "uint256", name: "_amount", type: "uint256" },
        { indexed: false, internalType: "bytes", name: "_data", type: "bytes" },
      ],
      name: "DepositFinalized",
      type: "event",
    },
  ];
  const l2Bridge = new l2Web3.eth.Contract(L2StandardBridgeAbi as any, optimismL2StandardERC20);

  const depositFinalizedEvents = await l2Bridge.getPastEvents("DepositFinalized", {
    filter: { _l1Token: l1TokenAddress },
    fromBlock: 0,
    toBlock: "latest",
  });

  if (depositFinalizedEvents.length === 0) return ZERO_ADDRESS;
  return depositFinalizedEvents[0].returnValues._l2Token;
}
