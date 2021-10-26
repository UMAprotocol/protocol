import { bridgePool } from "../../clients";
import { providers, BigNumber } from "ethers";
import { toBNWei, fixedPointAdjustment } from "../utils";
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
  public async read() {
    if (this.l1Token === undefined) this.l1Token = await this.contract.l1Token();
    return {
      address: this.address,
      l1Token: this.l1Token,
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
  public async read(endBlock: number) {
    if (endBlock <= this.startBlock) return this.state;
    const events = (
      await Promise.all([
        ...(await this.contract.queryFilter(this.contract.filters.LiquidityAdded(), this.startBlock, endBlock)),
        ...(await this.contract.queryFilter(this.contract.filters.LiquidityRemoved(), this.startBlock, endBlock)),
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
    return {
      address: poolState.address,
      totalPoolSize: totalPoolSize.toString(),
      l1Token: poolState.l1Token,
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
    const poolState = await this.poolState.read();
    const eventState = user ? await this.poolEventState.read(latestBlock) : undefined;
    const userState = user ? await this.userState.read(user) : undefined;
    return ReadClient.joinState(poolState, eventState, userState);
  }
}
