// this file is meant to handle events from various contracts.
// its mainly documenting all events based on uniswap typechain build output.
import { Positions, Pools } from "./models";
import { exists } from "./utils";
import assert from "assert";
import { BigNumberish } from "ethers";

type Event = {
  event: string;
  args: any[];
};

type PoolsType = ReturnType<typeof Pools>;

export function NftEvents({ positions }: { positions: ReturnType<typeof Positions> }) {
  const handlers: { [key: string]: (...args: any[]) => Promise<void> } = {
    async Approval(owner: string | null, approved: string | null, tokenId: BigNumberish | null) {
      // nothing
    },
    async ApprovalForAll(owner: string | null, operator: string | null, approved: null) {
      // nothing
    },
    async Collect(
      tokenId: BigNumberish | null,
      recipient: string | null,
      amount0: BigNumberish | null,
      amount1: BigNumberish | null
    ) {
      // nothing
    },
    async DecreaseLiquidity(
      tokenId: BigNumberish | null,
      liquidity: BigNumberish | null,
      amount0: BigNumberish | null,
      amount1: BigNumberish | null
    ) {
      assert(exists(tokenId), "requires token id");
      assert(exists(liquidity), "requires liquidity");
      assert(exists(amount0), "requires amount0");
      assert(exists(amount1), "requires amount1");
      await positions.update(tokenId.toString(), {
        liquidity: liquidity.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString()
      });
    },
    async IncreaseLiquidity(
      tokenId: BigNumberish | null,
      liquidity: BigNumberish | null,
      amount0: BigNumberish | null,
      amount1: BigNumberish | null
    ) {
      assert(exists(tokenId), "requires token id");
      assert(exists(liquidity), "requires liquidity");
      assert(exists(amount0), "requires amount0");
      assert(exists(amount1), "requires amount1");

      await positions.update(tokenId.toString(), {
        liquidity: liquidity.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString()
      });
    },
    async Transfer(from: string | null, to: string | null, tokenId: BigNumberish | null) {
      // nothing
    }
  };
  async function handleEvent(event: Event) {
    assert(handlers[event.event], "No handler for event: " + event.event);
    handlers[event.event](...event.args);
  }
  return {
    handleEvent,
    positions
  };
}

export function PoolEvents({
  positions,
  id,
  pools
}: {
  positions: ReturnType<typeof Positions>;
  pools: PoolsType;
  id: string;
}) {
  const handlers: { [key: string]: (...args: any[]) => Promise<void> } = {
    async Burn(
      owner: string | null,
      tickLower: BigNumberish | null,
      tickUpper: BigNumberish | null,
      amount: null,
      amount0: null,
      amount1: null
    ) {
      // nothing
    },
    async Collect(
      owner: string | null,
      recipient: null,
      tickLower: BigNumberish | null,
      tickUpper: BigNumberish | null,
      amount0: null,
      amount1: null
    ) {
      // nothing
    },
    async CollectProtocol(sender: string | null, recipient: string | null, amount0: null, amount1: null) {
      // nothing
    },

    async Flash(
      sender: string | null,
      recipient: string | null,
      amount0: null,
      amount1: null,
      paid0: null,
      paid1: null
    ) {
      // nothing
    },

    async IncreaseObservationCardinalityNext(observationCardinalityNextOld: null, observationCardinalityNextNew: null) {
      // nothing
    },

    async Initialize(sqrtPriceX96: null, tick: null) {
      // nothing
    },

    async Mint(
      sender: null,
      owner: string | null,
      tickLower: BigNumberish | null,
      tickUpper: BigNumberish | null,
      amount: null,
      amount0: null,
      amount1: null
    ) {
      assert(exists(owner), "requires owner");
      assert(exists(tickLower), "requires tickLower");
      assert(exists(tickUpper), "requires tickUpper");
      await positions.create({
        operator: owner,
        tickLower: tickLower.toString(),
        tickUpper: tickUpper.toString()
      });
    },

    async SetFeeProtocol(feeProtocol0Old: null, feeProtocol1Old: null, feeProtocol0New: null, feeProtocol1New: null) {
      // nothing
    },

    async Swap(
      sender: string | null,
      recipient: string | null,
      amount0: BigNumberish | null,
      amount1: BigNumberish | null,
      sqrtPriceX96: BigNumberish | null,
      tick: BigNumberish | null
    ) {
      assert(exists(sqrtPriceX96), "requires price");
      assert(exists(tick), "requires tick");
      await pools.update(id, { tick, sqrtPriceX96: sqrtPriceX96.toString() });
    }
  };
  async function handleEvent(event: Event) {
    assert(handlers[event.event], "No handler for event: " + event.event);
    try {
      await handlers[event.event](...event.args);
    } catch (err) {
      console.error(event);
      throw err;
    }
  }
  return {
    handleEvent,
    pools,
    positions
  };
}

export function PoolFactory({ positions, pools }: { positions: ReturnType<typeof Positions>; pools: PoolsType }) {
  const handlers: { [key: string]: (...args: any[]) => Promise<void> } = {
    async FeeAmountEnabled(fee: BigNumberish | null, tickSpacing: BigNumberish | null) {
      // nothing
    },
    async OwnerChanged(oldOwner: string | null, newOwner: string | null) {
      // nothing
    },
    async PoolCreated(
      token0: string | null,
      token1: string | null,
      fee: BigNumberish | null,
      tickSpacing: BigNumberish | null,
      pool: string | null
    ) {
      assert(token0, "requires token 0");
      assert(token1, "requires token 1");
      assert(fee, "requires fee");
      assert(pool, "requires pool");
      await pools.create({
        token0,
        token1,
        fee: fee.toString(),
        address: pool
      });
    }
  };
  async function handleEvent(event: Event) {
    assert(handlers[event.event], "No handler for event: " + event.event);
    try {
      await handlers[event.event](...event.args);
    } catch (err) {
      console.log(event);
      throw err;
    }
  }
  return {
    handleEvent,
    positions
  };
}
