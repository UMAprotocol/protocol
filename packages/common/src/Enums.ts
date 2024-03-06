// Corresponds to Registry.Roles.
export const RegistryRolesEnum = { OWNER: "0", CONTRACT_CREATOR: "1" };

export const TokenRolesEnum = { OWNER: "0", MINTER: "1", BURNER: "3" };

// Corresponds to VoteTiming.Phase.
export const VotePhasesEnum = { COMMIT: "0", REVEAL: "1" };

// States for an EMP's Liquidation to be in.
export const LiquidationStatesEnum = {
  UNINITIALIZED: "0",
  PRE_DISPUTE: "1",
  PENDING_DISPUTE: "2",
  DISPUTE_SUCCEEDED: "3",
  DISPUTE_FAILED: "4",
};

// Maps the `liquidationStatus` property in the `LiquidationWithdrawn` event to human readable statuses.
// Note that these are status translations AFTER a withdrawLiquidation method is called
export const PostWithdrawLiquidationRewardsStatusTranslations = {
  0: "Uninitialized",
  1: "NotDisputed",
  2: "Disputed",
  3: "DisputeSucceeded",
  4: "DisputeFailed",
};

// States for an EMP's Position to be in.
export const PositionStatesEnum = { OPEN: "0", EXPIRED_PRICE_REQUESTED: "1", EXPIRED_PRICE_RECEIVED: "2" };

export const PriceRequestStatusEnum = { NOT_REQUESTED: "0", ACTIVE: "1", RESOLVED: "2", FUTURE: "3" };

export const OptimisticOracleRequestStatesEnum = {
  INVALID: "0",
  REQUESTED: "1",
  PROPOSED: "2",
  EXPIRED: "3",
  DISPUTED: "4",
  RESOLVED: "5",
  SETTLED: "6",
};

export const InsuredBridgeRelayStateEnum = {
  UNINITIALIZED: "0",
  PENDING: "1",
  FINALIZED: "2",
};

// Corresponds to GovernorV2.Roles.
export const GovernorV2RolesEnum = {
  OWNER: "0",
  PROPOSER: "1",
  EMERGENCY_PROPOSER: "2",
};
