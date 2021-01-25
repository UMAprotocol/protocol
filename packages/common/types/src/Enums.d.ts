export namespace RegistryRolesEnum {
    const OWNER: string;
    const CONTRACT_CREATOR: string;
}
export namespace VotePhasesEnum {
    const COMMIT: string;
    const REVEAL: string;
}
export namespace LiquidationStatesEnum {
    const UNINITIALIZED: string;
    const PRE_DISPUTE: string;
    const PENDING_DISPUTE: string;
    const DISPUTE_SUCCEEDED: string;
    const DISPUTE_FAILED: string;
}
export const PostWithdrawLiquidationRewardsStatusTranslations: {
    "0": string;
    "3": string;
};
export namespace PositionStatesEnum {
    const OPEN: string;
    const EXPIRED_PRICE_REQUESTED: string;
    const EXPIRED_PRICE_RECEIVED: string;
}
export namespace PriceRequestStatusEnum {
    const NOT_REQUESTED: string;
    const ACTIVE: string;
    const RESOLVED: string;
    const FUTURE: string;
}
export namespace OptimisticOracleRequestStatesEnum {
    export const INVALID: string;
    export const REQUESTED: string;
    export const PROPOSED: string;
    export const EXPIRED: string;
    export const DISPUTED: string;
    const RESOLVED_1: string;
    export { RESOLVED_1 as RESOLVED };
    export const SETTLED: string;
}
