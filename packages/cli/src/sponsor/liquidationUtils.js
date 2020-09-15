const { LiquidationStatesEnum } = require("@uma/common");

/**
 * @notice Fetch all liquidation events for a given sponsor. Use this instead of reading `emp.getLiquidations(sponsor)`
 * because liquidations are deleted after their rewards are withdrawn.
 * @param {Object} emp EMP contract
 * @param {String} sponsor Sponsor addre
 */
const getLiquidationEvents = async (emp, sponsor) => {
  return await emp.getPastEvents("LiquidationCreated", {
    fromBlock: 0,
    filter: { sponsor }
  });
};

/**
 * @notice Informs sponsor about the state of their previous liquidation events.
 * @param {Integer} state Liquidation state
 */
const liquidationStateToDisplay = state => {
  switch (state) {
    case LiquidationStatesEnum.DISPUTE_SUCCEEDED:
      return "SUCCESSFULLY DISPUTED";
    case LiquidationStatesEnum.PRE_DISPUTE:
      return "LIQUIDATION PENDING OR EXPIRED";
    case LiquidationStatesEnum.PENDING_DISPUTE:
      return "PENDING DISPUTE";
    default:
      // All liquidation rewards have been withdrawn.
      return "EXPIRED OR NO MORE REWARDS TO WITHDRAW";
    // Note: The state will never be DISPUTE_FAILED because this state is only temporarily
    // set when the liquidator calls `withdrawLiquidation` and the dispute fails. The liquidation
    // data is subsequently deleted in the same struct.
  }
};

module.exports = {
  getLiquidationEvents,
  liquidationStateToDisplay
};
