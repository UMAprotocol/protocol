const Token = artifacts.require("ExpandedERC20");
const OneSplit = artifacts.require("OneSplit");

// As defined in 1inch
const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const ONE_SPLIT_ADDRESS = "0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E";

class OneInchExchange {
  /**
   * @notice Creates OneInchExchange client
   * @param {Object} param - Constructor params
   * @param {Object} param.web3 - Web3 instance
   * @param {Object} param.gasEstimator - GasEstimator instance
   * @param {string} param.oneSplitAddress - Address of the One Split
   * */
  constructor({ web3, gasEstimator, oneSplitAddress = ONE_SPLIT_ADDRESS }) {
    this.logger = gasEstimator.logger;
    this.gasEstimator = gasEstimator;
    this.oneSplitAddress = oneSplitAddress;

    this.web3 = web3;
    this.web3.currentProvider.timeout = 1200000;
    this.oneSplitContract = new web3.eth.Contract(OneSplit.abi, this.oneSplitAddress);

    this.toBN = web3.utils.toBN;
  }

  /**
   * @notice Swaps token on one inch
   * @param {Object} swapArgs - Swap arguments
   * @param {string} swapArgs.fromToken Address of token to swap from
   * @param {string} swapArgs.toToken Address of token to swap to.
   * @param {string} swapArgs.amountWei String amount to swap, in Wei.
   * @param {Object} options Web3 options to supply to send, e.g.
   *      { from: '0x0...',
            value: '1000',
            gasPrice: '... }
   */
  async swap({ fromToken, toToken, amountWei }, options = {}) {
    // Update gasEstimator state
    await this.gasEstimator.update();

    // Current time for debugging
    const currentTime = Math.floor(Date.now() / 1000);

    const gasPrice = this.gasEstimator.getCurrentFastPrice();

    if (!options.from) {
      throw new Error("Missing from key in options");
    }

    // Need to approve ERC20 tokens
    if (fromToken !== ETH_ADDRESS) {
      const erc20 = await Token.at(fromToken);
      await erc20.approve(this.oneSplitAddress, amountWei, {
        from: options.from,
        gasPrice
      });
    }

    // 1 Split config
    const flags = 0; // Enables all exchanges

    // Number of pieces source volume could be splitted
    // (Works like granularity, higly affects gas usage.
    // Should be called offchain, but could be called onchain
    // if user swaps not his own funds, but this is still considered
    // as not safe)
    // More info: https://github.com/CryptoManiacsZone/1inchProtocol#getexpectedreturn
    const parts = 2;

    const expectedReturn = await this.oneSplitContract.methods
      .getExpectedReturn(fromToken, toToken, amountWei, parts, flags)
      .call();

    const { returnAmount, distribution } = expectedReturn;

    this.logger.debug({
      at: "OneInchExchange",
      message: "GetExpectedReturn",
      returnAmount,
      distribution
    });

    // TODO: Remove hardcoded gas
    const tx = await this.oneSplitContract.methods
      .swap(fromToken, toToken, amountWei, returnAmount, distribution, flags)
      .send({ ...options, gasPrice, gas: 8000000 });

    this.logger.debug({
      at: "OneInchExchange",
      message: "Swapped",
      fromToken,
      toToken
    });

    return tx;
  }
}

module.exports = {
  OneInchExchange
};
