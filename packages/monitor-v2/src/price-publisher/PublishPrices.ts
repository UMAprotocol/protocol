import { paginatedEventQuery } from "@uma/common";
import { OracleHubEthers, OracleRootTunnelEthers, VotingV2Ethers, getAddress } from "@uma/contracts-node";
import {
  ArbitrumParentMessenger,
  OptimismParentMessenger,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers";
import { RequestResolvedEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import { tryHexToUtf8String } from "../utils/contracts";
import { publishPriceRequest } from "./PublishPriceRequest";
import {
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN_ID,
  BLAST_CHAIN_ID,
  BLOCKS_WEEK_MAINNET,
  Logger,
  MonitoringParams,
  OPTIMISM_CHAIN_ID,
  POLYGON_CHAIN_ID,
  getContractInstanceWithProvider,
} from "./common";

// Each failed request is already logged with its own stable PagerDuty key.
export class PricePublicationError extends Error {
  constructor(readonly failedRequests: number) {
    super(`${failedRequests} price publication request(s) remain unsuccessful`);
    this.name = "PricePublicationError";
  }
}

export async function publishPrices(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceWithProvider<VotingV2Ethers>("VotingV2", params.provider);

  const oracleHub = await getContractInstanceWithProvider<OracleHubEthers>("OracleHub", params.provider);

  const oracleRootTunnel = await getContractInstanceWithProvider<OracleRootTunnelEthers>(
    "OracleRootTunnel",
    params.provider
  );

  const arbitrumParentMessenger = await getContractInstanceWithProvider<ArbitrumParentMessenger>(
    "Arbitrum_ParentMessenger",
    params.provider
  );

  const optimismParentMessenger = await getContractInstanceWithProvider<OptimismParentMessenger>(
    "Optimism_ParentMessenger",
    params.provider
  );

  const baseParentMessenger = await getContractInstanceWithProvider<OptimismParentMessenger>(
    "Optimism_ParentMessenger",
    params.provider,
    await getAddress("Base_ParentMessenger", params.chainId)
  );

  const blastParentMessenger = await getContractInstanceWithProvider<OptimismParentMessenger>(
    "Optimism_ParentMessenger",
    params.provider,
    await getAddress("Blast_ParentMessenger", params.chainId)
  );

  const arbitrumL1CallValue = await arbitrumParentMessenger.getL1CallValue();
  const optimismL1CallValue = await optimismParentMessenger.getL1CallValue();
  const baseL1CallValue = await baseParentMessenger.getL1CallValue();
  const blastL1CallValue = await blastParentMessenger.getL1CallValue();
  const currentBlockNumber = await params.provider.getBlockNumber();

  const lookBack = params.blockLookback || BLOCKS_WEEK_MAINNET;
  const searchConfig = {
    fromBlock: currentBlockNumber - lookBack < 0 ? 0 : currentBlockNumber - lookBack,
    toBlock: currentBlockNumber,
    maxBlockLookBack: params.maxBlockLookBack,
  };

  // Find resolved events
  const resolvedEvents = await paginatedEventQuery<RequestResolvedEvent>(
    votingV2,
    votingV2.filters.RequestResolved(null, null, null, null, null),
    searchConfig
  );

  let failedRequests = 0;
  for (const event of resolvedEvents) {
    // Safe decode: ancillaryData is caller-supplied bytes (OOv2/OOv3 requests are permissionless and are
    // never validated as text), so utils.toUtf8String() throws on non-UTF-8 input and would abort the whole
    // poll loop. tryHexToUtf8String returns the hex string unchanged on failure, which then simply does not
    // match any of the childChainId suffixes below.
    const decodedAncillary = tryHexToUtf8String(event.args.ancillaryData);
    const isPolygon = decodedAncillary.endsWith(`,childChainId:${POLYGON_CHAIN_ID}`);
    const isArbitrum = decodedAncillary.endsWith(`,childChainId:${ARBITRUM_CHAIN_ID}`);
    const isOptimism = decodedAncillary.endsWith(`,childChainId:${OPTIMISM_CHAIN_ID}`);
    const isBase = decodedAncillary.endsWith(`,childChainId:${BASE_CHAIN_ID}`);
    const isBlast = decodedAncillary.endsWith(`,childChainId:${BLAST_CHAIN_ID}`);

    if (isPolygon) {
      if (!(await publishPriceRequest(logger, params, oracleRootTunnel, event, POLYGON_CHAIN_ID))) failedRequests++;
    } else if (isOptimism || isArbitrum || isBase || isBlast) {
      let chainId, callValue;

      if (isArbitrum) {
        chainId = ARBITRUM_CHAIN_ID;
        callValue = arbitrumL1CallValue;
      } else if (isOptimism) {
        chainId = OPTIMISM_CHAIN_ID;
        callValue = optimismL1CallValue;
      } else if (isBase) {
        chainId = BASE_CHAIN_ID;
        callValue = baseL1CallValue;
      } else if (isBlast) {
        chainId = BLAST_CHAIN_ID;
        callValue = blastL1CallValue;
      } else {
        throw new Error("Invalid chainId");
      }

      if (!(await publishPriceRequest(logger, params, oracleHub, event, chainId, callValue))) failedRequests++;
    }
  }
  if (failedRequests > 0) throw new PricePublicationError(failedRequests);
  console.log("Done publishing prices.");
}
