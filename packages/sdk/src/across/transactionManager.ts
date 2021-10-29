import assert from "assert";
import { Signer } from "ethers";
import { TransactionRequest, TransactionReceipt } from "@ethersproject/abstract-provider";

export type Emit = (event: string, key: string, data: TransactionReceipt | string | TransactionRequest) => void;
export default (signer: Signer, emit: Emit = () => null) => {
  assert(signer.provider, "signer requires a provider, use signer.connect(provider)");
  const requests = new Map<string, TransactionRequest>();
  const submissions = new Map<string, string>();
  const mined = new Map<string, TransactionReceipt>();
  async function request(unsignedTx: TransactionRequest) {
    const populated = await signer.populateTransaction(unsignedTx);
    const key = JSON.stringify(populated);
    requests.set(key, populated);
    emit("requested", key, populated);
    return key;
  }
  async function processRequest(key: string) {
    const request = requests.get(key);
    assert(request, "invalid request");
    const sent = await signer.sendTransaction(request);
    requests.delete(key);
    submissions.set(key, sent.hash);
    emit("submitted", key, sent.hash);
  }
  async function processSubmission(key: string) {
    const hash = submissions.get(key);
    assert(hash, "invalid submission");
    assert(signer.provider, "signer requires a provider, use signer.connect(provider)");
    const receipt = await signer.provider.getTransactionReceipt(hash).catch(() => undefined);
    if (receipt == null) return;
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
