export function makeId(data: Pick<Data, "address">) {
  return data.address;
}

export type Data = {
  id?: string;
  name?: string | null;
  address: string;
  priceIdentifier?: string | null;
  expirationTimestamp?: string | null;
  withdrawalLiveness?: string | null;
  tokenCurrency?: string | null;
  collateralCurrency?: string | null;
  collateralRequirement?: string | null;
  disputeBondPercentage?: string | null;
  sponsorDisputeRewardPercentage?: string | null;
  disputerDisputeRewardPercentage?: string | null;
  cumulativeFeeMultiplier?: string | null;
  tokenDecimals?: number | null;
  collateralDecimals?: number | null;
  totalTokensOutstanding?: string | null;
  totalPositionCollateral?: string | null;
  minSponsorTokens?: string | null;
  expiryPrice?: string | null;
  sponsors?: string[] | null;
  gcr?: string | null;
  expired?: boolean | null;
  createdTimestamp?: number | null;
};
