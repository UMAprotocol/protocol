import type { AbiItem } from "web3-utils";

// Subset of the RootTunnelChunkedRelayer ABI (packages/core) used by the relayer.
// TODO: replace with getAbi("RootTunnelChunkedRelayer") from @uma/contracts-node once the contract is compiled into
// @uma/core and contracts-node is regenerated and published. test/Relayer.ts checks this subset against the core artifact
// when the artifact is available.
export const ROOT_TUNNEL_CHUNKED_RELAYER_ABI: AbiItem[] = [
  {
    inputs: [],
    name: "MAX_CHUNK_SIZE",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "rootTunnel",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes", name: "data", type: "bytes" }],
    name: "storeChunk",
    outputs: [{ internalType: "address", name: "pointer", type: "address" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes", name: "data", type: "bytes" }],
    name: "chunkAddress",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes", name: "prefix", type: "bytes" },
      { internalType: "address[]", name: "chunks", type: "address[]" },
      { internalType: "bytes", name: "suffix", type: "bytes" },
    ],
    name: "relay",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "pointer", type: "address" },
      { indexed: true, internalType: "bytes32", name: "dataHash", type: "bytes32" },
      { indexed: false, internalType: "uint256", name: "size", type: "uint256" },
    ],
    name: "ChunkStored",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: "bytes32", name: "payloadHash", type: "bytes32" }],
    name: "MessageRelayed",
    type: "event",
  },
];
