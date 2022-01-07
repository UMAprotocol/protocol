const { ZERO_ADDRESS } = require("@uma/common");
const { getAbi, getAddress } = require("@uma/contracts-node");

const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

async function fetchFullL1Whitelist(l1Web3, l1ChainId) {
  const l1TokenWhitelist = new l1Web3.eth.Contract(
    getAbi("AddressWhitelist"),
    await getAddress("AddressWhitelist", l1ChainId)
  );

  const l1AddedToWhitelistTokens = (
    await l1TokenWhitelist.getPastEvents("AddedToWhitelist", { fromBlock: 0, toBlock: "latest" })
  ).map((event) => event.returnValues.addedAddress);

  const l1RemovedFromWhitelistTokens = (
    await l1TokenWhitelist.getPastEvents("RemovedFromWhitelist", { fromBlock: 0, toBlock: "latest" })
  ).map((event) => event.returnValues.removedAddress);

  const whitelistedAddressArray = l1AddedToWhitelistTokens.filter((address) => {
    return !l1RemovedFromWhitelistTokens.includes(address);
  });

  const l1Store = new l1Web3.eth.Contract(getAbi("Store"), await getAddress("Store", l1ChainId));

  const finalFeesArray = await Promise.all(
    whitelistedAddressArray.map((address) => l1Store.methods.finalFees(address).call())
  );

  const symbols = (
    await Promise.allSettled(
      whitelistedAddressArray.map((address) =>
        new l1Web3.eth.Contract(getAbi("ERC20"), address).methods.symbol().call()
      )
    )
  ).map((result) => {
    return result.status === "fulfilled" ? result.value : "NO-SYMBOL";
  });

  return whitelistedAddressArray.map((l1TokenAddress, index) => {
    return { l1TokenAddress, finalFee: finalFeesArray[index], symbol: symbols[index] };
  });
}

async function findL2TokenForL1Token(l2Web3, l2ChainId, l1TokenAddress) {
  if (l2ChainId == 10) {
    const foundOnChain = await _findL2TokenForOvmChain(l2Web3, l1TokenAddress);
    if (foundOnChain != ZERO_ADDRESS) return foundOnChain;
    else return await _findL2TokenFromTokenList(l2ChainId, l1TokenAddress);
  }
  if (l2ChainId == 288) {
    return await _findL2TokenForOvmChain(l2Web3, l1TokenAddress);
  }

  if (l2ChainId == 42161) {
    return await _findL2TokenFromTokenList(l2ChainId, l1TokenAddress);
  }
}

async function _findL2TokenFromTokenList(l2ChainId, l1TokenAddress) {
  if (l2ChainId == 10) {
    const response = await fetch("https://static.optimism.io/optimism.tokenlist.json");
    const body = await response.text();
    const tokenList = JSON.parse(body).tokens;
    const searchSymbol = tokenList.find((element) => element.chainId == 1 && element.address == l1TokenAddress)?.symbol;
    if (!searchSymbol) return ZERO_ADDRESS;
    return tokenList.find((element) => element.chainId == 10 && element.symbol == searchSymbol).address;
  }
  if (l2ChainId == 42161) {
    const response = await fetch("https://bridge.arbitrum.io/token-list-42161.json");
    const body = await response.text();
    const tokenList = JSON.parse(body).tokens;
    const l2Address = tokenList.find((element) => element.extensions.l1Address == l1TokenAddress.toLowerCase())
      ?.address;
    return l2Address ?? ZERO_ADDRESS;
  }
  return ZERO_ADDRESS;
}

async function _findL2TokenForOvmChain(l2Web3, l1TokenAddress) {
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
  const l2Bridge = new l2Web3.eth.Contract(L2StandardBridgeAbi, optimismL2StandardERC20);

  const depositFinalizedEvents = await l2Bridge.getPastEvents("DepositFinalized", {
    filter: { _l1Token: l1TokenAddress },
    fromBlock: 0,
    toBlock: "latest",
  });

  if (depositFinalizedEvents.length === 0) return ZERO_ADDRESS;
  return depositFinalizedEvents[0].returnValues._l2Token;
}

module.exports = { fetchFullL1Whitelist, findL2TokenForL1Token };
