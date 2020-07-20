const Token = artifacts.require("ExpandedERC20");

const oneSplitAbi = require("./abi/OneSplit.json");
const oneSplitAddress = "0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E";

// As defined in 1inch
const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

class OneInchExchange {
  /**
   * @notice Creates OneInchExchange client
   * @param {Object} web3 Web3 instance
   * */
  constructor({ web3, gasEstimator }) {
    this.gasEstimator = gasEstimator;

    this.web3 = web3;
    this.web3.currentProvider.timeout = 1200000;
    this.oneSplitContract = new web3.eth.Contract(oneSplitAbi, oneSplitAddress);

    this.toBN = web3.utils.toBN;
  }

  /**
   * @notice Swaps token on one inch
   * @param {string} fromToken Address of token to swap from
   * @param {string} toToken Address of token to swap to.
   * @param {string} amountWei String amount to swap, in Wei.
   * @param {Object} options Web3 options to supply to send, e.g.
   *      { from: '0x0...',
            value: '1000',
            gasPrice: '... }
   */
  async swap({ fromToken, toToken, amountWei }, options = {}) {
    // Implicit update to get the gasPrice :|
    await this.gasEstimator.update();

    const gasPrice = this.gasEstimator.getCurrentFastPrice();

    if (!options.from) {
      throw new Error("Missing from key in options");
    }

    // Need to approve ERC20 tokens
    if (fromToken !== ETH_ADDRESS) {
      const erc20 = await Token.at(fromToken);
      await erc20.approve(oneSplitAddress, amountWei, {
        from: options.from,
        gasPrice
      });
    }

    // 1 Split config
    const flags = 0; // Enables all exchanges
    const parts = 2;

    const expectedReturn = await this.oneSplitContract.methods
      .getExpectedReturn(fromToken, toToken, amountWei, parts, flags)
      .call();

    const { returnAmount, distribution } = expectedReturn;

    const tx = await this.oneSplitContract.methods
      .swap(fromToken, toToken, amountWei, returnAmount, distribution, flags)
      .send({ ...options, gasPrice, gas: 8000000 });

    return tx;
  }
}

module.exports = {
  OneInchExchange
};
