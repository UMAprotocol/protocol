import Web3 from "web3";

export interface ProcessEnv {
  [key: string]: string | undefined;
}

export class RelayerConfig {
  readonly pollingDelay: number;
  readonly errorRetries: number;
  readonly errorRetriesTimeout: number;
  // User will pass in a node url to connect to Polygon network with.
  readonly chainId: string;
  // Any events older than now minus this value (in seconds) will be ignored.
  readonly lookback: number;
  readonly maxCalldataBytes: number;
  // Optional RootTunnelChunkedRelayer on Ethereum used to relay proofs above maxCalldataBytes. Checksummed.
  readonly chunkedRelayerAddress?: string;
  // Largest proof relayed through the chunked relayer. Above it, the root tunnel's gas use for the rebuilt proof exceeds
  // the per-transaction gas cap, so no chunks are stored and an error is logged instead.
  readonly maxChunkedProofBytes: number;

  constructor(env: ProcessEnv) {
    const {
      POLLING_DELAY,
      ERROR_RETRIES,
      ERROR_RETRIES_TIMEOUT,
      LOOKBACK,
      CHAIN_ID,
      MAX_CALLDATA_BYTES,
      CHUNKED_RELAYER_ADDRESS,
      MAX_CHUNKED_PROOF_BYTES,
    } = env;

    this.maxCalldataBytes = MAX_CALLDATA_BYTES === undefined ? 120_000 : Number(MAX_CALLDATA_BYTES);
    if (!Number.isSafeInteger(this.maxCalldataBytes) || this.maxCalldataBytes <= 0) {
      throw new Error("MAX_CALLDATA_BYTES must be a positive safe integer");
    }
    this.maxChunkedProofBytes = MAX_CHUNKED_PROOF_BYTES === undefined ? 360_000 : Number(MAX_CHUNKED_PROOF_BYTES);
    if (!Number.isSafeInteger(this.maxChunkedProofBytes) || this.maxChunkedProofBytes <= 0) {
      throw new Error("MAX_CHUNKED_PROOF_BYTES must be a positive safe integer");
    }
    if (CHUNKED_RELAYER_ADDRESS !== undefined && CHUNKED_RELAYER_ADDRESS !== "") {
      const { isAddress, toChecksumAddress } = Web3.utils;
      if (!isAddress(CHUNKED_RELAYER_ADDRESS) || /^0x0{40}$/i.test(CHUNKED_RELAYER_ADDRESS)) {
        throw new Error("CHUNKED_RELAYER_ADDRESS must be a valid nonzero address");
      }
      this.chunkedRelayerAddress = toChecksumAddress(CHUNKED_RELAYER_ADDRESS);
    }
    this.chainId = CHAIN_ID || "";
    this.pollingDelay = POLLING_DELAY ? Number(POLLING_DELAY) : 60;
    this.errorRetries = ERROR_RETRIES ? Number(ERROR_RETRIES) : 3;
    this.errorRetriesTimeout = ERROR_RETRIES_TIMEOUT ? Number(ERROR_RETRIES_TIMEOUT) : 1;
    this.lookback = LOOKBACK ? Number(LOOKBACK) : 172800; // ~2 days
  }
}
