export function makeId(data: Pick<Data, "address">) {
  return data.address;
}

export type Data = {
  id?: string;
  // address is required
  address: string;
  syntheticName?: string | null;
  contractState?: string | null;
  collateralToken?: string | null;
  shortToken?: string | null;
  longToken?: string | null;
  longTokenName?: string | null;
  shortTokenName?: string | null;
  collateralTokenName?: string | null;
  priceIdentifier?: string | null;
  expirationTimestamp?: string | null;
  // Price returned from the Optimistic oracle at settlement time.
  expiryPrice?: string | null;
  expiryPercentLong?: string | null;
  expired?: boolean | null;
  customAncillaryData?: string | null;
  // Amount of collateral a pair of tokens is always redeemable for.
  collateralPerPair?: string | null;
  financialProductLibraryAddress?: string | null;
  finder?: string | null;
  proposerReward?: string | null;
  sponsors?: string[] | null;
  // these are not on the contract but queried from erc20
  totalPositionCollateral?: string | null;
  collateralDecimals?: number | null;
  longTokenDecimals?: number | null;
  shortTokenDecimals?: number | null;
  createdTimestamp?: number | null;
};
