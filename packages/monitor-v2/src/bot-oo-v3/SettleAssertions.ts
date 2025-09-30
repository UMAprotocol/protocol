import { paginatedEventQuery, runEthersContractTransaction } from "@uma/common";
import {
  AssertionMadeEvent,
  AssertionSettledEvent,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV3";
import { computeEventSearch } from "../bot-utils/events";
import { logSettleAssertion } from "./BotLogger";
import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleV3Ethers } from "./common";
import { getSettleTxErrorLogLevel } from "../bot-utils/errors";

export async function settleAssertions(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oo = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", params.provider);

  const searchConfig = await computeEventSearch(
    params.provider,
    params.blockFinder,
    params.timeLookback,
    params.maxBlockLookBack
  );

  const assertions = await paginatedEventQuery<AssertionMadeEvent>(oo, oo.filters.AssertionMade(), searchConfig);

  const assertionsSettled = await paginatedEventQuery<AssertionSettledEvent>(
    oo,
    oo.filters.AssertionSettled(),
    searchConfig
  );

  const assertionsSettledIds = new Set(assertionsSettled.map((assertion) => assertion.args.assertionId));

  const assertionsToSettle = assertions.filter(
    (assertion) => !assertionsSettledIds.has(assertion.args.assertionId)
  ) as AssertionMadeEvent[];

  const setteableAssertionsPromises = assertionsToSettle.map(async (assertion) => {
    try {
      await oo.callStatic.settleAndGetAssertionResult(assertion.args.assertionId, {
        blockTag: params.settleableCheckBlock,
      });
      logger.debug({
        at: "OOv3Bot",
        message: "Assertion is settleable",
        assertionId: assertion.args.assertionId,
      });
      return assertion;
    } catch (err) {
      return null;
    }
  });

  const setteableAssertions = (await Promise.all(setteableAssertionsPromises)).filter(
    (assertion): assertion is AssertionMadeEvent => assertion !== null
  );

  if (setteableAssertions.length > 0) {
    logger.debug({
      at: "OOv3Bot",
      message: "Settleable assertions found",
      count: setteableAssertions.length,
    });
  }

  const ooWithSigner = oo.connect(params.signer);

  for (const [i, assertion] of setteableAssertions.entries()) {
    if (params.executionDeadline && Date.now() / 1000 >= params.executionDeadline) {
      logger.warn({
        at: "OOv3Bot",
        message: "Execution deadline reached, skipping settlement",
        remainingAssertions: setteableAssertions.length - i,
      });
      break;
    }

    try {
      const populatedTx = await oo.populateTransaction.settleAssertion(assertion.args.assertionId);

      const tx = await runEthersContractTransaction(ooWithSigner, populatedTx, params.gasLimitMultiplier);
      const receipt = await tx.wait();
      const event = receipt.events?.find((e) => e.event === "AssertionSettled");
      await logSettleAssertion(
        logger,
        {
          tx: tx.hash,
          assertionId: assertion.args.assertionId,
          claim: assertion.args.claim,
          bond: assertion.args.bond,
          identifier: assertion.args.identifier,
          currency: assertion.args.currency,
          settlementResolution: event?.args?.settlementResolution,
        },
        params
      );
    } catch (error) {
      logger[getSettleTxErrorLogLevel(error)]({
        at: "OOv3Bot",
        message: "Assertion settlement failed",
        assertionId: assertion.args.assertionId,
        error,
        notificationPath: "optimistic-oracle",
      });
      continue;
    }
  }
}
