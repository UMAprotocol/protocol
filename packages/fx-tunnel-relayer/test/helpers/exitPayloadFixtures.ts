import Web3 from "web3";

// Minimal RLP encoder for building exit payload fixtures independently of the code under test.
export type RlpInput = Buffer | RlpInput[];

function encodeLength(length: number, offset: number): Buffer {
  if (length < 56) return Buffer.from([offset + length]);
  const hex = length.toString(16);
  const lengthBytes = Buffer.from(hex.length % 2 ? "0" + hex : hex, "hex");
  return Buffer.concat([Buffer.from([offset + 55 + lengthBytes.length]), lengthBytes]);
}

export function rlpEncode(input: RlpInput): Buffer {
  if (Buffer.isBuffer(input)) {
    if (input.length === 1 && input[0] < 0x80) return input;
    return Buffer.concat([encodeLength(input.length, 0x80), input]);
  }
  const payload = Buffer.concat(input.map(rlpEncode));
  return Buffer.concat([encodeLength(payload.length, 0xc0), payload]);
}

// Wraps already-encoded items in a list header.
export function rlpList(encodedItems: Buffer[]): Buffer {
  const payload = Buffer.concat(encodedItems);
  return Buffer.concat([encodeLength(payload.length, 0xc0), payload]);
}

// Big-endian minimal encoding, as rlp libraries encode integers (0 is the empty string).
export function uintBytes(value: number | bigint): Buffer {
  if (BigInt(value) === BigInt(0)) return Buffer.alloc(0);
  const hex = BigInt(value).toString(16);
  return Buffer.from(hex.length % 2 ? "0" + hex : hex, "hex");
}

const hash = (seed: string) => Buffer.from(Web3.utils.keccak256(Web3.utils.utf8ToHex(seed)).slice(2), "hex");

export interface ExitPayloadFixture {
  proof: string;
  // Hex encodings of the 10 items, for comparing against the split.
  items: Buffer[];
}

export interface ExitPayloadParams {
  blockNumber: number | bigint;
  branchMask: Buffer;
  logIndex: number | bigint;
  // Number of MessageSent-like logs in the receipt; each adds roughly 450 bytes, counted twice in the payload.
  logCount?: number;
}

// Builds a payload shaped like matic.js buildPayloadForExit output: [headerNumber, blockProof, blockNumber, blockTime,
// txRoot, receiptRoot, receipt (typed, 0x02-prefixed), rlp(receiptProof nodes, leaf containing the receipt again),
// branchMask, logIndex].
export function buildExitPayload({
  blockNumber,
  branchMask,
  logIndex,
  logCount = 3,
}: ExitPayloadParams): ExitPayloadFixture {
  const logs: RlpInput[] = [];
  for (let i = 0; i < logCount; i++) {
    logs.push([
      hash("emitter").subarray(0, 20),
      [Buffer.from("8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036", "hex"), hash(`topic${i}`)],
      Buffer.concat([hash(`data${i}a`), hash(`data${i}b`), Buffer.alloc(320, i % 256)]),
    ]);
  }
  const receipt = Buffer.concat([
    Buffer.from([0x02]),
    rlpEncode([uintBytes(1), uintBytes(21_000 * (logCount + 1)), Buffer.alloc(256, 0x11), logs]),
  ]);
  const receiptProof = rlpEncode([
    rlpEncode(Array.from({ length: 17 }, (_, i) => (i < 16 ? hash(`branch${i}`) : Buffer.alloc(0)))),
    rlpEncode([Buffer.from([0x20]), receipt]),
  ]);
  const items = [
    uintBytes(123_450_000),
    Buffer.concat([hash("p0"), hash("p1"), hash("p2"), hash("p3"), hash("p4")]),
    uintBytes(blockNumber),
    uintBytes(1_700_000_000),
    hash("txRoot"),
    hash("receiptRoot"),
    receipt,
    receiptProof,
    branchMask,
    uintBytes(logIndex),
  ];
  return { proof: "0x" + rlpEncode(items).toString("hex"), items: items.map((item) => rlpEncode(item)) };
}

// Exit hash computed with web3's encodePacked implementation from hand-written nibble arrays.
export function expectedExitHash(blockNumber: number | bigint, nibbles: string, logIndex: number | bigint): string {
  return Web3.utils.soliditySha3(
    { t: "uint256", v: blockNumber.toString() },
    { t: "bytes", v: nibbles },
    { t: "uint256", v: logIndex.toString() }
  ) as string;
}
