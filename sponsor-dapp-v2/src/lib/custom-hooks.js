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
