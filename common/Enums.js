// Corresponds to Registry.Roles.
const RegistryRolesEnum = {
  OWNER: "0",
  CONTRACT_CREATOR: "1"
};

// Corresponds to VoteTiming.Phase.
const VotePhasesEnum = {
  COMMIT: "0",
  REVEAL: "1"
};

// States for an EMP's Liquidation to be in.
const LiquidationStatesEnum = {
  UNINITIALIZED: "0",
  PRE_DISPUTE: "1",
  PENDING_DISPUTE: "2",
  DISPUTE_SUCCEEDED: "3",
  DISPUTE_FAILED: "4"
};

// Maps the `liquidationStatus` property in the `LiquidationWithdrawn` event to human readable statuses.
// Note that these are status translations AFTER a withdrawLiquidation method is called
const PostWithdrawLiquidationRewardsStatusTranslations = {
  "0": "Liquidation deleted; All rewards have been withdrawn",
  "3": "Dispute succeeded; Not all rewards have been withdrawn"
  // @dev: Post `withdrawLiquidation()`, the status cannot be "2:PendingDispute", "1:PreDispute" or "4:DisputeFailed"
  // @dev: If a liquidation has expired (i.e. is pre-dispute) or a dispute has failed, then the first withdrawLiquidation() call will delete the liquidation
  // and reset its state to 0.
};

// States for an EMP's Position to be in.
const PositionStatesEnum = {
  OPEN: "0",
  EXPIRED_PRICE_REQUESTED: "1",
  EXPIRED_PRICE_RECEIVED: "2"
};

const PriceRequestStatusEnum = {
  NOT_REQUESTED: "0",
  ACTIVE: "1",
  RESOLVED: "2",
  FUTURE: "3"
};

module.exports = {
  RegistryRolesEnum,
  VotePhasesEnum,
  LiquidationStatesEnum,
  PostWithdrawLiquidationRewardsStatusTranslations,
  PositionStatesEnum,
  PriceRequestStatusEnum
};
