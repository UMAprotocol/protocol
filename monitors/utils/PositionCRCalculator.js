// Calculate the collateralization Ratio from the collateral, token amount and token price
// This is cr = [collateral / (tokensOutstanding * price)] * 100
const calculatePositionCRPercent = (web3, collateral, tokensOutstanding, priceFunction) => {
  return web3.utils
    .toBN(collateral)
    .mul(web3.utils.toBN(web3.utils.toWei("1")))
    .mul(web3.utils.toBN(web3.utils.toWei("1")))
    .div(web3.utils.toBN(tokensOutstanding).mul(web3.utils.toBN(priceFunction.toString())))
    .muln(100);
};

module.exports = {
  calculatePositionCRPercent
};
