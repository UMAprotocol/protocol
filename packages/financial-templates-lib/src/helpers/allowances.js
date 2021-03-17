const { MAX_SAFE_ALLOWANCE } = require("@uma/common");
const { getAbi } = require("@uma/core");

// Sets `owner` allowance for `spender` to MAX_ALLOWANCE, unless `spender` already has
// an allowance > 1/2 of the MAX_ALLOWANCE. Return successful approval transaction data, or undefined
// for skipped approvals.
const setAllowance = async (web3, gasEstimator, ownerAddress, spenderAddress, currencyAddress) => {
  const { toBN } = web3.utils;

  // Increase `perpetualAddress` allowance to MAX for the collateral @ `currencyAddress`
  const collateralToken = new web3.eth.Contract(getAbi("ExpandedERC20"), currencyAddress);
  const currentCollateralAllowance = await collateralToken.methods.allowance(ownerAddress, spenderAddress).call();
  if (toBN(currentCollateralAllowance).lt(toBN(MAX_SAFE_ALLOWANCE).div(toBN("2")))) {
    return {
      tx: await collateralToken.methods.approve(spenderAddress, MAX_SAFE_ALLOWANCE).send({
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
