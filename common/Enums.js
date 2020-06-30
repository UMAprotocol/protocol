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
  PositionStatesEnum,
  PriceRequestStatusEnum
};
