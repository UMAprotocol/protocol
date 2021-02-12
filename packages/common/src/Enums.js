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
  "0": "Uninitialized",
  "1": "NotDisputed",
  "2": "Disputed",
  "3": "DisputeSucceeded",
  "4": "DisputeFailed"
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

const OptimisticOracleRequestStatesEnum = {
  INVALID: "0",
  REQUESTED: "1",
  PROPOSED: "2",
  EXPIRED: "3",
  DISPUTED: "4",
  RESOLVED: "5",
  SETTLED: "6"
};

module.exports = {
  RegistryRolesEnum,
  VotePhasesEnum,
  LiquidationStatesEnum,
  PostWithdrawLiquidationRewardsStatusTranslations,
  PositionStatesEnum,
  PriceRequestStatusEnum,
  OptimisticOracleRequestStatesEnum
};
