import { bridgePool } from "../../clients";
import { providers, BigNumber } from "ethers";
import { toBNWei, fixedPointAdjustment, calcInterest, calcApy, fromWei } from "../utils";
import { BatchReadWithErrors } from "../../utils";
import Multicall2 from "../../multicall2";

export type Provider = providers.Provider | providers.BaseProvider;

type BatchReadWithErrorsType = ReturnType<ReturnType<typeof BatchReadWithErrors>>;
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

// this is a rough estimation of blocks per day from: https://ycharts.com/indicators/ethereum_blocks_per_day
// may be able to replace with dynamic value https://docs.etherscan.io/api-endpoints/blocks#get-daily-block-count-and-rewards
const BLOCKS_PER_YEAR = 6359 * 365;
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

type Awaited<T> = T extends PromiseLike<infer U> ? U : T;
export class ReadClient {
  private poolEventState: PoolEventState;
  private poolState: PoolState;
  private userState: UserState;
  private multicall: Multicall2;
  private contract: bridgePool.Instance;
  private batchRead: BatchReadWithErrorsType;
  constructor(private address: string, private provider: Provider, private multicallAddress: string) {
    this.multicall = new Multicall2(multicallAddress, provider);
    this.contract = bridgePool.connect(address, provider);
    this.batchRead = BatchReadWithErrors(this.multicall)(this.contract);
    this.poolEventState = new PoolEventState(this.contract);
    this.poolState = new PoolState(this.batchRead, this.contract, address);
    this.userState = new UserState(this.contract);
  }
  static joinUserState(
    poolState: Awaited<ReturnType<PoolState["read"]>>,
    eventState: bridgePool.EventState,
    userState: Awaited<ReturnType<UserState["read"]>>
  ) {
    const positionValue = poolState.exchangeRateCurrent.mul(userState.balanceOf).div(fixedPointAdjustment);
    const totalDeposited = BigNumber.from(eventState.tokens[userState.address] || "0");
    const feesEarned = positionValue.sub(totalDeposited);
    return {
      address: userState.address,
      lpTokens: userState.balanceOf.toString(),
      positionValue: positionValue.toString(),
      totalDeposited: totalDeposited.toString(),
      feesEarned: feesEarned.toString(),
    };
  }
  static joinPoolState(poolState: Awaited<ReturnType<PoolState["read"]>>) {
    const totalPoolSize = poolState.liquidReserves.add(poolState.pendingReserves).add(poolState.utilizedReserves);
    const estimatedApy = calculateApy(poolState.exchangeRateCurrent, poolState.exchangeRatePrevious);
    return {
      address: poolState.address,
      totalPoolSize: totalPoolSize.toString(),
      l1Token: poolState.l1Token,
      exchangeRateCurrent: poolState.exchangeRateCurrent.toString(),
      exchangeRatePrevious: poolState.exchangeRatePrevious.toString(),
      estimatedApy,
    };
  }
  static joinState(
    poolState: Awaited<ReturnType<PoolState["read"]>>,
    eventState?: bridgePool.EventState,
    userState?: Awaited<ReturnType<UserState["read"]>>
  ) {
    if (!userState || !eventState) return { pool: ReadClient.joinPoolState(poolState) };
    return {
      user: ReadClient.joinUserState(poolState, eventState, userState),
      pool: ReadClient.joinPoolState(poolState),
    };
  }
  public async read(user?: string) {
    const latestBlock = (await this.provider.getBlock("latest")).number;
    const poolState = await this.poolState.read(latestBlock);
    const eventState = user ? await this.poolEventState.read(latestBlock, user) : undefined;
    const userState = user ? await this.userState.read(user) : undefined;
    return ReadClient.joinState(poolState, eventState, userState);
  }
}
