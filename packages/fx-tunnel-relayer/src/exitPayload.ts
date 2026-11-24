import Web3 from "web3";

// Matches RootTunnelChunkedRelayer.MAX_CHUNK_SIZE: 24575 bytes keeps the data contract (STOP prefix + chunk) at or under
// the EIP-170 24576-byte code size limit.
export const MAX_CHUNK_SIZE = 24575;

// matic.js `buildPayloadForExit` returns an RLP list with these 10 items:
// [headerNumber, blockProof, blockNumber, blockTime, txRoot, receiptRoot, receipt, receiptProof, branchMask, logIndex].
const EXIT_PAYLOAD_ITEMS = 10;
const BLOCK_NUMBER_INDEX = 2;
const BRANCH_MASK_INDEX = 8;
const LOG_INDEX_INDEX = 9;

export interface SplitExitPayload {
  // RLP list header of the payload.
  prefix: string;
  // Concatenated encodings of items 0..8. This is the large part (it contains the receipt twice) and is identical for
  // every message proven from the same Polygon transaction.
  body: string;
  // Encoding of item 9 (logIndex).
  suffix: string;
  // Decimal strings, decoded as RLPReader.toUint does.
  blockNumber: string;
  logIndex: string;
  // Payload of item 8, decoded as RLPReader.toBytes does.
  branchMask: string;
  // keccak256(abi.encodePacked(blockNumber, MerklePatriciaProof._getNibbleArray(branchMask), logIndex)), the key used by
  // FxBaseRootTunnel.processedExits.
  exitHash: string;
}

interface RlpItem {
  offset: number; // Start of the item's header.
  headerLength: number;
  payloadLength: number;
  isList: boolean;
}

// Decodes only the header of the RLP item starting at `offset`, with the same length rules as fx-portal's RLPReader, and
// checks that the item lies within `data`. Canonical-encoding rules are not enforced since RLPReader does not enforce them.
function readItem(data: Buffer, offset: number): RlpItem {
  if (offset >= data.length) throw new Error("RLP item starts beyond end of data");
  const byte0 = data[offset];
  let headerLength: number;
  let payloadLength: number;
  let isList = false;
  if (byte0 < 0x80) {
    headerLength = 0;
    payloadLength = 1;
  } else if (byte0 < 0xb8) {
    headerLength = 1;
    payloadLength = byte0 - 0x80;
  } else if (byte0 < 0xc0) {
    ({ headerLength, payloadLength } = readLongLength(data, offset, byte0 - 0xb7));
  } else if (byte0 < 0xf8) {
    isList = true;
    headerLength = 1;
    payloadLength = byte0 - 0xc0;
  } else {
    isList = true;
    ({ headerLength, payloadLength } = readLongLength(data, offset, byte0 - 0xf7));
  }
  if (offset + headerLength + payloadLength > data.length) throw new Error("RLP item extends beyond end of data");
  return { offset, headerLength, payloadLength, isList };
}

function readLongLength(data: Buffer, offset: number, lengthOfLength: number) {
  if (offset + 1 + lengthOfLength > data.length) throw new Error("RLP length extends beyond end of data");
  // Payloads here are far below 2^48 bytes; larger lengths cannot fit in the data anyway.
  if (lengthOfLength > 6) throw new Error("RLP length too large");
  return { headerLength: 1 + lengthOfLength, payloadLength: data.readUIntBE(offset + 1, lengthOfLength) };
}

function payloadOf(data: Buffer, item: RlpItem): Buffer {
  const start = item.offset + item.headerLength;
  return data.subarray(start, start + item.payloadLength);
}

// RLPReader.toUint: total item length in (0, 33], payload read as a big-endian integer (empty payload is 0).
function toUint(data: Buffer, item: RlpItem): bigint {
  if (item.isList) throw new Error("Expected RLP string for uint");
  if (item.headerLength + item.payloadLength > 33) throw new Error("RLP uint too long");
  const payload = payloadOf(data, item);
  return payload.length === 0 ? BigInt(0) : BigInt("0x" + payload.toString("hex"));
}

// MerklePatriciaProof._getNibbleArray: drops the hex-prefix nibble, and also the padding nibble when the first nibble
// is even (0 or 2).
export function getNibbleArray(b: Buffer): Buffer {
  if (b.length === 0) return Buffer.alloc(0);
  const nibble = (n: number) => (n % 2 === 0 ? b[n >> 1] >> 4 : b[n >> 1] & 0x0f);
  const hpNibble = nibble(0);
  const odd = hpNibble === 1 || hpNibble === 3;
  const nibbles = Buffer.alloc(odd ? b.length * 2 - 1 : b.length * 2 - 2);
  const offset = odd ? 1 : 0;
  if (odd) nibbles[0] = nibble(1);
  for (let i = offset; i < nibbles.length; i++) nibbles[i] = nibble(i - offset + 2);
  return nibbles;
}

const uint256 = (value: bigint) => Buffer.from(value.toString(16).padStart(64, "0"), "hex");

export function computeExitHash(blockNumber: bigint, branchMask: Buffer, logIndex: bigint): string {
  const packed = Buffer.concat([uint256(blockNumber), getNibbleArray(branchMask), uint256(logIndex)]);
  return Web3.utils.keccak256("0x" + packed.toString("hex"));
}

const toHex = (b: Buffer) => "0x" + b.toString("hex");

function hexToBuffer(hex: string): Buffer {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Exit payload is not a 0x-prefixed even-length hex string");
  return Buffer.from(hex.slice(2), "hex");
}

// Splits a matic.js exit payload into the list header, items 0..8 and item 9 so that the large middle part can be
// stored in chunks and the payload rebuilt on-chain as prefix ++ chunks ++ suffix. Throws if the payload is not a single
// RLP list of exactly 10 items spanning the whole input.
export function splitExitPayload(proof: string): SplitExitPayload {
  const data = hexToBuffer(proof);
  const list = readItem(data, 0);
  if (!list.isList) throw new Error("Exit payload is not an RLP list");
  if (list.headerLength + list.payloadLength !== data.length) throw new Error("Exit payload has trailing bytes");

  const items: RlpItem[] = [];
  let cursor = list.headerLength;
  while (cursor < data.length) {
    const item = readItem(data, cursor);
    items.push(item);
    cursor += item.headerLength + item.payloadLength;
  }
  if (items.length !== EXIT_PAYLOAD_ITEMS) {
    throw new Error(`Exit payload has ${items.length} items, expected ${EXIT_PAYLOAD_ITEMS}`);
  }

  const logIndexItem = items[LOG_INDEX_INDEX];
  const prefix = data.subarray(0, list.headerLength);
  const body = data.subarray(list.headerLength, logIndexItem.offset);
  const suffix = data.subarray(logIndexItem.offset);
  if (!Buffer.concat([prefix, body, suffix]).equals(data)) throw new Error("Exit payload split does not round-trip");

  const blockNumber = toUint(data, items[BLOCK_NUMBER_INDEX]);
  const logIndex = toUint(data, logIndexItem);
  const branchMask = payloadOf(data, items[BRANCH_MASK_INDEX]);
  return {
    prefix: toHex(prefix),
    body: toHex(body),
    suffix: toHex(suffix),
    blockNumber: blockNumber.toString(),
    logIndex: logIndex.toString(),
    branchMask: toHex(branchMask),
    exitHash: computeExitHash(blockNumber, branchMask, logIndex),
  };
}

// Splits 0x-prefixed hex data into pieces of at most `size` bytes. Empty data yields no chunks.
export function chunkHex(hex: string, size = MAX_CHUNK_SIZE): string[] {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Chunk size must be a positive integer");
  const data = hexToBuffer(hex);
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += size) chunks.push(toHex(data.subarray(i, i + size)));
  return chunks;
}
