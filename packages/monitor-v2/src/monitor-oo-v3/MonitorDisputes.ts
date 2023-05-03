import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleV3Ethers } from "./common";
import { logDispute } from "./MonitorLogger";

export async function monitorDisputes(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oo = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", params.provider);

  const disputes = (
    await oo.queryFilter(oo.filters.AssertionDisputed(), params.blockRange.start, params.blockRange.end)
  ).map(async (event) => ({
    tx: event.transactionHash,
    eventIndex: event.logIndex,
    assertionId: event.args.assertionId,
    claim: (await oo.queryFilter(oo.filters.AssertionMade(event.args.assertionId))).map((event) => event.args.claim)[0],
    assertionData: await oo.getAssertion(event.args.assertionId),
  }));
  for (const dispute of await Promise.all(disputes)) {
    await logDispute(logger, dispute, params);
  }
}
