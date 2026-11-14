import { assert } from "chai";
import { MAX_CHUNK_SIZE, chunkHex, computeExitHash, getNibbleArray, splitExitPayload } from "../src/exitPayload";
import { buildExitPayload, expectedExitHash, rlpEncode, rlpList, uintBytes } from "./helpers/exitPayloadFixtures";

const hex = (b: Buffer) => "0x" + b.toString("hex");
const fromHex = (h: string) => Buffer.from(h.slice(2), "hex");

describe("exitPayload", function () {
  // Branch masks as built by matic.js: 0x00 ++ rlp(transactionIndex), plus odd hex-prefix masks and an empty mask.
  const cases = [
    { name: "logIndex 0, tx index 0", blockNumber: 1, mask: "0x0080", nibbles: "0x0800", logIndex: 0, suffix: "0x80" },
    {
      name: "logIndex 5, tx index 5",
      blockNumber: 55_000_000,
      mask: "0x0005",
      nibbles: "0x0005",
      logIndex: 5,
      suffix: "0x05",
    },
    {
      name: "logIndex 200, tx index 200",
      blockNumber: 64_123_456,
      mask: "0x0081c8",
      nibbles: "0x08010c08",
      logIndex: 200,
      suffix: "0x81c8",
    },
    { name: "single-byte odd mask", blockNumber: 2 ** 40, mask: "0x1a", nibbles: "0x0a", logIndex: 1, suffix: "0x01" },
    {
      name: "odd mask with prefix 3",
      blockNumber: 7,
      mask: "0x3f12",
      nibbles: "0x0f0102",
      logIndex: 127,
      suffix: "0x7f",
    },
    {
      name: "even mask with prefix 2",
      blockNumber: 7,
      mask: "0x20abcd",
      nibbles: "0x0a0b0c0d",
      logIndex: 128,
      suffix: "0x8180",
    },
    { name: "empty mask", blockNumber: 0, mask: "0x", nibbles: "0x", logIndex: 65_536, suffix: "0x83010000" },
  ];

  for (const c of cases) {
    it(`splits and hashes an exit payload: ${c.name}`, function () {
      const { proof, items } = buildExitPayload({
        blockNumber: c.blockNumber,
        branchMask: fromHex(c.mask),
        logIndex: c.logIndex,
      });
      const split = splitExitPayload(proof);

      assert.equal(split.prefix + split.body.slice(2) + split.suffix.slice(2), proof);
      assert.equal(split.body, hex(Buffer.concat(items.slice(0, 9))));
      assert.equal(split.suffix, c.suffix);
      assert.equal(split.suffix, hex(items[9]));
      assert.equal(split.blockNumber, c.blockNumber.toString());
      assert.equal(split.logIndex, c.logIndex.toString());
      assert.equal(split.branchMask, c.mask);
      assert.equal(hex(getNibbleArray(fromHex(c.mask))), c.nibbles);
      assert.equal(split.exitHash, expectedExitHash(c.blockNumber, c.nibbles, c.logIndex));
    });
  }

  it("uses a long-form list header for large payloads and shares the body between log indices", function () {
    const params = { blockNumber: 64_000_000, branchMask: fromHex("0x0081c8"), logCount: 300 };
    const first = splitExitPayload(buildExitPayload({ ...params, logIndex: 0 }).proof);
    const second = splitExitPayload(buildExitPayload({ ...params, logIndex: 1 }).proof);
    // 0xf9/0xfa: list with a 2/3-byte length.
    assert.include(["f9", "fa"], first.prefix.slice(2, 4));
    assert.isAbove((first.body.length - 2) / 2, 2 * MAX_CHUNK_SIZE);
    assert.equal(first.body, second.body);
    assert.notEqual(first.suffix, second.suffix);
    assert.notEqual(first.exitHash, second.exitHash);
  });

  it("chunks the body into pieces of at most MAX_CHUNK_SIZE bytes", function () {
    const { body } = splitExitPayload(
      buildExitPayload({ blockNumber: 1, branchMask: fromHex("0x0080"), logIndex: 0, logCount: 300 }).proof
    );
    const bodyBytes = (body.length - 2) / 2;
    const chunks = chunkHex(body);
    assert.equal(chunks.length, Math.ceil(bodyBytes / MAX_CHUNK_SIZE));
    chunks.slice(0, -1).forEach((chunk) => assert.equal((chunk.length - 2) / 2, MAX_CHUNK_SIZE));
    assert.isAtMost((chunks[chunks.length - 1].length - 2) / 2, MAX_CHUNK_SIZE);
    assert.equal("0x" + chunks.map((chunk) => chunk.slice(2)).join(""), body);
    assert.deepEqual(chunkHex("0x"), []);
    assert.deepEqual(chunkHex("0x0102030405", 2), ["0x0102", "0x0304", "0x05"]);
  });

  it("decodes uint items as RLPReader.toUint does", function () {
    // A 32-byte block number and log index (item length 33, the RLPReader maximum).
    const max = (BigInt(1) << BigInt(256)) - BigInt(1);
    const { proof } = buildExitPayload({ blockNumber: max, branchMask: fromHex("0x0080"), logIndex: max });
    const split = splitExitPayload(proof);
    assert.equal(split.blockNumber, max.toString());
    assert.equal(split.logIndex, max.toString());
    assert.equal(split.exitHash, computeExitHash(max, fromHex("0x0080"), max));
  });

  it("rejects payloads that are not a single 10-item RLP list", function () {
    const { items, proof } = buildExitPayload({ blockNumber: 1, branchMask: fromHex("0x0080"), logIndex: 0 });
    const listOf = (encodedItems: Buffer[]) => hex(rlpList(encodedItems));
    assert.equal(listOf(items), proof);
    assert.throws(() => splitExitPayload(listOf(items.slice(0, 9))), /9 items, expected 10/);
    assert.throws(() => splitExitPayload(listOf([...items, rlpEncode(uintBytes(1))])), /11 items, expected 10/);
    assert.throws(() => splitExitPayload(proof + "00"), /trailing bytes/);
    assert.throws(() => splitExitPayload(proof.slice(0, -2)), /beyond end of data/);
    assert.throws(() => splitExitPayload("0x" + "ab".repeat(1000)), /not an RLP list/);
    assert.throws(() => splitExitPayload("0x"), /beyond end of data/);
    assert.throws(() => splitExitPayload("0xc"), /hex string/);
    assert.throws(() => splitExitPayload("abcd"), /hex string/);
    // An item whose declared length runs past the end of the list.
    assert.throws(() => splitExitPayload("0xc3830102"), /beyond end of data/);
  });
});
