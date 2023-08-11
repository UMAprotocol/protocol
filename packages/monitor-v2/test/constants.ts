import { formatBytes32String, parseUnits } from "./utils";

// Constants for DVM2.0.
export const baseSlashAmount = parseUnits("0.001", "ether");
export const governanceSlashAmount = parseUnits("0", "ether");
export const emissionRate = parseUnits("0.18", "ether");
export const unstakeCooldown = 60 * 60 * 24 * 7; // 7 days
export const phaseLength = 60 * 60 * 24; // 1 day
export const gat = parseUnits("5000000", "ether");
export const spat = parseUnits("0.5", "ether");
export const maxRolls = 4;
export const maxRequestsPerRound = 1000;
export const minimumWaitTime = 60 * 60 * 24 * 10; // 10 days
export const governorStartingId = 0;
export const governanceProposalBond = parseUnits("5000", "ether");
export const emergencyQuorum = parseUnits("5000000", "ether");
export const totalSupply = parseUnits("100000000", "ether");

// Constants for Optimistic Oracle V3.
export const defaultLiveness = 7200;
export const defaultCurrency = { name: "Bond", symbol: "BOND", decimals: 18, finalFee: parseUnits("100") };
export const defaultOptimisticOracleV3Identifier = formatBytes32String("ASSERT_TRUTH");
export const defaultOptimisticOracleV2Identifier = formatBytes32String("YES_OR_NO_QUERY");
export const zeroRawValue = { rawValue: "0" };
