import { useState, useEffect, useMemo } from "react";
import { drizzleReactHooks } from "drizzle-react";

export function useNumRegisteredContracts() {
  const { useCacheCall } = drizzleReactHooks.useDrizzle();
  const account = drizzleReactHooks.useDrizzleState(drizzleState => {
    return drizzleState.accounts[0];
  });

  const registeredContracts = useCacheCall("Registry", "getRegisteredDerivatives", account);

  if (account && registeredContracts) {
    return registeredContracts.length;
  }

  return undefined;
}

export function useEtherscanUrl() {
  const networkId = drizzleReactHooks.useDrizzleState(drizzleState => {
    return drizzleState.web3.networkId;
  });

  switch (networkId.toString()) {
    case "1":
      return "https://etherscan.io/";
    case "3":
      return "https://ropsten.etherscan.io/";
    case "42":
      return "https://kovan.etherscan.io/";
    default:
      // Default to mainnet, even though it won't work for ganache runs.
      return "https://etherscan.io/";
  }
}

export function useFaucetUrls() {
  const networkId = drizzleReactHooks.useDrizzleState(drizzleState => {
    return drizzleState.web3.networkId;
  });

  switch (networkId.toString()) {
    case "1":
      return {};
    case "3":
      return {
        eth: "https://faucet.metamask.io/",
        // TODO(mrice32): put a real DAI faucet link here.
        dai: "https://faucet.metamask.io/"
      };
    case "42":
      return {
        eth: "https://faucet.kovan.network/",
        // TODO(mrice32): put a real DAI faucet link here.
        dai: "https://faucet.kovan.network/"
      };
    default:
      return {};
  }
}

export function useTextInput() {
  const [amount, setAmount] = useState("");
  const handleChangeAmount = event => {
    // Regular expression that matches a decimal, e.g., `2.5`.
    if (event.target.value === "" || /^(\d+\.?\d*)$/.test(event.target.value)) {
      setAmount(event.target.value);
    }
  };
  return { amount, handleChangeAmount };
}

export function useSendTransactionOnLink(cacheSend, amounts, history) {
  const { drizzle } = drizzleReactHooks.useDrizzle();
  const { toWei } = drizzle.web3.utils;

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const { send, status } = cacheSend;
  const [linkedPage, setLinkedPage] = useState();
  const handleSubmit = event => {
    event.preventDefault();

    const linkedPage = event.currentTarget.getAttribute("href");
    setLinkedPage(linkedPage);
    send(...amounts.map(val => toWei(val)), { from: account });
  };
  // If we've successfully withdrawn, reroute to the linkedPage whose `Link` the user clicked on (currently, this can only
  // ever be the `ManagePositions` linkedPage).
  useEffect(() => {
    if (status === "success" && linkedPage) {
      history.replace(linkedPage);
    }
  }, [status, linkedPage, history]);
  return handleSubmit;
}

export function useCollateralizationInformation(tokenAddress, changeInShortBalance) {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const { toBN, toWei } = web3.utils;
  const data = {};
  data.derivativeStorage = useCacheCall(tokenAddress, "derivativeStorage");
  data.nav = useCacheCall(tokenAddress, "calcNAV");
  data.shortMarginBalance = useCacheCall(tokenAddress, "calcShortMarginBalance");

  if (!Object.values(data).every(Boolean)) {
    return { ready: false };
  }

  data.collateralizationRequirement = toBN(data.derivativeStorage.fixedParameters.supportedMove)
    .add(toBN(toWei("1")))
    .muln(100);

  data.currentCollateralization = "-- %";
  data.newCollateralizationAmount = "-- %";
  const navBn = toBN(data.nav);
  if (!navBn.isZero()) {
    data.totalHoldings = navBn.add(toBN(data.shortMarginBalance));
    data.currentCollateralization = data.totalHoldings.muln(100).div(navBn) + "%";
    if (changeInShortBalance !== "") {
      data.newCollateralizationAmount =
        data.totalHoldings
          .add(toBN(toWei(changeInShortBalance)))
          .muln(100)
          .div(navBn) + "%";
    }
  }
  data.ready = true;
  return data;
}

// TODO(mrice32): replace with some sort of global-ish config later.
export function useIdentifierConfig() {
  return useMemo(
    () => ({
      "BTC/USD": {
        supportedMove: "0.1",
        collateralRequirement: "110%",
        expiries: [1568649600, 1571241600]
      },
      "ETH/USD": {
        supportedMove: "0.1",
        collateralRequirement: "110%",
        expiries: [1568649600, 1571241600]
      },
      "CoinMarketCap Top100 Index": {
        supportedMove: "0.2",
        collateralRequirement: "120%",
        expiries: [1568649600, 1571241600]
      },
      "S&P500": {
        supportedMove: "0.1",
        collateralRequirement: "110%",
        expiries: [1568649600, 1571241600]
      }
    }),
    []
  );
}

export function useEnabledIdentifierConfig() {
  const {
    useCacheCallPromise,
    drizzle: { web3 }
  } = drizzleReactHooks.useDrizzle();
  const { useRerenderOnResolution } = drizzleReactHooks;

  const identifierConfig = useIdentifierConfig();

  // Note: using the promisified useCacheCall to prevent unrelated changes from triggering rerenders.
  const narrowedConfig = useCacheCallPromise(
    "NotApplicable",
    (callContract, resolvePromise, config) => {
      let finished = true;
      const call = (contractName, methodName, ...args) => {
        const result = callContract(contractName, methodName, ...args);
        if (result === undefined) {
          finished = false;
        }
        return result;
      };

      const narrowedConfig = {};
      for (const identifier in config) {
        if (
          call("Voting", "isIdentifierSupported", web3.utils.utf8ToHex(identifier)) &&
          call("ManualPriceFeed", "isIdentifierSupported", web3.utils.utf8ToHex(identifier))
        ) {
          narrowedConfig[identifier] = config[identifier];
        }
      }

      if (finished) {
        resolvePromise(narrowedConfig);
      }
    },
    identifierConfig
  );

  useRerenderOnResolution(narrowedConfig);

  return narrowedConfig.isResolved ? narrowedConfig.resolvedValue : undefined;
}
