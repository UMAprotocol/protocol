import assert from "assert";
import { bridgePool } from "../../clients";
import { BigNumber, Signer } from "ethers";
import { toBNWei, fixedPointAdjustment, calcInterest, calcApy, fromWei, BigNumberish } from "../utils";
import { BatchReadWithErrors } from "../../utils";
import Multicall2 from "../../multicall2";
import TransactionManager from "../transactionManager";
import { TransactionRequest, TransactionReceipt, Provider } from "@ethersproject/abstract-provider";
import set from "lodash/set";
import get from "lodash/get";
import has from "lodash/has";

export type { Provider };
export type BatchReadWithErrorsType = ReturnType<ReturnType<typeof BatchReadWithErrors>>;

// this is a rough estimation of blocks per day from: https://ycharts.com/indicators/ethereum_blocks_per_day
// may be able to replace with dynamic value https://docs.etherscan.io/api-endpoints/blocks#get-daily-block-count-and-rewards
export const BLOCKS_PER_YEAR = 6359 * 365;

export type Awaited<T> = T extends PromiseLike<infer U> ? U : T;

export type Config = {
  multicall2Address: string;
};
export type Dependencies = {
  provider: Provider;
};
export type Pool = {
  address: string;
  totalPoolSize: string;
  l1Token: string;
  liquidReserves: string;
  pendingReserves: string;
  exchangeRateCurrent: string;
  exchangeRatePrevious: string;
  estimatedApy: string;
};
export type User = {
  address: string;
  poolAddress: string;
  lpTokens: string;
  positionValue: string;
  totalDeposited: string;
  feesEarned: string;
};
export type Transaction = {
  id: string;
  state: "requested" | "submitted" | "mined";
  toAddress: string;
  fromAddress: string;
  type: "Add Liquidity" | "Remove Liquidity";
  description: string;
  request?: TransactionRequest;
  hash?: string;
  receipt?: TransactionReceipt;
};
export type Token = {
  decimals: string;
  symbol: string;
  name: string;
};
export type State = {
  pools: Record<string, Pool>;
  users: Record<string, Record<string, User>>;
  transactions: Record<string, Transaction>;
};
export type EmitState = (path: string[], data: any) => void;

class PoolState {
  private l1Token: string | undefined = undefined;
  constructor(
    private batchRead: BatchReadWithErrorsType,
    private contract: bridgePool.Instance,
    private address: string
  ) {}
  public async read(latestBlock: number) {
    if (this.l1Token === undefined) this.l1Token = await this.contract.l1Token();
    // typechain does not have complete types for call options, so we have to cast blockTag to any
    const exchangeRatePrevious = await this.contract.callStatic.exchangeRateCurrent({
      blockTag: latestBlock - 1,
    } as any);
    return {
      address: this.address,
      l1Token: this.l1Token,
      exchangeRatePrevious,
      ...(await this.batchRead([
        ["liquidReserves"],
        ["pendingReserves"],
        ["utilizedReserves"],
        ["exchangeRateCurrent"],
      ])),
    };
  }
}

class PoolEventState {
  constructor(
    private contract: bridgePool.Instance,
    private startBlock = 0,
    private state: bridgePool.EventState = bridgePool.eventStateDefaults()
  ) {}
  public async read(endBlock: number, user?: string) {
    if (endBlock <= this.startBlock) return this.state;
    const events = (
      await Promise.all([
        ...(await this.contract.queryFilter(
          this.contract.filters.LiquidityAdded(undefined, undefined, user),
          this.startBlock,
          endBlock
        )),
        ...(await this.contract.queryFilter(
          this.contract.filters.LiquidityRemoved(undefined, undefined, user),
          this.startBlock,
          endBlock
        )),
      ])
    ).sort((a, b) => {
      if (a.blockNumber < b.blockNumber) return -1;
      if (a.transactionIndex < b.transactionIndex) return -1;
      if (a.logIndex < b.logIndex) return -1;
      return 1;
    });
    this.startBlock = endBlock;
    this.state = bridgePool.getEventState(events, this.state);
    return this.state;
  }
}

class UserState {
  constructor(private contract: bridgePool.Instance) {}
  public async read(user: string) {
    return {
      address: user,
      balanceOf: await this.contract.balanceOf(user),
    };
  }
}

export function calculateApy(currentExchangeRate: string, previousExchangeRate: string, periods = BLOCKS_PER_YEAR) {
  const startPrice = fromWei(previousExchangeRate);
  const endPrice = fromWei(currentExchangeRate);
  const interest = calcInterest(startPrice, endPrice, periods.toString());
  return calcApy(interest, periods.toString());
}
export function calculateRemoval(amountWei: BigNumber, percentWei: BigNumber) {
  const receive = amountWei.mul(percentWei).div(fixedPointAdjustment);
  const remain = amountWei.sub(receive);
  return {
    recieve: receive.toString(),
    remain: remain.toString(),
  };
}
export function previewRemoval(positionValue: string, feesEarned: string, percentFloat: number) {
  const percentWei = toBNWei(percentFloat);
  return {
    position: {
      ...calculateRemoval(BigNumber.from(positionValue), percentWei),
    },
    fees: {
      ...calculateRemoval(BigNumber.from(feesEarned), percentWei),
    },
    total: {
      ...calculateRemoval(BigNumber.from(positionValue), percentWei),
    },
  };
}
function joinUserState(
  poolState: Pool,
  eventState: bridgePool.EventState,
  userState: Awaited<ReturnType<UserState["read"]>>
): User {
  const positionValue = BigNumber.from(poolState.exchangeRateCurrent)
    .mul(userState.balanceOf)
    .div(fixedPointAdjustment);
  const totalDeposited = BigNumber.from(eventState.tokens[userState.address] || "0");
  const feesEarned = positionValue.sub(totalDeposited);
  return {
    address: userState.address,
    poolAddress: poolState.address,
    lpTokens: userState.balanceOf.toString(),
    positionValue: positionValue.toString(),
    totalDeposited: totalDeposited.toString(),
    feesEarned: feesEarned.toString(),
  };
}
export class ReadUserClient {
  private poolEventState: PoolEventState;
  private userState: UserState;
  constructor(private contract: bridgePool.Instance, private user: string) {
    this.poolEventState = new PoolEventState(this.contract);
    this.userState = new UserState(this.contract);
  }
  public async read(latestBlock: number) {
    const eventState = await this.poolEventState.read(latestBlock, this.user);
    const userState = await this.userState.read(this.user);
    return {
      eventState,
      userState,
    };
  }
}

function joinPoolState(poolState: Awaited<ReturnType<PoolState["read"]>>): Pool {
  const totalPoolSize = poolState.liquidReserves.add(poolState.pendingReserves).add(poolState.utilizedReserves);
  const estimatedApy = calculateApy(poolState.exchangeRateCurrent, poolState.exchangeRatePrevious);
  return {
    address: poolState.address,
    totalPoolSize: totalPoolSize.toString(),
    l1Token: poolState.l1Token,
    liquidReserves: poolState.liquidReserves.toString(),
    pendingReserves: poolState.pendingReserves.toString(),
    exchangeRateCurrent: poolState.exchangeRateCurrent.toString(),
    exchangeRatePrevious: poolState.exchangeRatePrevious.toString(),
    estimatedApy,
  };
}
export class ReadPoolClient {
  private poolState: PoolState;
  private multicall: Multicall2;
  private contract: bridgePool.Instance;
  private batchRead: BatchReadWithErrorsType;
  constructor(private address: string, private provider: Provider, private multicallAddress: string) {
    this.multicall = new Multicall2(multicallAddress, provider);
    this.contract = bridgePool.connect(address, provider);
    this.batchRead = BatchReadWithErrors(this.multicall)(this.contract);
    this.poolState = new PoolState(this.batchRead, this.contract, address);
  }
  public async read(latestBlock: number) {
    return this.poolState.read(latestBlock);
  }
}
export function validateWithdraw(pool: Pool, user: User, lpTokenAmount: BigNumberish) {
  const l1TokensToReturn = BigNumber.from(lpTokenAmount).mul(pool.exchangeRateCurrent).div(fixedPointAdjustment);
  assert(BigNumber.from(l1TokensToReturn).gt("0"), "Must withdraw amount greater than 0");
  assert(
    BigNumber.from(pool.liquidReserves).gte(l1TokensToReturn.add(pool.pendingReserves)),
    "Utilization too high to remove that amount, try lowering withdraw amount"
  );
  assert(BigNumber.from(lpTokenAmount).lte(user.lpTokens), "You cannot withdraw more than you have");
  return { lpTokenAmount, l1TokensToReturn: l1TokensToReturn.toString() };
}

export class Client {
  private poolContracts: Record<string, bridgePool.Instance> = {};
  private multicall: Multicall2;
  private transactionManagers: Record<string, ReturnType<typeof TransactionManager>> = {};
  private state: State = { pools: {}, users: {}, transactions: {} };
  private batchRead: ReturnType<typeof BatchReadWithErrors>;
  private poolEvents: Record<string, PoolEventState> = {};
  // private batchRead:BatchReadWithErrorsType
  constructor(private config: Config, private deps: Dependencies, private emit: EmitState) {
    this.multicall = new Multicall2(config.multicall2Address, deps.provider);
    this.batchRead = BatchReadWithErrors(this.multicall);
  }
  private getOrCreatePoolContract(address: string) {
    if (this.poolContracts[address]) return this.poolContracts[address];
    const contract = bridgePool.connect(address, this.deps.provider);
    this.poolContracts[address] = contract;
    return contract;
  }
  private getOrCreatePoolEvents(poolAddress: string) {
    if (this.poolEvents[poolAddress]) return this.poolEvents[poolAddress];
    this.poolEvents[poolAddress] = new PoolEventState(this.getOrCreatePoolContract(poolAddress));
    return this.poolEvents[poolAddress];
  }
  private getOrCreateTransactionManager(signer: Signer, address: string) {
    if (this.transactionManagers[address]) return this.transactionManagers[address];
    const txman = TransactionManager(signer, (event, id, data) => {
      if (event === "requested") {
        this.emit(["transactions", id], this.state.transactions[id]);
      }
      if (event === "submitted") {
        this.state.transactions[id].state = event;
        this.state.transactions[id].hash = data as string;
        this.emit(["transactions", id], { ...this.state.transactions[id] });
      }
      if (event === "mined") {
        this.state.transactions[id].state = event;
        this.state.transactions[id].receipt = data as TransactionReceipt;
        this.emit(["transactions", id], { ...this.state.transactions[id] });
      }
    });
    this.transactionManagers[address] = txman;
    return txman;
  }
  async addEthLiquidity(signer: Signer, pool: string, l1TokenAmount: BigNumberish) {
    const userAddress = await signer.getAddress();
    const contract = this.getOrCreatePoolContract(pool);
    const txman = this.getOrCreateTransactionManager(signer, userAddress);

    const request = await contract.populateTransaction.addLiquidity(l1TokenAmount, { value: l1TokenAmount });
    const id = await txman.request(request);

    this.state.transactions[id] = {
      id,
      state: "requested",
      toAddress: pool,
      fromAddress: userAddress,
      type: "Add Liquidity",
      description: `Adding ETH to pool`,
      request,
    };

    await txman.update();
    return id;
  }
  async addTokenLiquidity(signer: Signer, pool: string, l1TokenAmount: BigNumberish) {
    const userAddress = await signer.getAddress();
    const contract = this.getOrCreatePoolContract(pool);
    const txman = this.getOrCreateTransactionManager(signer, userAddress);

    const request = await contract.populateTransaction.addLiquidity(l1TokenAmount);
    const id = await txman.request(request);

    this.state.transactions[id] = {
      id,
      state: "requested",
      toAddress: pool,
      fromAddress: userAddress,
      type: "Add Liquidity",
      description: `Adding Tokens to pool`,
      request,
    };

    await txman.update();
    return id;
  }
  async validateWithdraw(poolAddress: string, userAddress: string, lpAmount: BigNumberish) {
    if (!this.hasPool(poolAddress)) {
      await this.updatePool(poolAddress);
    }
    const poolState = this.getPool(poolAddress);
    if (!this.hasUser(poolAddress, userAddress)) {
      await this.updateUser(poolAddress, userAddress);
    }
    const userState = this.getUser(poolAddress, userAddress);
    return validateWithdraw(poolState, userState, lpAmount);
  }
  async removeTokenLiquidity(signer: Signer, pool: string, lpTokenAmount: BigNumberish) {
    const userAddress = await signer.getAddress();
    await this.validateWithdraw(pool, userAddress, lpTokenAmount);
    const contract = this.getOrCreatePoolContract(pool);
    const txman = this.getOrCreateTransactionManager(signer, userAddress);

    const request = await contract.populateTransaction.removeLiquidity(lpTokenAmount, false);
    const id = await txman.request(request);

    this.state.transactions[id] = {
      id,
      state: "requested",
      toAddress: pool,
      fromAddress: userAddress,
      type: "Remove Liquidity",
      description: `Withdrawing Tokens from pool`,
      request,
    };

    await txman.update();
    return id;
  }
  async removeEthliquidity(signer: Signer, pool: string, lpTokenAmount: BigNumberish) {
    const userAddress = await signer.getAddress();
    await this.validateWithdraw(pool, userAddress, lpTokenAmount);
    const contract = this.getOrCreatePoolContract(pool);
    const txman = this.getOrCreateTransactionManager(signer, userAddress);

    const request = await contract.populateTransaction.removeLiquidity(lpTokenAmount, true);
    const id = await txman.request(request);

    this.state.transactions[id] = {
      id,
      state: "requested",
      toAddress: pool,
      fromAddress: userAddress,
      type: "Remove Liquidity",
      description: `Withdrawing Eth from pool`,
      request,
    };
    await txman.update();
    return id;
  }
  getPool(poolAddress: string) {
    return this.state.pools[poolAddress];
  }
  hasPool(poolAddress: string) {
    return Boolean(this.state.pools[poolAddress]);
  }
  getUser(poolAddress: string, userAddress: string) {
    return get(this.state, ["users", userAddress, poolAddress]);
  }
  hasUser(poolAddress: string, userAddress: string) {
    return has(this.state, ["users", userAddress, poolAddress]);
  }
  hasTx(id: string) {
    return has(this.state, ["transactions", id]);
  }
  getTx(id: string) {
    return get(this.state, ["transactions", id]);
  }
  async updateUser(userAddress: string, poolAddress: string) {
    const contract = this.getOrCreatePoolContract(poolAddress);
    if (!this.hasPool(poolAddress)) {
      await this.updatePool(poolAddress);
    }
    const poolState = this.getPool(poolAddress);
    const latestBlock = (await this.deps.provider.getBlock("latest")).number;
    // const userClient = new ReadUserClient(contract,userAddress)
    const getUserState = new UserState(contract);
    const getPoolEventState = this.getOrCreatePoolEvents(poolAddress);
    const userState = await getUserState.read(userAddress);
    const eventState = await getPoolEventState.read(latestBlock);
    set(this.state, ["users", userAddress, poolAddress], joinUserState(poolState, eventState, userState));
    this.emit(["users", userAddress, poolAddress], this.state.users[userAddress][poolAddress]);
  }
  async updatePool(poolAddress: string) {
    const contract = this.getOrCreatePoolContract(poolAddress);
    const pool = new PoolState(this.batchRead(contract), contract, poolAddress);
    const latestBlock = (await this.deps.provider.getBlock("latest")).number;
    const state = await pool.read(latestBlock);
    this.state.pools[poolAddress] = joinPoolState(state);
    this.emit(["pools", poolAddress], this.state.pools[poolAddress]);
  }
  async updateTransactions() {
    for (const txMan of Object.values(this.transactionManagers)) {
      await txMan.update();
    }
  }
}
