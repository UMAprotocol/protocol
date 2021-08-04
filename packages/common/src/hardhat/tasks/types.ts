import type { DeploymentsExtension } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types/runtime";
import type { EthereumProvider } from "hardhat/types";
import type { Extension as ExtendedWeb3 } from "../plugins/ExtendedWeb3";
import type Web3 from "web3";

type Address = string;

interface DeployExtension {
  deployments: DeploymentsExtension;
  getNamedAccounts: () => Promise<{
    [name: string]: Address;
  }>;
  getUnnamedAccounts: () => Promise<Address[]>;
  getChainId(): Promise<string>;
  companionNetworks: {
    [name: string]: {
      deployments: DeploymentsExtension;
      getNamedAccounts: () => Promise<{
        [name: string]: Address;
      }>;
      getUnnamedAccounts: () => Promise<string[]>;
      getChainId(): Promise<string>;
      provider: EthereumProvider;
    };
  };
}

// Assumes this includes the normal HRE, hardhat-deploy extension, the ExtendedWeb3 extension and the web3 extension.
// TODO: figure out how to get the extended HRE from hardhat-deploy.
export type CombinedHRE = HardhatRuntimeEnvironment &
  DeployExtension &
  ExtendedWeb3 & {
    web3: Web3;
  };
