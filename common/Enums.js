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
const PostWithdrawLiquidationRewardsStatusTranslations = {
  "0": "Dispute failed",
  "1": "Liquidation expired",
  "3": "Dispute succeeded"
  // Post `withdrawLiquidation()`, the status cannot be "PendingDispute/2" or "DisputeFailed/4"
};

// States for an EMP's Position to be in.
const PositionStatesEnum = {
  OPEN: "0",
  EXPIRED_PRICE_REQUESTED: "1",
  EXPIRED_PRICE_RECEIVED: "2"
};

module.exports = {
  RegistryRolesEnum,
  VotePhasesEnum,
  LiquidationStatesEnum,
  PostWithdrawLiquidationRewardsStatusTranslations,
  PositionStatesEnum
};
