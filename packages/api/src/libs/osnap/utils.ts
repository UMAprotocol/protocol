import assert from "assert";
import { Json } from "../../types";
import type { OsnapPluginData, Transaction } from "./interfaces";
import { simulateTenderlyTx, TenderlySimulationParams } from "@uma/common";

export async function simulateOsnapTx(space: OsnapPluginData, transactionIndex = 0): Promise<Json> {
  const { safe } = space;
  assert(safe, "Requires a safe");
  const { network, transactions } = safe;
  assert(transactions.length > transactionIndex, "Cannot simulate not existent transaction");

  // we only expect a single tx
  const transaction = transactions[transactionIndex];
  const simParams = mapOsnapTxToTenderlySim(transaction, Number(network));
  // we are passing the result straight to express, so we are casting this as json. this is fully
  // compatible with json type since all values are primitives.
  return ((await simulateTenderlyTx(simParams)) as unknown) as Json;
}
export function mapOsnapTxToTenderlySim(tx: Transaction, chainId: number): TenderlySimulationParams {
  return {
    chainId,
    to: tx.to,
    // TODO: Need to encode executeProposal here
    input: tx.data,
    // TODO: figure out state overrides here
    // state_objects: {},
  };
}
