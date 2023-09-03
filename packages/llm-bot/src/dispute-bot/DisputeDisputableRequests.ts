import {
  DisputerStrategy,
  OptimisticOracleClientV2,
  OptimisticOracleClientV2FilterDisputeable,
} from "../core/OptimisticOracleV2";
import { Logger, BotParams } from "./common";

export async function disputeDisputableRequests(logger: typeof Logger, params: BotParams): Promise<void> {
  const oov2 = new OptimisticOracleClientV2(params.provider);

  // Update the client with the latest block range.
  const oov2ClientUpdated = await oov2.updateWithBlockRange();

  const requests = Array.from(oov2ClientUpdated.requests.values());
  const oov2FilterDisputable = new OptimisticOracleClientV2FilterDisputeable();

  const filteredRequests = await oov2FilterDisputable.filter(requests);

  const disputable = await Promise.all(filteredRequests.map(DisputerStrategy.process));

  for (const request of disputable) {
    logger.info({
      at: "LLMDisputeBot",
      message: "Disputing request",
      request,
    });
    // TODO: Dispute the request.
  }

  console.log("Done speeding up prices.");
}
