import { useState, useEffect, useMemo } from "react";
import { drizzleReactHooks } from "drizzle-react";
import publicNetworks from "common/PublicNetworks";
import identifiers from "identifiers.json";

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

  const networkConfig = publicNetworks[networkId];

  if (networkConfig && networkConfig.etherscan) {
    return networkConfig.etherscan;
  }

  // Default to mainnet, even though it won't work for ganache runs.
  return "https://etherscan.io/";
}

export function useEthFaucetUrl() {
  const networkId = drizzleReactHooks.useDrizzleState(drizzleState => {
    return drizzleState.web3.networkId;
  });

  const networkConfig = publicNetworks[networkId];

  // The only networks that are both public and have an eth faucet should be testnets.
  if (networkConfig && networkConfig.ethFaucet) {
    return networkConfig.ethFaucet;
  }

  // Mainnet and private networks will default to this case.
  return null;
}

export function useDaiFaucetRequest() {
  const { useCacheSend, drizzle } = drizzleReactHooks.useDrizzle();

  const { account, networkId } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0],
    networkId: drizzleState.web3.networkId
  }));

  const { send } = useCacheSend("TestnetERC20", "allocateTo");

  // There is no DAI faucet for mainnet.
  if (publicNetworks[networkId] && publicNetworks[networkId].name === "mainnet") {
    return null;
  }

  return event => {
    if (event) {
      event.preventDefault();
    }
    send(account, drizzle.web3.utils.toWei("100000"));
  };
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
    .muln(100)
    .toString();

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

export function useMaxTokensThatCanBeCreated(tokenAddress, marginAmount) {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { toWei, toBN } = drizzle.web3.utils;

  const derivativeStorage = useCacheCall(tokenAddress, "derivativeStorage");
  const newExcessMargin = useCacheCall(tokenAddress, "calcExcessMargin");
  const tokenValue = useCacheCall(tokenAddress, "calcTokenValue");

  const dataFetched = derivativeStorage && newExcessMargin && tokenValue;
  if (!dataFetched) {
    return { ready: false };
  }
  if (marginAmount === "") {
    return { ready: true, maxTokens: toBN("0") };
  }

  const fpScalingFactor = toBN(toWei("1"));
  const sentAmount = toBN(toWei(marginAmount));
  const supportedMove = toBN(derivativeStorage.fixedParameters.supportedMove);
  const tokenValueBn = toBN(tokenValue);

  const mul = (a, b) => a.mul(b).divRound(fpScalingFactor);
  const div = (a, b) => a.mul(fpScalingFactor).divRound(b);

  // `supportedTokenMarketCap` represents the extra token market cap that there is sufficient collateral for. Tokens can be purchased at
  // `tokenValue` up to this amount.
  const supportedTokenMarketCap = div(toBN(newExcessMargin), supportedMove);
  if (sentAmount.lte(supportedTokenMarketCap)) {
    // The amount of money being sent in is the limiting factor.
    return { ready: true, maxTokens: div(sentAmount, tokenValueBn) };
  } else {
    // Tokens purchased beyond the value of `supportedTokenMarketCap` cost `(1 + supportedMove) * tokenValue`, because some of
    // the money has to be diverted to support the margin requirement.
    const costOfExtra = mul(tokenValueBn, fpScalingFactor.add(supportedMove));
    const extra = sentAmount.sub(supportedTokenMarketCap);
    return { ready: true, maxTokens: div(supportedTokenMarketCap, tokenValueBn).add(div(extra, costOfExtra)) };
  }
}

export function useLiquidationPrice(tokenAddress) {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { toBN, toWei } = drizzle.web3.utils;
  const navStr = useCacheCall(tokenAddress, "calcNAV");
  const excessMarginStr = useCacheCall(tokenAddress, "calcExcessMargin");
  const underlyingPriceTime = useCacheCall(tokenAddress, "getUpdatedUnderlyingPrice");

  if (!navStr || !excessMarginStr || !underlyingPriceTime) {
    return undefined;
  }

  // Convert string outputs to BN.
  const nav = toBN(navStr);
  const excessMargin = toBN(excessMarginStr);
  const underlyingPrice = toBN(underlyingPriceTime.underlyingPrice);

  if (nav.isZero()) {
    return null;
  }

  const fpScalingFactor = toBN(toWei("1"));

  const mul = (a, b) => a.mul(b).divRound(fpScalingFactor);
  const div = (a, b) => a.mul(fpScalingFactor).divRound(b);

  const maxNav = nav.add(excessMargin);
  const percentChange = div(maxNav, nav);
  const liquidationPrice = mul(percentChange, underlyingPrice);

  return liquidationPrice;
}

export function useIdentifierConfig() {
  return useMemo(() => {
    const identifierConfig = {};

    // Extract the dappConfig from the global config.
    for (const [identifier, { dappConfig }] of Object.entries(identifiers)) {
      identifierConfig[identifier] = dappConfig;
    }

    return identifierConfig;
  }, []);
}

export function useDaiAddress() {
  const { drizzle } = drizzleReactHooks.useDrizzle();

  const networkId = drizzleReactHooks.useDrizzleState(drizzleState => {
    return drizzleState.web3.networkId;
  });

  if (networkId.toString() === "1") {
    // Real DAI address.
    return "0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359";
  }

  // Otherwise, we'll use the same address that our faucet depends on.
  return drizzle.contracts.TestnetERC20.address;
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
