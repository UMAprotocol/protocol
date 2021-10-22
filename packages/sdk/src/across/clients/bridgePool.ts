import { bridgePool } from "../../clients";
import { providers, BigNumber } from "ethers";
import { toBNWei, fixedPointAdjustment } from "../utils";
import { BatchReadWithErrors } from "../../utils";
import Multicall2 from "../../multicall2";

export type Provider = providers.Provider | providers.BaseProvider;

type BatchReadWithErrorsType = ReturnType<ReturnType<typeof BatchReadWithErrors>>;
const PoolState = async (read: BatchReadWithErrorsType) => {
  const { l1Token } = await read([["l1Token"]]);
  return async () => {
    return {
      l1Token,
      ...(await read([["liquidReserves"], ["pendingReserves"], ["utilizedReserves"], ["exchangeRateCurrent"]])),
    };
  };
};
const PoolEventState = (
  contract: bridgePool.Instance,
  startBlock = 0,
  state: bridgePool.EventState = bridgePool.eventStateDefaults()
) => {
  return async (endBlock: number) => {
    if (endBlock <= startBlock) return state;
    const events = (
      await Promise.all([
        ...(await contract.queryFilter(contract.filters.LiquidityAdded(), startBlock, endBlock)),
        ...(await contract.queryFilter(contract.filters.LiquidityRemoved(), startBlock, endBlock)),
      ])
    ).sort((a, b) => {
      if (a.blockNumber < b.blockNumber) return -1;
      if (a.transactionIndex < b.transactionIndex) return -1;
      if (a.logIndex < b.logIndex) return -1;
      return 1;
    });
    startBlock = endBlock;
    state = bridgePool.getEventState(events, state);
    return state;
  };
};

const UserState = (read: BatchReadWithErrorsType) => async (user: string) => {
  return {
    address: user,
    ...(await read([["balanceOf", user]])),
  };
};

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
export const ReadClient = async (address: string, provider: Provider, multicallAddress: string) => {
  const multicall = new Multicall2(multicallAddress, provider);
  const contract = bridgePool.connect(address, provider);
  const batchRead = BatchReadWithErrors(multicall)(contract);
  const getEventState = await PoolEventState(contract);
  const getPoolState = await PoolState(batchRead);
  const getUserState = await UserState(batchRead);

  function joinUserState(
    poolState: Awaited<ReturnType<typeof getPoolState>>,
    eventState: bridgePool.EventState,
    userState: Awaited<ReturnType<typeof getUserState>>
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
  function joinPoolState(poolState: Awaited<ReturnType<typeof getPoolState>>) {
    const totalPoolSize = poolState.liquidReserves.add(poolState.pendingReserves).add(poolState.utilizedReserves);
    return {
      address,
      totalPoolSize: totalPoolSize.toString(),
      l1Token: poolState.l1Token,
    };
  }
  function joinState(
    poolState: Awaited<ReturnType<typeof getPoolState>>,
    eventState: bridgePool.EventState,
    userState?: Awaited<ReturnType<typeof getUserState>>
  ) {
    if (!userState) return { pool: joinPoolState(poolState) };
    return {
      user: joinUserState(poolState, eventState, userState),
      pool: joinPoolState(poolState),
    };
  }

  return async (user?: string) => {
    const latestBlock = (await provider.getBlock("latest")).number;
    const poolState = await getPoolState();
    const eventState = await getEventState(latestBlock);
    const userState = user ? await getUserState(user) : undefined;
    return joinState(poolState, eventState, userState);
  };
};
