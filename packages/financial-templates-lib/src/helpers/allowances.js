const { MAX_SAFE_ALLOWANCE, MAX_UINT_VAL, runTransaction } = require("@uma/common");
const { getAbi } = require("@uma/core");

// Sets `owner` allowance for `spender` to MAX_UINT_VAL, unless `spender` already has
// an allowance > MAX_SAFE_ALLOWANCE. Return successful approval transaction data, or undefined
// for skipped approvals.
const setAllowance = async (web3, gasEstimator, ownerAddress, spenderAddress, currencyAddress) => {
  const { toBN } = web3.utils;
  const collateralToken = new web3.eth.Contract(getAbi("ExpandedERC20"), currencyAddress);
  const currentCollateralAllowance = await collateralToken.methods.allowance(ownerAddress, spenderAddress).call();
  if (toBN(currentCollateralAllowance).lt(toBN(MAX_SAFE_ALLOWANCE))) {
    const approveTransaction = collateralToken.methods.approve(spenderAddress, MAX_UINT_VAL);
    const { receipt } = await runTransaction({
      web3,
      transaction: approveTransaction,
      transactionConfig: { ...gasEstimator.getCurrentFastPrice(), from: ownerAddress },
    });
    return { tx: receipt, spenderAddress, currencyAddress };
  }
};

module.exports = { setAllowance };
