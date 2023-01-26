import { Logger } from "@uma/financial-templates-lib";
import { OptimisticAsserterEthers } from "@uma/contracts-node";
import { logSettlement } from "./MonitorLogger";
import { getContractInstanceWithProvider } from "../utils/contracts";

import type { MonitoringParams } from "./common";

export async function monitorSettlements(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oa = await getContractInstanceWithProvider<OptimisticAsserterEthers>("OptimisticAsserter", params.provider);

  const settlements = (
    await oa.queryFilter(oa.filters.AssertionSettled(), params.blockRange.start, params.blockRange.end)
  ).map(async (event) => ({
    tx: event.transactionHash,
    assertionId: event.args.assertionId,
    assertionData: await oa.getAssertion(event.args.assertionId),
  }));
  for (const settlement of await Promise.all(settlements)) {
    await logSettlement(logger, settlement, params);
  }
}
