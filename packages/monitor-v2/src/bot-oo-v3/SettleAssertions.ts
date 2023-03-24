import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticOracleV3Ethers } from "./common";
import { logSettleAssertion } from "./BotLogger";

export async function settleAssertions(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oo = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>("OptimisticOracleV3", params.provider);

  const assertions = await oo.queryFilter(oo.filters.AssertionMade(), undefined, undefined);
  const assertionsSettled = await oo.queryFilter(oo.filters.AssertionSettled(), undefined, undefined);

  const assertionsToSettle = assertions.filter(
    (assertion) => !assertionsSettled.some((settled) => settled.args.assertionId === assertion.args.assertionId)
  );

  const setteableAssertions = [];
  for (const assertion of assertionsToSettle) {
    try {
      await oo.callStatic.settleAndGetAssertionResult(assertion.args.assertionId);
      setteableAssertions.push(assertion.args);
      console.log(`Assertion ${assertion.args.assertionId} is setteable.`);
    } catch (err) {
      console.log(`Assertion ${assertion.args.assertionId} is not setteable yet.`);
    }
  }

  for (const assertion of setteableAssertions) {
    const tx = await oo.connect(params.signer).settleAssertion(assertion.assertionId);
    const receipt = await tx.wait();
    const event = receipt.events?.find((e) => e.event === "AssertionSettled");
    await logSettleAssertion(
      logger,
      {
        tx: tx.hash,
        assertionId: assertion.assertionId,
        claim: assertion.claim,
        bond: assertion.bond,
        identifier: assertion.identifier,
        currency: assertion.currency,
        settlementResolution: event?.args?.settlementResolution,
      },
      params
    );
  }
}
