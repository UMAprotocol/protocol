import { ethers } from "ethers";
import Store from "../../store";
import { Web3Provider } from "../../types/ethers";
import { Handlers as GenericHandlers } from "../../types/statemachine";

export type Params = {
  chainId: number;
  provider: Web3Provider;
};

export type Memory = undefined;

export function initMemory(): Memory {
  return undefined;
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  return {
    async start(params: Params) {
      const { provider, chainId } = params;
      try {
        await provider.send("wallet_switchEthereumChain", [
          {
            chainId: ethers.utils.hexValue(chainId),
          },
        ]);
        return "done";
      } catch (err) {
        const error = (err as unknown) as Error & { code: number };
        if (error.code === -32603 || error.code === 4902) {
          return "addAndSwitch";
        }
        throw error;
      }
    },
    async addAndSwitch(params: Params) {
      const { chainId, provider } = params;
      const config = store.read().chainConfig(chainId);
      await provider.send("wallet_addEthereumChain", [
        {
          ...config,
          chainId: ethers.utils.hexValue(chainId),
        },
      ]);
      await provider.send("wallet_switchEthereumChain", [
        {
          chainId: ethers.utils.hexValue(chainId),
        },
      ]);
      return "done";
    },
  };
}
