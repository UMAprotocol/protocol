import { strict as assert } from "assert";
import { BigNumber, Contract, providers, utils } from "ethers";
import { ADDRESSES, assertAddress, polygonCalls } from "./common";

export const STATE_RECEIVER = "0x0000000000000000000000000000000000001001";
export const stateInterface = new utils.Interface([
  "event StateSynced(uint256 indexed id, address indexed contractAddress, bytes data)",
  "event StateCommitted(uint256 indexed stateId, bool success)",
]);

interface StateSyncMessage {
  id: BigNumber;
  contractAddress: string;
  data: string;
}

// Validate the authenticated L1 messages against this proposal before using their IDs for discovery.
export function decodeStateSyncMessages(
  receipt: providers.TransactionReceipt,
  stateSender: string,
  fxChild: string
): StateSyncMessage[] {
  assert.equal(receipt.status, 1, "L1 execution failed");
  const messages = receipt.logs
    .filter(
      (log) =>
        log.address.toLowerCase() === stateSender.toLowerCase() &&
        log.topics[0] === stateInterface.getEventTopic("StateSynced")
    )
    .map((log) => {
      const { id, contractAddress, data } = stateInterface.parseLog(log).args;
      return { id, contractAddress, data };
    });
  const calls = polygonCalls();
  assert.equal(messages.length, calls.length, "Expected four Polygon state-sync messages");
  assert.equal(
    new Set(messages.map((message) => message.id.toString())).size,
    calls.length,
    "Duplicate state-sync IDs"
  );
  messages.forEach((message, i) => {
    assertAddress(message.contractAddress, fxChild, "Unexpected state-sync receiver");
    const [root, child, data] = utils.defaultAbiCoder.decode(["address", "address", "bytes"], message.data);
    assertAddress(root, ADDRESSES.root, "Unexpected state-sync root");
    assertAddress(child, ADDRESSES.child, "Unexpected state-sync child");
    assert.equal(
      data,
      utils.defaultAbiCoder.encode(["address", "bytes"], [calls[i].to, calls[i].data]),
      "Unexpected state-sync payload"
    );
  });
  return messages;
}

export async function getStateSyncMessages(
  root: Contract,
  receipt: providers.TransactionReceipt
): Promise<{ fxChild: string; messages: StateSyncMessage[] }> {
  const fxRoot = new Contract(
    await root.fxRoot(),
    ["function stateSender() view returns (address)", "function fxChild() view returns (address)"],
    root.provider
  );
  const [stateSender, fxChild] = await Promise.all([fxRoot.stateSender(), fxRoot.fxChild()]);
  return { fxChild, messages: decodeStateSyncMessages(receipt, stateSender, fxChild) };
}

export function verifyStateCommits(receipts: providers.TransactionReceipt[], ids: BigNumber[]): void {
  const expected = new Set(ids.map((id) => id.toString()));
  const commits = receipts
    .flatMap((receipt) => receipt.logs)
    .filter(
      (log) =>
        log.address.toLowerCase() === STATE_RECEIVER && log.topics[0] === stateInterface.getEventTopic("StateCommitted")
    )
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
    .map((log) => stateInterface.parseLog(log).args)
    .filter((args) => expected.has(args.stateId.toString()));
  assert.equal(commits.length, ids.length, "Expected a StateCommitted result for each L1 message");
  commits.forEach((commit, i) => {
    assert(commit.stateId.eq(ids[i]), "Duplicate or out-of-order StateCommitted result");
    assert.equal(commit.success, true, `Polygon state sync ${commit.stateId} failed; inspect delivery before recovery`);
  });
}

export async function findPolygonReceipts(
  polygon: providers.Provider,
  ids: BigNumber[],
  fromBlock: number,
  toBlock: number
): Promise<providers.TransactionReceipt[]> {
  assert(Number.isSafeInteger(fromBlock) && fromBlock >= 0 && fromBlock <= toBlock, "Invalid Polygon block range");
  const found = new Set<string>();
  const hashes = new Set<string>();
  // Bound each query for RPC providers that limit eth_getLogs ranges.
  for (let start = fromBlock; start <= toBlock; start += 2000) {
    const logs = await polygon.getLogs({
      address: STATE_RECEIVER,
      topics: [stateInterface.getEventTopic("StateCommitted"), ids.map((id) => utils.hexZeroPad(id.toHexString(), 32))],
      fromBlock: start,
      toBlock: Math.min(start + 1999, toBlock),
    });
    for (const log of logs) {
      found.add(stateInterface.parseLog(log).args.stateId.toString());
      hashes.add(log.transactionHash);
    }
    if (found.size === ids.length) break;
  }
  const missing = ids.filter((id) => !found.has(id.toString()));
  assert.equal(
    missing.length,
    0,
    `State syncs not found: ${missing.join(", ")}. Wait for delivery or check POLYGON_FROM_BLOCK`
  );
  const receipts = await Promise.all(
    [...hashes].map(async (hash) => {
      const receipt = await polygon.getTransactionReceipt(hash);
      assert(receipt, `Polygon receipt not found: ${hash}`);
      return receipt;
    })
  );
  verifyStateCommits(receipts, ids);
  return receipts;
}
