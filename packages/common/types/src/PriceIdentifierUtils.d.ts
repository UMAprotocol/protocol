export namespace IDENTIFIER_BLACKLIST {
    const SOME_IDENTIFIER: string[];
}
export const IDENTIFIER_NON_18_PRECISION: {
    USDBTC: number;
    "STABLESPREAD/USDC": number;
    "STABLESPREAD/BTC": number;
    "ELASTIC_STABLESPREAD/USDC": number;
    BCHNBTC: number;
};
export function getPrecisionForIdentifier(identifier: any): any;
