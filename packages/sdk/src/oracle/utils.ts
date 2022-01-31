import {
  State,
  RequestState,
  Flag,
  Flags,
  PartialChainConfig,
  ChainConfig,
  PartialConfig,
  ChainMetadata,
  Config,
} from "./types/state";
import type { Provider, TransactionReceipt } from "./types/ethers";
import { ContextType } from "./types/statemachine";
import { Read } from "./store";
import { ethers } from "ethers";

export const getAddress = ethers.utils.getAddress;
export const hexValue = ethers.utils.hexValue;

export function ignoreError<X extends () => any>(call: X): ReturnType<X> | undefined {
  try {
    return call();
  } catch (err) {
    return undefined;
  }
}

export function initFlags(): Flags {
  return {
    [Flag.MissingRequest]: false,
    [Flag.MissingUser]: false,
    [Flag.WrongChain]: false,
    [Flag.CanPropose]: false,
    [Flag.CanDispute]: false,
    [Flag.CanSettle]: false,
    [Flag.InDvmVote]: false,
    [Flag.RequestSettled]: false,
    [Flag.InsufficientBalance]: false,
    [Flag.InsufficientApproval]: false,
    [Flag.ProposalTxInProgress]: false,
    [Flag.ApprovalTxInProgress]: false,
    [Flag.DisputeTxInProgress]: false,
    [Flag.ChainChangeInProgress]: false,
  };
}

export const nowS = (now = Date.now()): number => Math.floor(now / 1000);

// reduce global state into important UI boolean states. this should never throw errors.
export function getFlags(state: State): Record<Flag, boolean> {
  const read = new Read(state);
  const flags = initFlags();

  const signer = ignoreError(read.signer);
  flags[Flag.MissingUser] = signer ? false : true;

  const inputRequest = ignoreError(read.inputRequest);
  flags[Flag.MissingRequest] = inputRequest ? false : true;

  const userChainId = ignoreError(read.userChainId);
  const requestChainId = ignoreError(read.requestChainId);
  flags[Flag.WrongChain] = userChainId && requestChainId ? userChainId !== requestChainId : false;

  const request = ignoreError(read.request);

  // these are a bit redundant with request state, but just an alternate way to see current request state
  flags[Flag.CanPropose] = request?.state === RequestState.Requested;
  flags[Flag.CanDispute] = request?.state === RequestState.Proposed;
  flags[Flag.CanSettle] = request?.state === RequestState.Resolved;
  flags[Flag.InDvmVote] = request?.state === RequestState.Disputed;
  flags[Flag.RequestSettled] = request?.state === RequestState.Settled;

  if (request && request.bond && request.finalFee) {
    const totalBond = request.bond.add(request.finalFee);
    const userCollateralBalance = ignoreError(read.userCollateralBalance);
    const userCollateralAllowance = ignoreError(read.userCollateralAllowance);
    flags[Flag.InsufficientBalance] = userCollateralBalance ? userCollateralBalance.lt(totalBond) : false;
    flags[Flag.InsufficientApproval] = userCollateralAllowance ? userCollateralAllowance.lt(totalBond) : false;
  }

  const userAddress = ignoreError(read.userAddress);
  const commands = ignoreError(() => read.filterCommands({ done: false, user: userAddress }));
  if (userAddress && commands) {
    commands.forEach((command) => {
      if (!flags[Flag.ProposalTxInProgress] && command.type === ContextType.proposePrice) {
        flags[Flag.ProposalTxInProgress] = true;
      }
      if (!flags[Flag.DisputeTxInProgress] && command.type === ContextType.disputePrice) {
        flags[Flag.DisputeTxInProgress] = true;
      }
      if (!flags[Flag.ApprovalTxInProgress] && command.type === ContextType.approve) {
        flags[Flag.ApprovalTxInProgress] = true;
      }
      if (!flags[Flag.ChainChangeInProgress] && command.type === ContextType.switchOrAddChain) {
        flags[Flag.ChainChangeInProgress] = true;
      }
    });
  }

  return flags;
}

// this had to be copied in because interfaces in contracts-frontend and contracts-node are different
// The frontend cant use contracts-node because async calls are required for addresses, when testing in node
// we arent able to import contracts-frontend.
export function getOptimisticOracleAddress(chainId: number): string {
  switch (chainId.toString()) {
    case "1":
      return getAddress("0xc43767f4592df265b4a9f1a398b97ff24f38c6a6");
    case "4":
      return getAddress("0x3746badD4d6002666dacd5d7bEE19f60019A8433");
    case "10":
      return getAddress("0x56e2d1b8C7dE8D11B282E1b4C924C32D91f9102B");
    case "42":
      return getAddress("0xB1d3A89333BBC3F5e98A991d6d4C1910802986BC");
    case "100":
      return getAddress("0xd2ecb3afe598b746F8123CaE365a598DA831A449");
    case "137":
      return getAddress("0xBb1A8db2D4350976a11cdfA60A1d43f97710Da49");
    case "288":
      return getAddress("0x7da554228555C8Bf3748403573d48a2138C6b848");
    case "42161":
      return getAddress("0x031A7882cE3e8b4462b057EBb0c3F23Cd731D234");
    case "80001":
      return getAddress("0xAB75727d4e89A7f7F04f57C00234a35950527115");
    default:
      throw new Error(`No address found for deployment OptimisticOracle on chainId ${chainId}`);
  }
}

export function getMulticall2Address(chainId: number): string {
  switch (chainId.toString()) {
    case "1":
      return getAddress("0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696");
    case "4":
      return getAddress("0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696");
    case "5":
      return getAddress("0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696");
    case "42":
      return getAddress("0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696");
    default:
      throw new Error(`No address found for deployment Multicall2 on chainId ${chainId}`);
  }
}

export function defaultChainConfig(chainId: number, chainConfig: PartialChainConfig): ChainConfig {
  let multicall2Address = chainConfig.multicall2Address;
  try {
    multicall2Address = multicall2Address || getMulticall2Address(chainId);
  } catch (err) {
    // ignore, multicall optional
  }

  // dont ignore error, oracle required
  const optimisticOracleAddress = chainConfig.optimisticOracleAddress || getOptimisticOracleAddress(chainId);
  const checkTxIntervalSec = chainConfig.checkTxIntervalSec || 5;

  return {
    ...chainConfig,
    chainId,
    multicall2Address,
    optimisticOracleAddress,
    checkTxIntervalSec,
  };
}

export function defaultConfig(config: PartialConfig): Config {
  return Object.entries(config.chains).reduce(
    (config: Config, [chainId, chainConfig]) => {
      config.chains[Number(chainId)] = defaultChainConfig(Number(chainId), chainConfig);
      return config;
    },
    { chains: {} }
  );
}

export class TransactionConfirmer {
  constructor(private provider: Provider) {}
  async getReceipt(hash: string): Promise<TransactionReceipt> {
    return this.provider.getTransactionReceipt(hash);
  }
  async isConfirmed(hash: string, confirmations = 1): Promise<boolean | TransactionReceipt> {
    try {
      const receipt = await this.getReceipt(hash);
      if (receipt.confirmations >= confirmations) return receipt;
    } catch (err) {
      // do nothing
    }
    return false;
  }
}

export function chainConfigToChainMetadata(config: ChainConfig): ChainMetadata {
  const { checkTxIntervalSec, multicall2Address, optimisticOracleAddress, ...chainMetadata } = config;
  return chainMetadata;
}
