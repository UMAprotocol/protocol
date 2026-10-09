import { Logger, MonitoringParams } from "./common";
import { publishPrices } from "./PublishPrices";
import { resolvePrices } from "./ResolvePrices";

// Both modes use the same signer. Await invocation, not an array of already-started promises.
export async function runPricePublisherCycle(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  if (params.botModes.resolvePricesEnabled) await resolvePrices(logger, params);
  if (params.botModes.publishPricesEnabled) await publishPrices(logger, params);
}
