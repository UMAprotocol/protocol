import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticAsserterEthers } from "./common";
import { logAssertion } from "./MonitorLogger";

export async function monitorAssertions(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oa = await getContractInstanceWithProvider<OptimisticAsserterEthers>("OptimisticAsserter", params.provider);

  const assertions = (
    await oa.queryFilter(oa.filters.AssertionMade(), params.blockRange.start, params.blockRange.end)
  ).map(async (event) => ({
    tx: event.transactionHash,
    assertionId: event.args.assertionId,
    claim: event.args.claim,
    assertionData: await oa.getAssertion(event.args.assertionId),
  }));
  for (const assertion of await Promise.all(assertions)) {
    await logAssertion(logger, assertion, params);
  }
}
