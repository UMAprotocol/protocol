// this file is meant to handle events from various contracts.
// its mainly documenting all events based on uniswap typechain build output.
import { Positions, Position } from "./models";
import { exists, convertValuesToString } from "./utils";
import assert from "assert";
import { BigNumberish } from "ethers";
import { Event } from "@ethersproject/contracts/lib/";

const HandleEvent = (handlers: { [key: string]: (...args: any[]) => Promise<void> }) => async (event: Event) => {
  assert(event.event, "requires event name");
  assert(event.args, "requires event args");
  // ignore events without handlers
  if (handlers[event.event] == null) return;
  try {
    await handlers[event.event](...event.args, event.blockNumber);
  } catch (err) {
    console.error(event);
    throw err;
  }
};

export function PoolEvents({ positions }: { positions: ReturnType<typeof Positions> }) {
  const handlers: { [key: string]: (...args: any[]) => Promise<void> } = {
    async Mint(
      sender: string | null,
      owner: string | null,
      tickLower: BigNumberish | null,
      tickUpper: BigNumberish | null,
      amount: null,
      amount0: null,
      amount1: null,
      blockNumber: number
    ) {
      assert(exists(owner), "requires owner");
      assert(exists(tickLower), "requires tickLower");
      assert(exists(tickUpper), "requires tickUpper");
      await positions.create(
        convertValuesToString<Position>({
          operator: owner,
          sender: sender,
          tickLower: tickLower,
          tickUpper: tickUpper,
          blockCreated: blockNumber
        })
      );
    }
  };
  return HandleEvent(handlers);
}
