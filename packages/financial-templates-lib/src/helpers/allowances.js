const { MAX_UINT_VAL } = require("@uma/common");
const { getAbi } = require("@uma/core");

// Sets `owner` allowance for `spender` to MAX, unless `spender` already has an allowance > 1/2 of the MAX_UINT.
// Return array of successful approval transactions or undefined for skipped approvals.
const setAllowance = async (web3, gasEstimator, ownerAddress, spenderAddress, currencyAddress) => {
  const { toBN } = web3.utils;

  // Increase `perpetualAddress` allowance to MAX for the collateral @ `currencyAddress`
  const collateralToken = new web3.eth.Contract(getAbi("ExpandedERC20"), currencyAddress);
  const currentCollateralAllowance = await collateralToken.methods.allowance(ownerAddress, spenderAddress).call();
  if (toBN(currentCollateralAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
    return {
      tx: await collateralToken.methods.approve(spenderAddress, MAX_UINT_VAL).send({
        from: ownerAddress,
        gasPrice: gasEstimator.getCurrentFastPrice()
      }),
      spenderAddress,
      currencyAddress
    };
  }
};

module.exports = {
  setAllowance
};
