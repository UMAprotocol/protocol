import assert from "assert";
import { Signer } from "ethers";
import { TransactionRequest, TransactionReceipt } from "@ethersproject/abstract-provider";

function makeKey(tx: TransactionRequest) {
  return JSON.stringify(
    Object.entries(tx).map(([key, value]) => {
      return [key, (value || "").toString()];
    })
  );
}

type Config = {
  confirmations?: number;
};
export type Emit = (event: string, key: string, data: TransactionReceipt | string | TransactionRequest | Error) => void;
export default (config: Config, signer: Signer, emit: Emit = () => null) => {
  assert(signer.provider, "signer requires a provider, use signer.connect(provider)");
  const { confirmations = 3 } = config;
  const requests = new Map<string, TransactionRequest>();
  const submissions = new Map<string, string>();
  const mined = new Map<string, TransactionReceipt>();
  function request(unsignedTx: TransactionRequest) {
    // this no longer calls signer.populateTransaction, to allow metamask to fill in missing details instead
    // use overrides if you want to manually fill in other tx details, including the overrides.customData field.
    const populated = unsignedTx;
    const key = makeKey(populated);
    assert(!requests.has(key), "Transaction already in progress");
    requests.set(key, populated);
    return key;
  }
  async function processRequest(key: string) {
    const request = requests.get(key);
    assert(request, "invalid request");
    // always delete request, it should only be submitted once
    requests.delete(key);
    try {
      const sent = await signer.sendTransaction(request);
      submissions.set(key, sent.hash);
      emit("submitted", key, sent.hash);
    } catch (err) {
      emit("error", key, err as Error);
    }
  }
  async function processSubmission(key: string) {
    const hash = submissions.get(key);
    assert(hash, "invalid submission");
    assert(signer.provider, "signer requires a provider, use signer.connect(provider)");
    // we look for this transaction, but it may never find it if its sped up
    const receipt = await signer.provider.getTransactionReceipt(hash).catch(() => undefined);
    if (receipt == null) return;
    if (receipt.confirmations < confirmations) return;
    submissions.delete(key);
    mined.set(key, receipt);
    emit("mined", key, receipt);
  }
  async function isMined(key: string) {
    return mined.get(key);
  }
  async function update() {
    for (const key of requests.keys()) {
      await processRequest(key);
    }
    for (const key of submissions.keys()) {
      await processSubmission(key);
    }
  }
  return {
    request,
    isMined,
    update,
  };
};
