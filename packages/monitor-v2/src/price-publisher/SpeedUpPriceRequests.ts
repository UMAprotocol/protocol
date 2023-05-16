import { paginatedEventQuery } from "@uma/common";
import { OracleHubEthers, StoreEthers, VotingTokenEthers, VotingV2Ethers } from "@uma/contracts-node";
import { RequestResolvedEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import { Logger, MonitoringParams, getContractInstanceWithProvider } from "./common";
import { logPriceRequestSpeedUp } from "./BotLogger";

export async function speedUpPrices(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const votingV2 = await getContractInstanceWithProvider<VotingV2Ethers>("VotingV2", params.provider);
  const votingToken = await getContractInstanceWithProvider<VotingTokenEthers>("VotingToken", params.provider);
  const store = await getContractInstanceWithProvider<StoreEthers>("Store", params.provider);

  if (!params.l2ChainId) throw new Error("No l2 chain id provided.");
  if (!params.l2Provider) throw new Error("No l2 provider provided.");
  const oracleSpokeL2 = await getContractInstanceWithProvider<OracleHubEthers>("OracleSpoke", params.l2Provider);

  const oracleHub = await getContractInstanceWithProvider<OracleHubEthers>("OracleHub", params.provider);

  const currentBlockNumberL2 = await params.l2Provider.getBlockNumber();

  const lookback = params.blockLookback;
  const searchConfig = {
    fromBlock: currentBlockNumberL2 - lookback < 0 ? 0 : currentBlockNumberL2 - lookback,
    toBlock: currentBlockNumberL2,
    maxBlockLookBack: params.maxBlockLookBack,
  };

  // Find resolved events
  const requestsAddedL2 = await paginatedEventQuery<RequestResolvedEvent>(
    oracleSpokeL2,
    oracleSpokeL2.filters.PriceRequestAdded(null, null, null, null),
    searchConfig
  );

  for (const event of requestsAddedL2) {
    const [[requestStatus]] = await votingV2.getPriceRequestStatuses([
      {
        identifier: event.args.identifier,
        time: event.args.time,
        ancillaryData: event.args.ancillaryData,
      },
    ]);
    const shouldSpeedUp = requestStatus === 0;
    if (shouldSpeedUp) {
      const finalFee = await store.computeFinalFee(votingToken.address);
      const allowance = await votingToken.allowance(await params.signer.getAddress(), oracleHub.address);
      if (allowance.lt(finalFee.rawValue)) {
        await (await votingToken.connect(params.signer).approve(oracleHub.address, finalFee.rawValue)).wait();
      }
      const receipt = await (
        await oracleHub
          .connect(params.signer)
          .requestPrice(event.args.identifier, event.args.time, event.args.ancillaryData)
      ).wait();

      logPriceRequestSpeedUp(
        logger,
        {
          identifier: event.args.identifier,
          time: event.args.time,
          ancillaryData: event.args.ancillaryData,
          originChainTx: event.transactionHash,
          tx: receipt.transactionHash,
          l2ChainId: params.l2ChainId,
        },
        params
      );
    }
  }
  console.log("Done speeding up prices.");
}
