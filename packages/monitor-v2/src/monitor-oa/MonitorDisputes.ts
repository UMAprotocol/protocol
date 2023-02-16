import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleV3Ethers } from "./common";
import { logDispute } from "./MonitorLogger";

export async function monitorDisputes(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oa = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", params.provider);

  const disputes = (
    await oa.queryFilter(oa.filters.AssertionDisputed(), params.blockRange.start, params.blockRange.end)
  ).map(async (event) => ({
    tx: event.transactionHash,
    assertionId: event.args.assertionId,
    claim: (await oa.queryFilter(oa.filters.AssertionMade(event.args.assertionId))).map((event) => event.args.claim)[0],
    assertionData: await oa.getAssertion(event.args.assertionId),
  }));
  for (const dispute of await Promise.all(disputes)) {
    await logDispute(logger, dispute, params);
  }
}
