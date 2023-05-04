import "@nomiclabs/hardhat-ethers";
import { paginatedEventQuery } from "@uma/common";
import { OracleHubEthers, VotingV2Ethers } from "@uma/contracts-node";
import { ArbitrumParentMessenger } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers";
import { MessageReceivedFromChildEvent as MessageReceivedFromChildArbitrum } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/ArbitrumParentMessenger";
import { MessageSentToChildEvent as MessageSentToChildArbitrum } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimismParentMessenger";
import { RequestResolvedEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import { utils } from "ethers";
import hre from "hardhat";
import { logPricePublished } from "./BotLogger";
import {
  ARBITRUM_CHAIN_ID,
  BLOCKS_WEEK_MAINNET,
  Logger,
  MonitoringParams,
  getContractInstanceWithProvider,
} from "./common";
const { defaultAbiCoder } = utils;
const ethers = hre.ethers;

const processArbitrum = async (
  logger: typeof Logger,
  params: MonitoringParams,
  oracleHub: OracleHubEthers,
  arbitrumParentMessenger: ArbitrumParentMessenger,
  event: RequestResolvedEvent,
  currentBlockNumber: number
) => {
  const { identifier, time, ancillaryData, price } = event.args;
  const encodedData = defaultAbiCoder.encode(["bytes32", "uint256", "bytes"], [identifier, time, ancillaryData]);

  // Search for requested price from Arbitrum via ArbitrumParentMessenger
  const publishLoopBack = params.blockLookbackPublication || BLOCKS_WEEK_MAINNET;
  const publishSearchConfig = {
    fromBlock: event.blockNumber - publishLoopBack < 0 ? 0 : event.blockNumber - publishLoopBack,
    toBlock: currentBlockNumber,
    maxBlockLookBack: params.maxBlockLookBack,
  };

  const messagesReceivedArbitrum = await paginatedEventQuery<MessageReceivedFromChildArbitrum>(
    arbitrumParentMessenger,
    arbitrumParentMessenger.filters.MessageReceivedFromChild(),
    publishSearchConfig
  );

  const messageArbitrum = messagesReceivedArbitrum.find((message) => {
    const data = message.args.data;
    return encodedData === data;
  });

  if (!messageArbitrum) return; // This price request was not requested from Arbitrum

  const arbitrumL1CallValue = await arbitrumParentMessenger.getL1CallValue();

  await (
    await oracleHub
      .connect(params.signer)
      .publishPrice(ARBITRUM_CHAIN_ID, identifier, time, ancillaryData, { value: arbitrumL1CallValue })
  ).wait();

  const messagesSentArbitrum = await paginatedEventQuery<MessageSentToChildArbitrum>(
    arbitrumParentMessenger,
    arbitrumParentMessenger.filters.MessageSentToChild(),
    { ...publishSearchConfig }
  );

  // Try to find the corresponding message sent to Arbitrum
  const iface = new ethers.utils.Interface(["function processMessageFromCrossChainParent(bytes,address)"]);
  const messageSentArbitrum = messagesSentArbitrum.find((message) => {
    const functionData = iface.decodeFunctionData("processMessageFromCrossChainParent", message.args.data);

    const [decodedIdentifier, decodedTime, decodedAncillaryData] = defaultAbiCoder.decode(
      ["bytes32", "uint256", "bytes", "int256"],
      functionData[0]
    );

    return identifier === decodedIdentifier && time.eq(decodedTime) && ancillaryData === decodedAncillaryData;
  });

  if (!messageSentArbitrum) {
    const arbitrumL1CallValue = await arbitrumParentMessenger.getL1CallValue();

    const tx = await (
      await oracleHub
        .connect(params.signer)
        .publishPrice(ARBITRUM_CHAIN_ID, identifier, time, ancillaryData, { value: arbitrumL1CallValue })
    ).wait();

    await logPricePublished(
      logger,
      {
        tx: tx.transactionHash,
        identifier,
        ancillaryData,
        time,
        price,
        destinationChain: ARBITRUM_CHAIN_ID,
      },
      params
    );
  }
};

const processPolygon = async (
  logger: typeof Logger,
  params: MonitoringParams,
  oracleHub: OracleHubEthers,
  arbitrumParentMessenger: ArbitrumParentMessenger,
  event: RequestResolvedEvent,
  currentBlockNumber: number
) => {
  const { identifier, time, ancillaryData, price } = event.args;
  const encodedData = defaultAbiCoder.encode(["bytes32", "uint256", "bytes"], [identifier, time, ancillaryData]);

  // Search for requested price from Arbitrum via ArbitrumParentMessenger
  const publishLoopBack = params.blockLookbackPublication || BLOCKS_WEEK_MAINNET;
  const publishSearchConfig = {
    fromBlock: event.blockNumber - publishLoopBack < 0 ? 0 : event.blockNumber - publishLoopBack,
    toBlock: currentBlockNumber,
    maxBlockLookBack: params.maxBlockLookBack,
  };

  const messagesReceivedArbitrum = await paginatedEventQuery<MessageReceivedFromChildArbitrum>(
    arbitrumParentMessenger,
    arbitrumParentMessenger.filters.MessageReceivedFromChild(),
    publishSearchConfig
  );

  const messageArbitrum = messagesReceivedArbitrum.find((message) => {
    const data = message.args.data;
    return encodedData === data;
  });

  if (!messageArbitrum) return; // This price request was not requested from Arbitrum

  const arbitrumL1CallValue = await arbitrumParentMessenger.getL1CallValue();

  await (
    await oracleHub
      .connect(params.signer)
      .publishPrice(ARBITRUM_CHAIN_ID, identifier, time, ancillaryData, { value: arbitrumL1CallValue })
  ).wait();

  const messagesSentArbitrum = await paginatedEventQuery<MessageSentToChildArbitrum>(
    arbitrumParentMessenger,
    arbitrumParentMessenger.filters.MessageSentToChild(),
    { ...publishSearchConfig }
  );

  // Try to find the corresponding message sent to Arbitrum
  const iface = new ethers.utils.Interface(["function processMessageFromCrossChainParent(bytes,address)"]);
  const messageSentArbitrum = messagesSentArbitrum.find((message) => {
    const functionData = iface.decodeFunctionData("processMessageFromCrossChainParent", message.args.data);

    const [decodedIdentifier, decodedTime, decodedAncillaryData] = defaultAbiCoder.decode(
      ["bytes32", "uint256", "bytes", "int256"],
      functionData[0]
    );

    return identifier === decodedIdentifier && time.eq(decodedTime) && ancillaryData === decodedAncillaryData;
  });

  if (!messageSentArbitrum) {
    const arbitrumL1CallValue = await arbitrumParentMessenger.getL1CallValue();

    const tx = await (
      await oracleHub
        .connect(params.signer)
        .publishPrice(ARBITRUM_CHAIN_ID, identifier, time, ancillaryData, { value: arbitrumL1CallValue })
    ).wait();

    await logPricePublished(
      logger,
      {
        tx: tx.transactionHash,
        identifier,
        ancillaryData,
        time,
        price,
        destinationChain: ARBITRUM_CHAIN_ID,
      },
      params
    );
  }
};

export async function publishPrices(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceWithProvider<VotingV2Ethers>("VotingV2", params.provider);

  const oracleHub = await getContractInstanceWithProvider<OracleHubEthers>("OracleHub", params.provider);

  const arbitrumParentMessenger = await getContractInstanceWithProvider<ArbitrumParentMessenger>(
    "Arbitrum_ParentMessenger",
    params.provider
  );

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
    await processArbitrum(logger, params, oracleHub, arbitrumParentMessenger, event, currentBlockNumber);
  }
}
