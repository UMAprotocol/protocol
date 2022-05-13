import assert from "assert";
import { bridgePool, rateModelStore } from "../../clients";
import { toBNWei, fixedPointAdjustment, calcPeriodicCompoundInterest, calcApr, BigNumberish, fromWei } from "../utils";
import { BatchReadWithErrors, loop, exists } from "../../utils";
import Multicall2 from "../../multicall2";
import TransactionManager from "../transactionManager";
import { ethers, Signer, BigNumber } from "ethers";
import type { Overrides } from "@ethersproject/contracts";
import { TransactionRequest, TransactionReceipt, Log } from "@ethersproject/abstract-provider";
import { Provider, Block } from "@ethersproject/providers";
import set from "lodash/set";
import get from "lodash/get";
import has from "lodash/has";
import { calculateInstantaneousRate } from "../feeCalculator";
import { SECONDS_PER_YEAR, DEFAULT_BLOCK_DELTA, RateModel, ADDRESSES } from "../constants";
import { parseAndReturnRateModelFromString } from "../rateModel";

export type { Provider };
export type BatchReadWithErrorsType = ReturnType<ReturnType<typeof BatchReadWithErrors>>;

export type Awaited<T> = T extends PromiseLike<infer U> ? U : T;

export type Config = {
  multicall2Address: string;
  rateModelStoreAddress?: string;
  confirmations?: number;
  blockDelta?: number;
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
  estimatedApr: string;
  blocksElapsed: number;
  secondsElapsed: number;
  liquidityUtilizationCurrent: string;
  utilizedReserves: string;
  projectedApr: string;
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
  state: "requested" | "submitted" | "mined" | "error";
  toAddress: string;
  fromAddress: string;
  type: "Add Liquidity" | "Remove Liquidity";
  description: string;
  request?: TransactionRequest;
  hash?: string;
  receipt?: TransactionReceipt;
  error?: Error;
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
  error?: Error;
};
export type EmitState = (path: string[], data: any) => void;

class PoolState {
  private l1Token: string | undefined = undefined;
  constructor(
    private batchRead: BatchReadWithErrorsType,
    private contract: bridgePool.Instance,
    private address: string
  ) {}
  public async read(latestBlock: number, previousBlock?: number) {
    if (this.l1Token === undefined) this.l1Token = await this.contract.l1Token();
    // typechain does not have complete types for call options, so we have to cast blockTag to any
    const exchangeRatePrevious = await this.contract.callStatic.exchangeRateCurrent({
      blockTag: previousBlock || latestBlock - 1,
    } as any);

    return {
      address: this.address,
      l1Token: this.l1Token,
      exchangeRatePrevious,
      ...(await this.batchRead<{
        exchangeRateCurrent: BigNumber;
        liquidityUtilizationCurrent: BigNumber;
        liquidReserves: BigNumber;
        pendingReserves: BigNumber;
        utilizedReserves: BigNumber;
      }>([
        // its important exchangeRateCurrent is called first, as it calls _sync under the hood which updates the contract
        // and gives more accurate values for the following properties.
        ["exchangeRateCurrent"],
        ["liquidityUtilizationCurrent"],
        ["liquidReserves"],
        ["pendingReserves"],
        ["utilizedReserves"],
      ])),
    };
  }
}

type EventIdParams = { blockNumber: number; transactionIndex: number; logIndex: number };
export class PoolEventState {
  private seen = new Set<string>();
  private iface: ethers.utils.Interface;
  constructor(
    private contract: bridgePool.Instance,
    private startBlock = 0,
    private state: bridgePool.EventState = bridgePool.eventStateDefaults()
  ) {
    this.iface = new ethers.utils.Interface(bridgePool.Factory.abi);
  }
  private makeId(params: EventIdParams) {
    return [params.blockNumber, params.transactionIndex, params.logIndex].join("!");
  }
  hasEvent(params: EventIdParams) {
    return this.seen.has(this.makeId(params));
  }
  private addEvent(params: EventIdParams) {
    return this.seen.add(this.makeId(params));
  }
  private filterSeen = (params: EventIdParams) => {
    const seen = this.hasEvent(params);
    if (!seen) this.addEvent(params);
    return !seen;
  };
  public async read(endBlock: number, userAddress?: string) {
    if (endBlock <= this.startBlock) return this.state;
    const events = (
      await Promise.all([
        ...(await this.contract.queryFilter(
          this.contract.filters.LiquidityAdded(undefined, undefined, userAddress),
          this.startBlock,
          endBlock
        )),
        ...(await this.contract.queryFilter(
          this.contract.filters.LiquidityRemoved(undefined, undefined, userAddress),
          this.startBlock,
          endBlock
        )),
      ])
    )
      .filter(this.filterSeen)
      .sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex - b.transactionIndex;
        if (a.logIndex !== b.logIndex) a.logIndex - b.logIndex;
        // if everything is the same, return a, ie maintain order of array
        return -1;
      });
    // ethers queries are inclusive [start,end] unless start === end, then exclusive (start,end). we increment to make sure we dont see same event twice
    this.startBlock = endBlock + 1;
    this.state = bridgePool.getEventState(events, this.state);
    return this.state;
  }
  makeEventFromLog(log: Log) {
    const description = this.iface.parseLog(log);
    return {
      ...log,
      ...description,
      event: description.name,
      eventSignature: description.signature,
    };
  }
  readTxReceipt(receipt: TransactionReceipt) {
    const events = receipt.logs
      .map((log) => {
        try {
          return this.makeEventFromLog(log);
        } catch (err) {
          // return nothing, this throws a lot because logs from other contracts are included in receipt
          return;
        }
      })
      // filter out undefined
      .filter(exists)
      .filter(this.filterSeen);

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

export function calculateRemoval(amountWei: BigNumber, percentWei: BigNumber) {
  const receive = amountWei.mul(percentWei).div(fixedPointAdjustment);
  const remain = amountWei.sub(receive);
  return {
    recieve: receive.toString(),
    remain: remain.toString(),
  };
}
// params here mimic the user object type
export function previewRemoval(
  values: { positionValue: BigNumberish; feesEarned: BigNumberish; totalDeposited: BigNumberish },
  percentFloat: number
) {
  const percentWei = toBNWei(percentFloat);
  return {
    position: {
      ...calculateRemoval(BigNumber.from(values.totalDeposited), percentWei),
    },
    fees: {
      ...calculateRemoval(BigNumber.from(values.feesEarned), percentWei),
    },
    total: {
      ...calculateRemoval(BigNumber.from(values.positionValue), percentWei),
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
function joinPoolState(
  poolState: Awaited<ReturnType<PoolState["read"]>>,
  latestBlock: Block,
  previousBlock: Block,
  rateModel?: RateModel
): Pool {
  const totalPoolSize = poolState.liquidReserves.add(poolState.utilizedReserves);
  const secondsElapsed = latestBlock.timestamp - previousBlock.timestamp;
  const blocksElapsed = latestBlock.number - previousBlock.number;
  const exchangeRatePrevious = poolState.exchangeRatePrevious.toString();
  const exchangeRateCurrent = poolState.exchangeRateCurrent.toString();

  const estimatedApy = calcPeriodicCompoundInterest(
    exchangeRatePrevious,
    exchangeRateCurrent,
    secondsElapsed,
    SECONDS_PER_YEAR
  );
  const estimatedApr = calcApr(exchangeRatePrevious, exchangeRateCurrent, secondsElapsed, SECONDS_PER_YEAR);
  let projectedApr = "";

  if (rateModel) {
    projectedApr = fromWei(
      calculateInstantaneousRate(rateModel, poolState.liquidityUtilizationCurrent)
        .mul(poolState.liquidityUtilizationCurrent)
        .div(fixedPointAdjustment)
    );
  }

  return {
    address: poolState.address,
    totalPoolSize: totalPoolSize.toString(),
    l1Token: poolState.l1Token,
    liquidReserves: poolState.liquidReserves.toString(),
    pendingReserves: poolState.pendingReserves.toString(),
    exchangeRateCurrent: poolState.exchangeRateCurrent.toString(),
    exchangeRatePrevious: poolState.exchangeRatePrevious.toString(),
    estimatedApy,
    estimatedApr,
    blocksElapsed,
    secondsElapsed,
    liquidityUtilizationCurrent: poolState.liquidityUtilizationCurrent.toString(),
    projectedApr,
    utilizedReserves: poolState.utilizedReserves.toString(),
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
  private intervalStarted = false;
  private rateModelInstance: rateModelStore.Instance;
  constructor(private config: Config, private deps: Dependencies, private emit: EmitState) {
    this.multicall = new Multicall2(config.multicall2Address, deps.provider);
    this.batchRead = BatchReadWithErrors(this.multicall);
    this.rateModelInstance = rateModelStore.connect(config.rateModelStoreAddress || ADDRESSES.RateModel, deps.provider);
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
    const txman = TransactionManager({ confirmations: this.config.confirmations }, signer, (event, id, data) => {
      if (event === "submitted") {
        this.state.transactions[id].state = event;
        this.state.transactions[id].hash = data as string;
        this.emit(["transactions", id], { ...this.state.transactions[id] });
      }
      if (event === "mined") {
        const txReceipt = data as TransactionReceipt;
        this.state.transactions[id].state = event;
        this.state.transactions[id].receipt = txReceipt;
        this.emit(["transactions", id], { ...this.state.transactions[id] });
        // trigger pool and user update for a known mined transaction
        const tx = this.state.transactions[id];
        this.updatePool(tx.toAddress)
          .then(() => {
            return this.updateUserWithTransaction(tx.fromAddress, tx.toAddress, txReceipt);
          })
          .catch((err) => {
            this.emit(["error"], err);
          });
      }
      if (event === "error") {
        this.state.transactions[id].state = event;
        this.state.transactions[id].error = data as Error;
        this.emit(["transactions", id], { ...this.state.transactions[id] });
      }
    });
    this.transactionManagers[address] = txman;
    return txman;
  }
  async addEthLiquidity(signer: Signer, pool: string, l1TokenAmount: BigNumberish, overrides: Overrides = {}) {
    const userAddress = await signer.getAddress();
    const contract = this.getOrCreatePoolContract(pool);
    const txman = this.getOrCreateTransactionManager(signer, userAddress);

    // dont allow override value here
    const request = await contract.populateTransaction.addLiquidity(l1TokenAmount, {
      ...overrides,
      value: l1TokenAmount,
    });
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
    this.emit(["transactions", id], { ...this.state.transactions[id] });
    await txman.update();
    return id;
  }
  async addTokenLiquidity(signer: Signer, pool: string, l1TokenAmount: BigNumberish, overrides: Overrides = {}) {
    const userAddress = await signer.getAddress();
    const contract = this.getOrCreatePoolContract(pool);
    const txman = this.getOrCreateTransactionManager(signer, userAddress);

    const request = await contract.populateTransaction.addLiquidity(l1TokenAmount, overrides);
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

    this.emit(["transactions", id], { ...this.state.transactions[id] });
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
  async removeTokenLiquidity(signer: Signer, pool: string, lpTokenAmount: BigNumberish, overrides: Overrides = {}) {
    const userAddress = await signer.getAddress();
    await this.validateWithdraw(pool, userAddress, lpTokenAmount);
    const contract = this.getOrCreatePoolContract(pool);
    const txman = this.getOrCreateTransactionManager(signer, userAddress);

    const request = await contract.populateTransaction.removeLiquidity(lpTokenAmount, false, overrides);
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

    this.emit(["transactions", id], { ...this.state.transactions[id] });
    await txman.update();
    return id;
  }
  async removeEthliquidity(signer: Signer, pool: string, lpTokenAmount: BigNumberish, overrides: Overrides = {}) {
    const userAddress = await signer.getAddress();
    await this.validateWithdraw(pool, userAddress, lpTokenAmount);
    const contract = this.getOrCreatePoolContract(pool);
    const txman = this.getOrCreateTransactionManager(signer, userAddress);

    const request = await contract.populateTransaction.removeLiquidity(lpTokenAmount, true, overrides);
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
    this.emit(["transactions", id], { ...this.state.transactions[id] });
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
  private async updateUserWithTransaction(userAddress: string, poolAddress: string, txReceipt: TransactionReceipt) {
    const contract = this.getOrCreatePoolContract(poolAddress);
    if (!this.hasPool(poolAddress)) {
      await this.updatePool(poolAddress);
    }
    const poolState = this.getPool(poolAddress);
    const getUserState = new UserState(contract);
    const getPoolEventState = this.getOrCreatePoolEvents(poolAddress);
    const userState = await getUserState.read(userAddress);
    const eventState = await getPoolEventState.readTxReceipt(txReceipt);
    set(this.state, ["users", userAddress, poolAddress], joinUserState(poolState, eventState, userState));
    this.emit(["users", userAddress, poolAddress], this.state.users[userAddress][poolAddress]);
  }
  async updateUser(userAddress: string, poolAddress: string) {
    const contract = this.getOrCreatePoolContract(poolAddress);
    if (!this.hasPool(poolAddress)) {
      await this.updatePool(poolAddress);
    }
    const poolState = this.getPool(poolAddress);
    const latestBlock = (await this.deps.provider.getBlock("latest")).number;
    const getUserState = new UserState(contract);
    const getPoolEventState = this.getOrCreatePoolEvents(poolAddress);
    const userState = await getUserState.read(userAddress);
    const eventState = await getPoolEventState.read(latestBlock, userAddress);
    set(this.state, ["users", userAddress, poolAddress], joinUserState(poolState, eventState, userState));
    this.emit(["users", userAddress, poolAddress], this.state.users[userAddress][poolAddress]);
  }
  async updatePool(poolAddress: string) {
    // default to 100 block delta unless specified otherwise in config
    const { blockDelta = DEFAULT_BLOCK_DELTA } = this.config;
    const contract = this.getOrCreatePoolContract(poolAddress);
    const pool = new PoolState(this.batchRead(contract), contract, poolAddress);
    const latestBlock = await this.deps.provider.getBlock("latest");
    const previousBlock = await this.deps.provider.getBlock(latestBlock.number - blockDelta);
    const state = await pool.read(latestBlock.number, previousBlock.number);

    let rateModel: RateModel | undefined = undefined;
    try {
      const rateModelRaw = await this.rateModelInstance.callStatic.l1TokenRateModels(state.l1Token);
      rateModel = parseAndReturnRateModelFromString(rateModelRaw);
    } catch (err) {
      // we could swallow this error or just log it since getting the rate model is optional,
      // but we will just emit it to the caller and let them decide what to do with it.
      this.emit(["error"], err);
    }

    this.state.pools[poolAddress] = joinPoolState(state, latestBlock, previousBlock, rateModel);
    this.emit(["pools", poolAddress], this.state.pools[poolAddress]);
  }
  async updateTransactions() {
    for (const txMan of Object.values(this.transactionManagers)) {
      try {
        await txMan.update();
      } catch (err) {
        this.emit(["error"], err);
      }
    }
  }
  // starts transaction checking intervals, defaults to 30 seconds
  async startInterval(delayMs = 30000) {
    assert(!this.intervalStarted, "Interval already started, try stopping first");
    this.intervalStarted = true;
    loop(async () => {
      assert(this.intervalStarted, "Bridgepool Interval Stopped");
      await this.updateTransactions();
    }, delayMs).catch((err) => {
      this.emit(["error"], err);
    });
  }
  // starts transaction checking intervals
  async stopInterval() {
    this.intervalStarted = false;
  }
}
