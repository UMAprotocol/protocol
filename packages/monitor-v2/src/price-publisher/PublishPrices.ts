import { paginatedEventQuery } from "@uma/common";
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

const shouldPublish = async (oracle: OracleHubEthers | OracleRootTunnelEthers, event: RequestResolvedEvent) => {
  const { identifier, time, ancillaryData } = event.args;

  const requestHash = utils.keccak256(
    utils.defaultAbiCoder.encode(["bytes32", "uint256", "bytes"], [identifier, time, ancillaryData])
  );

  const messagesSent = await oracle.queryFilter(oracle.filters.PushedPrice(null, null, null, null, requestHash));

  return !messagesSent.length;
};

const processOracleRoot = async (
  logger: typeof Logger,
  params: MonitoringParams,
  oracleRootTunnel: OracleRootTunnelEthers,
  event: RequestResolvedEvent
) => {
  const { identifier, time, ancillaryData, price } = event.args;

  if (await shouldPublish(oracleRootTunnel, event)) {
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
  chainId: number,
  callValue: BigNumber
) => {
  const { identifier, time, ancillaryData, price } = event.args;

  if (await shouldPublish(oracleHub, event)) {
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

    if (isPolygon) {
      await processOracleRoot(logger, params, oracleRootTunnel, event);
    } else if (isOptimism || isArbitrum) {
      await processOracleHub(
        logger,
        params,
        oracleHub,
        event,
        isArbitrum ? ARBITRUM_CHAIN_ID : OPTIMISM_CHAIN_ID,
        isArbitrum ? arbitrumL1CallValue : optimismL1CallValue
      );
    }
  }
  console.log("Done publishing prices.");
}
