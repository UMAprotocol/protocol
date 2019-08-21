import { useState, useEffect } from "react";
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
    // Check if regex number matches
    if (/^(\s*|\d+)$/.test(event.target.value)) {
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
