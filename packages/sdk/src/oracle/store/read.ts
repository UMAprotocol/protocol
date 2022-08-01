import filter from "lodash/filter";

import type {
  State,
  Chain,
  InputRequest,
  Erc20Props,
  ChainConfig,
  Context,
  Memory,
  User,
  OracleType,
} from "../types/state";
import type { JsonRpcSigner, BigNumber, Provider } from "../types/ethers";
import { TransactionConfirmer, requestId } from "../utils";
import { OracleInterface, Request, Requests } from "../types/interfaces";
import { Erc20 } from "../services/erc20";
import { SortedRequests } from "../services/sortedRequests";
import { assertExists } from "../errors";

// This is a typescript compatible way of pulling out values from the global state object, essentially
// forming a basic API. Most calls are parameterless, requiring first setting state which determines, the
// user/chain, etc of the query.

export default class Read {
  constructor(private state: State) {}
  chainConfig = (optionalChainId?: number): ChainConfig => {
    const chainId = optionalChainId || this.requestChainId();
    const config = this.state?.config?.chains?.[chainId];
    assertExists(config, "No config set for chain: " + chainId);
    return config;
  };
  oracleType = (): OracleType => {
    const source = this.state?.config?.oracleType;
    assertExists(source, "No oracle name set on config");
    return source;
  };
  requestChainId = (): number => {
    const chainId = this.state?.inputs?.request?.chainId;
    assertExists(chainId, "ChainId is not set on request");
    return chainId;
  };
  user = (): Partial<User> => {
    const result = this.state?.inputs?.user;
    assertExists(result, "user not set");
    return result;
  };
  userChainId = (): number => {
    const chainId = this.state?.inputs?.user?.chainId;
    assertExists(chainId, "ChainId is not set");
    return chainId;
  };
  requestChain = (optionalChainId?: number): Partial<Chain> => {
    const chainId = optionalChainId || this.requestChainId();
    const chain = this.state?.chains?.[chainId];
    assertExists(chain, "Chain not set");
    return chain;
  };
  userAddress = (): string => {
    const address = this.state?.inputs?.user?.address;
    assertExists(address, "User address is not set");
    return address;
  };
  oracleAddress = (optionalChainId?: number): string => {
    const chain = this.requestChain(optionalChainId);
    const address = chain?.optimisticOracle?.address;
    assertExists(address, "Optimistic oracle address not set");
    return address;
  };
  signer = (): JsonRpcSigner => {
    const signer = this.state?.inputs?.user?.signer;
    assertExists(signer, "Signer is not set");
    return signer;
  };
  inputRequest = (): InputRequest => {
    const input = this.state?.inputs?.request;
    assertExists(input, "Input request is not set");
    return input;
  };
  defaultLiveness = (): BigNumber => {
    const chain = this.requestChain();
    const liveness = chain?.optimisticOracle?.defaultLiveness;
    assertExists(liveness, "Optimistic oracle defaultLiveness set");
    return liveness;
  };
  request = (): Request => {
    const chain = this.requestChain();
    const input = this.inputRequest();
    const id = requestId(input);
    const request = chain?.optimisticOracle?.requests?.[id];
    assertExists(request, "Request has not been fetched");
    return request;
  };
  collateralProps = (): Partial<Erc20Props> => {
    const request = this.request();
    assertExists(request.currency, "Request currency not set");
    const chain = this.requestChain();
    const props = chain.erc20s?.[request.currency]?.props;
    assertExists(props, "Props not set on collateral token");
    return props;
  };
  userCollateralBalance = (): BigNumber => {
    const request = this.request();
    assertExists(request.currency, "Request currency not set");
    const chain = this.requestChain();
    const user = this.userAddress();
    const balance = chain?.erc20s?.[request.currency]?.balances?.[user];
    assertExists(balance, "Balance not set on collateral token for user");
    return balance;
  };
  userCollateralAllowance = (): BigNumber => {
    const request = this.request();
    assertExists(request.currency, "Request currency not set");
    const chain = this.requestChain();
    const user = this.userAddress();
    const oracle = this.oracleAddress();
    const allowance = chain?.erc20s?.[request.currency]?.allowances?.[oracle]?.[user];
    assertExists(allowance, "Allowance not set on user on collateral token for oracle");
    return allowance;
  };
  oracleService = (optionalChainId?: number): OracleInterface => {
    const chainId = optionalChainId || this.requestChainId();
    const result = this.state?.services?.chains?.[chainId]?.optimisticOracle;
    assertExists(result, "Optimistic Oracle Not found on chain " + chainId);
    return result;
  };
  collateralService = (): Erc20 => {
    const chainId = this.requestChainId();
    const request = this.request();
    assertExists(request.currency, "Request currency not set");
    const result = this.state?.services?.chains?.[chainId]?.erc20s?.[request.currency];
    assertExists(result, "Token not supported on chain " + chainId);
    return result;
  };
  command = (id: string): Context<unknown, unknown & Memory> => {
    const result = this.state?.commands?.[id];
    assertExists(result, "Unable to find command " + id);
    return result;
  };
  tokenService = (chainId: number, address: string): Erc20 => {
    const result = this.state?.services?.chains?.[chainId]?.erc20s?.[address];
    assertExists(result, "Token service not found: " + [chainId, address].join("."));
    return result;
  };
  provider = (chainId: number): Provider => {
    const result = this.state?.services?.chains?.[chainId]?.provider;
    assertExists(result, "Provider not found on chainid: " + chainId);
    return result;
  };
  transactionService = (chainId: number): TransactionConfirmer => {
    const provider = this.provider(chainId);
    return new TransactionConfirmer(provider);
  };
  listCommands = (): Context<unknown, unknown & Memory>[] => {
    return Object.values(this.state?.commands || []);
  };
  filterCommands = (search: { user?: string; done?: boolean }): Context<unknown, unknown & Memory>[] => {
    return filter(this.listCommands(), search) as Context<unknown, unknown & Memory>[];
  };
  chain = (optionalChainId?: number): Partial<Chain> => {
    const chainId = optionalChainId || this.requestChainId();
    const chain = this.state?.chains?.[chainId];
    assertExists(chain, "No chain for chainId: " + chainId);
    return chain;
  };
  currentTime = (optionalChainId?: number): BigNumber => {
    const chainId = optionalChainId || this.requestChainId();
    const chain = this.chain(chainId);
    const time = chain?.currentTime;
    assertExists(time, "Current time not available on chain: " + chainId);
    return time;
  };
  sortedRequestsService = (): SortedRequests => {
    const result = this.state?.services?.sortedRequests;
    assertExists(result, "Sorted request service not set");
    return result;
  };
  listChains = (): number[] => {
    return Object.keys(this.state?.chains || {}).map(Number);
  };
  descendingRequests = (): Requests => {
    return this.state.descendingRequests || [];
  };
  filterRequests = (query: Partial<Request>): Requests => {
    return filter(this.descendingRequests(), query);
  };
}
