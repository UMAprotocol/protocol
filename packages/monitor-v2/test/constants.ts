import { formatBytes32String, parseUnits } from "./utils";

export const defaultLiveness = 7200;

export const defaultCurrency = { name: "Bond", symbol: "BOND", decimals: 18, finalFee: parseUnits("100") };

export const defaultOptimisticOracleV3Identifier = formatBytes32String("ASSERT_TRUTH");

export const zeroRawValue = { rawValue: "0" };
