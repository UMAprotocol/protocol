export const SECONDS_PER_HOUR = 3600;
export const HOURS_PER_DAY = 24;
export const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;
export const SKIP_THRESHOLD_SECONDS = 4 * SECONDS_PER_HOUR;
export const PHASE_LENGTH_SECONDS = 2 * SECONDS_PER_DAY;
// Gas pricing for receiveMessage transactions on Ethereum: a fixed priority fee and a max fee of the latest block's base
// fee times BASE_FEE_MULTIPLIER (plus the priority fee), which leaves headroom for the base fee to rise before inclusion.
export const MAX_PRIORITY_FEE_PER_GAS_WEI = "1000000"; // 0.001 gwei
export const BASE_FEE_MULTIPLIER = 3;
