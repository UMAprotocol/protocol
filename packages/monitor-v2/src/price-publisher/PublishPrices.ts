import "@nomiclabs/hardhat-ethers";
import { paginatedEventQuery } from "@uma/common";
import { PriceRequestAddedEvent } from "@uma/contracts-frontend/dist/typechain/core/ethers/OracleBase";
import { OracleHubEthers, OracleRootTunnelEthers, VotingV2Ethers } from "@uma/contracts-node";
import {
  ArbitrumParentMessenger,
  OptimismParentMessenger,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers";
import { RequestResolvedEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import { BigNumber, utils } from "ethers";
import { logPricePublished } from "./BotLogger";
import {
  ARBITRUM_CHAIN_ID,
  BLOCKS_WEEK_MAINNET,
  Logger,
  MonitoringParams,
  OPTIMISM_CHAIN_ID,
  POLYGON_CHAIN_ID,
  getContractInstanceWithProvider,
} from "./common";

const shouldPublish = async (
  params: MonitoringParams,
  oracle: OracleHubEthers | OracleRootTunnelEthers,
  event: RequestResolvedEvent,
  currentBlockNumber: number
) => {
  const { identifier, time, ancillaryData } = event.args;

  // Search for requested price from l2 chain
  const publishLoopBack = params.blockLookbackPublication || BLOCKS_WEEK_MAINNET;
  const publishSearchConfig = {
    fromBlock: event.blockNumber - publishLoopBack < 0 ? 0 : event.blockNumber - publishLoopBack,
    toBlock: currentBlockNumber,
    maxBlockLookBack: params.maxBlockLookBack,
  };

  const priceRequestAdded = await paginatedEventQuery<PriceRequestAddedEvent>(
    oracle,
    oracle.filters.PriceRequestAdded(),
    publishSearchConfig
  );

  const message = priceRequestAdded.find((message) => {
    const { identifier: decodedIdentifier, time: decodedTime, ancillaryData: decodedAncillaryData } = message.args;
    return identifier === decodedIdentifier && time.eq(decodedTime) && ancillaryData === decodedAncillaryData;
  });

  if (!message) return; // This price request was not requested from l2 chain

  const messagesSent = await oracle.queryFilter(
    oracle.filters.PushedPrice(null, null, null, null, message.args.requestHash)
  );

  return !messagesSent.length;
};

const processOracleRoot = async (
  logger: typeof Logger,
  params: MonitoringParams,
  oracleRootTunnel: OracleRootTunnelEthers,
  event: RequestResolvedEvent,
  currentBlockNumber: number
) => {
  const { identifier, time, ancillaryData, price } = event.args;

  if (await shouldPublish(params, oracleRootTunnel, event, currentBlockNumber)) {
    const tx = await (
      await oracleRootTunnel.connect(params.signer).publishPrice(identifier, time, ancillaryData)
    ).wait();

    await logPricePublished(
      logger,
      {
        tx: tx.transactionHash,
        identifier,
        ancillaryData,
        time,
        price,
        destinationChain: POLYGON_CHAIN_ID,
      },
      params
    );
  }
};

const processOracleHub = async (
  logger: typeof Logger,
  params: MonitoringParams,
  oracleHub: OracleHubEthers,
  event: RequestResolvedEvent,
  currentBlockNumber: number,
  chainId: number,
  callValue: BigNumber
) => {
  const { identifier, time, ancillaryData, price } = event.args;

  if (await shouldPublish(params, oracleHub, event, currentBlockNumber)) {
    const tx = await (
      await oracleHub
        .connect(params.signer)
        .publishPrice(chainId, identifier, time, ancillaryData, { value: callValue })
    ).wait();

    await logPricePublished(
      logger,
      {
        tx: tx.transactionHash,
        identifier,
        ancillaryData,
        time,
        price,
        destinationChain: chainId,
      },
      params
    );
  }
};

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

  const arbitrumL1CallValue = await arbitrumParentMessenger.getL1CallValue();
  const optimismL1CallValue = await optimismParentMessenger.getL1CallValue();
  const currentBlockNumber = await params.provider.getBlockNumber();

  const loopBack = params.blockLookbackResolution || BLOCKS_WEEK_MAINNET;
  const searchConfig = {
    fromBlock: currentBlockNumber - loopBack < 0 ? 0 : currentBlockNumber - loopBack,
    toBlock: currentBlockNumber,
    maxBlockLookBack: params.maxBlockLookBack,
  };

  // Find resolved events
  const resolvedEvents = await paginatedEventQuery<RequestResolvedEvent>(
    votingV2,
    votingV2.filters.RequestResolved(null, null, null, null, null),
    searchConfig
  );

  for (const event of resolvedEvents) {
    const decodedAncillary = utils.toUtf8String(event.args.ancillaryData);
    const isPolygon = decodedAncillary.endsWith(`,childChainId:${POLYGON_CHAIN_ID}`);
    const isArbitrum = decodedAncillary.endsWith(`,childChainId:${ARBITRUM_CHAIN_ID}`);
    const isOptimism = decodedAncillary.endsWith(`,childChainId:${OPTIMISM_CHAIN_ID}`);

    if (!isPolygon && !isArbitrum && !isOptimism) {
      new Error(`Unsupported chainId in ancillaryData: ${decodedAncillary}`);
    }

    if (isPolygon) {
      await processOracleRoot(logger, params, oracleRootTunnel, event, currentBlockNumber);
    } else {
      await processOracleHub(
        logger,
        params,
        oracleHub,
        event,
        currentBlockNumber,
        isArbitrum ? ARBITRUM_CHAIN_ID : OPTIMISM_CHAIN_ID,
        isArbitrum ? arbitrumL1CallValue : optimismL1CallValue
      );
    }
  }
}
