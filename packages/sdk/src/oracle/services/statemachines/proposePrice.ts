import assert from "assert";
import { Update } from "../update";
import Store from "../../store";
import { Signer } from "../../types/ethers";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { InputRequest } from "../../types/state";
import { ContextClient } from "./utils";

export type Params = InputRequest & {
  signer: Signer;
  confirmations: number;
  currency: string;
  account: string;
  proposedPrice: string;
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
      const { requester, identifier, timestamp, ancillaryData, chainId, signer, proposedPrice } = params;
      assert(chainId === (await signer.getChainId()), "Signer on wrong chainid");
      const oracle = store.read().oracleService(chainId);
      const tx = await oracle.proposePrice(signer, requester, identifier, timestamp, ancillaryData, proposedPrice);
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
      const { chainId, currency, account } = params;
      await update.balance(chainId, currency, account);
      await update.request(params);
      return "done";
    },
  };
}
