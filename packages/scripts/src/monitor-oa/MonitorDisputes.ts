import { Logger } from "@uma/financial-templates-lib";
import { OptimisticAsserterEthers } from "@uma/contracts-node";
import { logDispute } from "./MonitorLogger";
import { getContractInstanceWithProvider } from "../utils/contracts";

import type { MonitoringParams } from "./common";

export async function monitorDisputes(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oa = await getContractInstanceWithProvider<OptimisticAsserterEthers>("OptimisticAsserter", params.provider);

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
