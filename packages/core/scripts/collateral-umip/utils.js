// This function resolves the decimals for a collateral token. A decimals override is optionally passed in to override
// the contract's decimal value.
async function getDecimals(collateralAddress, decimalsOverride, ERC20) {
  const collateral = await ERC20.at(collateralAddress);
  if (decimalsOverride) {
    console.log(`Using user input decimals: ${decimalsOverride} for collateral ${collateralAddress}`);
    return decimalsOverride;
  } else {
    try {
      const decimals = (await collateral.decimals()).toString();
      console.log(`Using decimals returned by contract: ${decimals} for collateral ${collateralAddress}`);
      return decimals;
    } catch (error) {
      throw new Error("Try providing --decimals to prevent the following error: " + error.message);
    }
  }
}

module.exports = { getDecimals };
