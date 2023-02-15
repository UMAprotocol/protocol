import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleV3Ethers } from "./common";
import { logSettlement } from "./MonitorLogger";

export async function monitorSettlements(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oa = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", params.provider);

  const settlements = (
    await oa.queryFilter(oa.filters.AssertionSettled(), params.blockRange.start, params.blockRange.end)
  ).map(async (event) => ({
    tx: event.transactionHash,
    assertionId: event.args.assertionId,
    claim: (await oa.queryFilter(oa.filters.AssertionMade(event.args.assertionId))).map((event) => event.args.claim)[0],
    assertionData: await oa.getAssertion(event.args.assertionId),
  }));
  for (const settlement of await Promise.all(settlements)) {
    await logSettlement(logger, settlement, params);
  }
}
