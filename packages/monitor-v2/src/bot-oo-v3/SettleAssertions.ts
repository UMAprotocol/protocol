import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleV3Ethers } from "./common";
import { logSettleAssertion } from "./BotLogger";
import { paginatedEventQuery } from "@uma/common";
import {
  AssertionSettledEvent,
  AssertionMadeEvent,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV3";

export async function settleAssertions(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oo = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", params.provider);

  const currentBlock = await params.provider.getBlock("latest");

  const fromBlock = await params.blockFinder.getBlockForTimestamp(currentBlock.timestamp - params.timeLookback);

  const searchConfig = {
    fromBlock: fromBlock.number,
    toBlock: currentBlock.number,
    maxBlockLookBack: params.maxBlockLookBack,
  };

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

  const setteableAssertions: AssertionMadeEvent[] = [];
  for (const assertion of assertionsToSettle) {
    try {
      await oo.callStatic.settleAndGetAssertionResult(assertion.args.assertionId);
      setteableAssertions.push(assertion);
      console.log(`Assertion ${assertion.args.assertionId} is setteable.`);
    } catch (err) {
      console.log(`Assertion ${assertion.args.assertionId} is not setteable yet.`);
    }
  }

  for (const assertion of setteableAssertions) {
    const tx = await oo.connect(params.signer).settleAssertion(assertion.args.assertionId);
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
  }
}
