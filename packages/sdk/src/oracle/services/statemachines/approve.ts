import assert from "assert";
import { Update } from "../update";
import Store from "../../store";
import { Signer } from "../../types/ethers";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ContextClient } from "./utils";

export type Params = {
  currency: string;
  chainId: number;
  signer: Signer;
  account: string;
  spender: string;
  amount: string;
  confirmations: number;
  checkTxIntervalSec: number;
};

export type Memory = { hash?: string };

export function initMemory(): Memory {
  return {};
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory) {
      const { chainId, currency, spender, amount, account, signer } = params;
      assert(chainId === (await signer.getChainId()), "Signer on wrong chainid");
      assert(account === (await signer.getAddress()), "Signer on wrong account");

      // create service if it does not exist
      store.write((w) => w.services(chainId).erc20s(currency));
      const erc20 = store.read().tokenService(chainId, currency);
      const tx = await erc20.approve(signer, spender, amount);
      memory.hash = tx.hash;
      return "confirm";
    },
    async confirm(params: Params, memory: Memory, context: ContextClient) {
      const { chainId, confirmations, checkTxIntervalSec } = params;
      const { hash } = memory;
      assert(hash, "requires hash");
      if (await update.isConfirmed(chainId, hash, confirmations)) {
        return "update";
      }
      // wait x seconds before running this state again
      return context.sleep(checkTxIntervalSec * 1000);
    },
    async update(params: Params) {
      const { chainId, currency, spender, account } = params;
      await update.balance(chainId, currency, account);
      await update.allowance(chainId, currency, account, spender);
      return "done";
    },
  };
}
