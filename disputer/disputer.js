const { Logger } = require("../financial-templates-lib/Logger");

class Disputer {
  constructor(expiringMultiPartyClient, account) {
    this.account = account;

    // Expiring multiparty contract to read contract state
    this.empClient = expiringMultiPartyClient;

    // Instance of the expiring multiparty to perform on-chain disputes
    this.empContract = this.empClient.emp;
  }

  // Queries disputable liquidations and disputes any that were incorrectly liquidated.
  queryAndDispute = async priceFunction => {
    Logger.debug({
      at: "Disputer",
      message: "Checking for any disputable liquidations"
    });

    // Update the client to get the latest liquidation information.
    await this.empClient._update();

    // Get the latest disputable liquidations from the client.
    const undisputedLiquidations = this.empClient.getUndisputedLiquidations();
    const disputeableLiquidations = undisputedLiquidations.filter(liquidation =>
      this.empClient.isDisputable(liquidation, priceFunction(liquidation.liquidationTime))
    );

    if (disputeableLiquidations.length === 0) {
      Logger.debug({
        at: "liquidator",
        message: "No disputable liquidations"
      });

      // Nothing left to do, so return.
      return;
    }

    Logger.info({
      at: "Disputer",
      message: "Disputable liquidation(s) detected!",
      number: disputeableLiquidations.length,
      disputeableLiquidations: disputeableLiquidations
    });

    for (const disputeableLiquidation of disputeableLiquidations) {
      Logger.info({
        at: "Disputer",
        message: "Disputing liquidation",
        address: disputeableLiquidation.sponsor,
        inputPrice: priceFunction(disputeableLiquidation.liquidationTime)
      });

      // Create the liquidation transaction

      // TODO: compute the amount of collateral required to dispute and ensure the bot has enough to perform it.

      // TODO: handle transaction failures.
      const receipt = await this.empContract.methods
        .dispute(disputeableLiquidation.id, disputeableLiquidation.sponsor)
        .send({ from: this.account, gas: 1500000 });

      const disputeResult = {
        tx: receipt.transactionHash,
        sponsor: receipt.events.LiquidationDisputed.returnValues.sponsor,
        liquidator: receipt.events.LiquidationDisputed.returnValues.liquidator,
        id: receipt.events.LiquidationDisputed.returnValues.disputeId,
        disputeBondPaid: receipt.events.LiquidationDisputed.returnValues.disputeBondAmount
      };
      Logger.info({
        at: "Disputer",
        message: "Dispute tx result",
        disputeResult: disputeResult
      });

      // TODO: query any resolved disputes that this address participated in and attempt to withdraw.
    }
  };
}

module.exports = {
  Disputer
};
