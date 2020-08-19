/**
 * Get the collateralization ratio for an EMP position.
 * Note: all inputs and outputs are expressed as fixed-point (scaled by 1e18) BNs.
 * @param {Object} web3 instance
 * @param {BN} current token price
 * @param {BN} amount of collateral in the position
 * @param {BN} number of tokens that have been borrowed/minted against the position
 * @return {BN} collateralization ratio.
 */
function computeCollateralizationRatio(web3, tokenPrice, collateral, tokensOutstanding) {
  const { toWei, toBN } = web3.utils;
  const fixedPointScalingFactor = toBN(toWei("1"));
  if (tokensOutstanding.isZero() || tokenPrice.isZero()) {
    return toBN("0");
  }
  return collateral
    .mul(fixedPointScalingFactor)
    .mul(fixedPointScalingFactor)
    .div(tokensOutstanding)
    .div(tokenPrice);
}

module.exports = {
  computeCollateralizationRatio
};
