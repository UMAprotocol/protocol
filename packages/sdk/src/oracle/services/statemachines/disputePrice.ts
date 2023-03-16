import assert from "assert";
import { Update } from "../update";
import Store from "../../store";
import { Signer, TransactionReceipt } from "../../types/ethers";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { InputRequest } from "../../types/state";
import { ContextClient } from "./utils";

export type Params = InputRequest & {
  signer: Signer;
  confirmations: number;
  currency: string;
  account: string;
  checkTxIntervalSec: number;
};

export type Memory = { hash?: string; receipt?: TransactionReceipt };

export function initMemory(): Memory {
  return {};
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory) {
      const { requester, identifier, timestamp, ancillaryData, chainId, signer } = params;
      assert(chainId === (await signer.getChainId()), "Signer on wrong chainid");

      const oracle = store.read().oracleService(chainId);
      const tx = await oracle.disputePrice(signer, { requester, identifier, timestamp, ancillaryData });
      memory.hash = tx.hash;
      return "confirm";
    },
    async confirm(params: Params, memory: Memory, context: ContextClient) {
      const { chainId, confirmations, checkTxIntervalSec } = params;
      const { hash } = memory;
      assert(hash, "requires hash");
      const receipt = await update.isConfirmed(chainId, hash, confirmations);
      if (receipt) {
        memory.receipt = receipt as TransactionReceipt;
        return "update";
      }
      // wait x seconds before running this state again
      return context.sleep(checkTxIntervalSec * 1000);
    },
    async update(params: Params, memory: Memory) {
      const { chainId, currency, account } = params;
      const { receipt } = memory;
      const oracle = store.read().oracleService(chainId);
      await update.balance(chainId, currency, account);
      if (receipt) {
        oracle.updateFromTransactionReceipt(receipt);
      }
      store.write((w) => {
        w.chains(chainId).optimisticOracle().request(oracle.getRequest(params));
      });
      update.sortedRequests(chainId);
      return "done";
    },
  };
}
