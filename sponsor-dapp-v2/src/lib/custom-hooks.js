import { useState, useEffect, useMemo } from "react";
import { drizzleReactHooks } from "drizzle-react";
import publicNetworks from "common/PublicNetworks";
import identifiers from "identifiers.json";
import { MAX_UINT_VAL } from "common/Constants";
import { sendGaEvent } from "lib/google-analytics";
import { ContractStateEnum } from "common/TokenizedDerivativeUtils";

// This is a hack to handle reverts for view/pure functions that don't actually revert on public networks.
// See https://forum.openzeppelin.com/t/require-in-view-pure-functions-dont-revert-on-public-networks/1211 for more
// info.
export function revertWrapper(result) {
  if (!result) {
    return null;
  }

  let revertValue = "3963877391197344453575983046348115674221700746820753546331534351508065746944";
  if (result.toString() === revertValue) {
    return null;
  }

  const isObject = obj => {
    return obj === Object(obj);
  };

  if (isObject(result)) {
    // Iterate over the properties of the object and see if any match the revert value.
    for (let prop in result) {
      if (result[prop].toString() === revertValue) {
        return null;
      }
    }
  }
}

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
    sendGaEvent("TestnetERC20", "allocateTo");
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
    sendGaEvent("TokenizedDerivative", "Interaction");
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
  data.nav = revertWrapper(useCacheCall(tokenAddress, "calcNAV"));
  data.shortMarginBalance = revertWrapper(useCacheCall(tokenAddress, "calcShortMarginBalance"));

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
  const newExcessMargin = revertWrapper(useCacheCall(tokenAddress, "calcExcessMargin"));
  const tokenValue = revertWrapper(useCacheCall(tokenAddress, "calcTokenValue"));

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

export function computeLiquidationPrice(web3, navString, excessMarginString, underlyingPriceTime) {
  const { toBN, toWei } = web3.utils;

  // Return undefined (as drizzle would) if the blockchain values have not been received yet.
  if (!navString || !excessMarginString || !underlyingPriceTime) {
    return undefined;
  }

  // Convert string outputs to BN.
  const nav = toBN(navString);
  const excessMargin = toBN(excessMarginString);
  const underlyingPrice = toBN(underlyingPriceTime.underlyingPrice);

  // Return null if there is no valid output that can be computed.
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

export function useIsContractSponsor(contractAddress) {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { toChecksumAddress } = drizzle.web3.utils;

  const account = drizzleReactHooks.useDrizzleState(drizzleState => drizzleState.accounts[0]);
  const derivativeStorage = useCacheCall(contractAddress, "derivativeStorage");

  return (
    derivativeStorage && toChecksumAddress(account) === toChecksumAddress(derivativeStorage.externalAddresses.sponsor)
  );
}

export function useSettle(contractAddress) {
  const { useCacheCall, useCacheSend } = drizzleReactHooks.useDrizzle();
  const account = drizzleReactHooks.useDrizzleState(drizzleState => drizzleState.accounts[0]);

  const canBeSettled = useCacheCall(contractAddress, "canBeSettled");
  const derivativeStorage = useCacheCall(contractAddress, "derivativeStorage");
  const canCallRemargin = useIsContractSponsor(contractAddress);

  const { send: remargin, status: remarginStatus } = useCacheSend(contractAddress, "remargin");
  const { send: settle, status: settleStatus } = useCacheSend(contractAddress, "settle");

  let send;

  const settleHandler = e => {
    e.preventDefault();
    send({ from: account });
    sendGaEvent("TokenizedDerivative", "Settle");
  };

  if (canBeSettled === undefined || !derivativeStorage) {
    return { ready: false };
  }

  if (derivativeStorage.state.toString() === ContractStateEnum.LIVE) {
    // Handle edge case where user can go directly from live to settled via a remargin.
    send = remargin;
    return {
      ready: true,
      canCallSettle: canBeSettled && canCallRemargin,
      settleHandler,
      isLoadingSettle: remarginStatus === "pending"
    };
  } else {
    send = settle;
    return {
      ready: true,
      canCallSettle: canBeSettled,
      settleHandler,
      isLoadingSettle: settleStatus === "pending"
    };
  }
}

export function useExpire(contractAddress, identifier) {
  const { drizzle, useCacheCall, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { toBN, utf8ToHex } = drizzle.web3.utils;
  const account = drizzleReactHooks.useDrizzleState(drizzleState => drizzleState.accounts[0]);

  const canCallRemargin = useIsContractSponsor(contractAddress);
  const derivativeStorage = useCacheCall(contractAddress, "derivativeStorage");
  const underlyingPriceTime = useCacheCall("ManualPriceFeed", "latestPrice", utf8ToHex(identifier));

  const { send: remargin, status: remarginStatus } = useCacheSend(contractAddress, "remargin");

  if (canCallRemargin === undefined || !underlyingPriceTime || !derivativeStorage) {
    return { ready: false };
  }

  const canCallExpire =
    canCallRemargin &&
    derivativeStorage.state === ContractStateEnum.LIVE &&
    toBN(underlyingPriceTime.publishTime).gte(toBN(derivativeStorage.endTime));

  const expireHandler = e => {
    e.preventDefault();
    remargin({ from: account });
    sendGaEvent("TokenizedDerivative", "Expire");
  };

  return {
    ready: true,
    canCallExpire,
    expireHandler,
    isLoadingExpire: remarginStatus === "pending"
  };
}

export function useTokenPreapproval(tokenContractName, addressToApprove) {
  const { drizzle, useCacheCall, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { toBN } = drizzle.web3.utils;
  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const allowance = useCacheCall(tokenContractName, "allowance", account, addressToApprove);
  const allowanceAmount = toBN(MAX_UINT_VAL);
  const minAllowanceAmount = allowanceAmount.divRound(toBN("2"));
  const { send: approve, status: approvalStatus } = useCacheSend(tokenContractName, "approve");
  const approveTokensHandler = e => {
    e.preventDefault();
    approve(addressToApprove, allowanceAmount.toString(), { from: account });
    sendGaEvent("TokenizedDerivative", "Approve");
  };

  if (!allowance) {
    return { ready: false };
  }

  return {
    ready: true,
    approveTokensHandler,
    isApproved: toBN(allowance).gte(minAllowanceAmount),
    isLoadingApproval: approvalStatus === "pending"
  };
}

export function useLiquidationPrice(tokenAddress) {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const nav = revertWrapper(useCacheCall(tokenAddress, "calcNAV"));
  const excessMargin = revertWrapper(useCacheCall(tokenAddress, "calcExcessMargin"));
  const underlyingPriceTime = revertWrapper(useCacheCall(tokenAddress, "getUpdatedUnderlyingPrice"));

  return computeLiquidationPrice(drizzle.web3, nav, excessMargin, underlyingPriceTime);
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
