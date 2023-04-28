import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleV3Ethers } from "./common";
import { logAssertion } from "./MonitorLogger";

export async function monitorAssertions(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oo = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", params.provider);

  const assertions = (
    await oo.queryFilter(oo.filters.AssertionMade(), params.blockRange.start, params.blockRange.end)
  ).map(async (event) => ({
    tx: event.transactionHash,
    eventIndex: event.logIndex,
    assertionId: event.args.assertionId,
    claim: event.args.claim,
    assertionData: await oo.getAssertion(event.args.assertionId),
  }));
  for (const assertion of await Promise.all(assertions)) {
    await logAssertion(logger, assertion, params);
  }
}
