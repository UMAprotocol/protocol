const { MAX_SAFE_ALLOWANCE, MAX_UINT_VAL } = require("@uma/common");
const { getAbi } = require("@uma/core");

// Sets `owner` allowance for `spender` to MAX_UINT_VAL, unless `spender` already has
// an allowance > MAX_SAFE_ALLOWANCE. Return successful approval transaction data, or undefined
// for skipped approvals.
const setAllowance = async (web3, gasEstimator, ownerAddress, spenderAddress, currencyAddress) => {
  const { toBN } = web3.utils;

  // Increase `perpetualAddress` allowance to MAX for the collateral @ `currencyAddress`
  const collateralToken = new web3.eth.Contract(getAbi("ExpandedERC20"), currencyAddress);
  const currentCollateralAllowance = await collateralToken.methods.allowance(ownerAddress, spenderAddress).call();
  if (toBN(currentCollateralAllowance).lt(toBN(MAX_SAFE_ALLOWANCE))) {
    return {
      tx: await collateralToken.methods.approve(spenderAddress, MAX_UINT_VAL).send({
        from: ownerAddress,
        gasPrice: gasEstimator.getCurrentFastPrice(),
        // Note: Add chainId in case RPC enforces transactions to be replay-protected, (i.e. enforced in geth v1.10,
        // https://blog.ethereum.org/2021/03/03/geth-v1-10-0/).
        chainId: await web3.eth.getChainId(),
      }),
      spenderAddress,
      currencyAddress,
    };
  }
};

module.exports = {
  setAllowance,
};
