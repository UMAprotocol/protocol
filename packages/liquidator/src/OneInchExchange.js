const { ONE_SPLIT_ADDRESS, ALTERNATIVE_ETH_ADDRESS, GAS_LIMIT, GAS_LIMIT_BUFFER } = require("./constants");

class OneInchExchange {
  /**
   * @notice Creates OneInchExchange client
   * @param {Object} param - Constructor params
   * @param {Object} param.web3 - Web3 instance
   * @param {Object} param.gasEstimator - GasEstimator instance
   * @param {string} param.oneSplitAddress - Address of the One Split
   * */
  constructor({ web3, gasEstimator, logger, oneSplitAbi, erc20TokenAbi, oneSplitAddress }) {
    if (!oneSplitAddress) {
      throw new Error("Missing oneSplitAddress in OneInchEcchange constructor!");
    }

    this.logger = logger;
    this.gasEstimator = gasEstimator;
    this.oneSplitAddress = oneSplitAddress;

    this.web3 = web3;
    this.web3.currentProvider.timeout = 1200000;
    this.oneSplitContract = new web3.eth.Contract(oneSplitAbi, this.oneSplitAddress);
    this.erc20TokenAbi = erc20TokenAbi;

    this.toBN = web3.utils.toBN;

    // 1 Split config
    this.oneInchFlags = 0; // Enables all exchanges

    // Number of pieces source volume could be splitted (Works like granularity, higly affects gas usage.
    // Should be called offchain, but could be called onchain if user swaps not his own funds, but this is still
    // considered as not safe). More info: https://github.com/CryptoManiacsZone/1inchProtocol#getexpectedreturn
    this.oneInchParts = 2;
  }

  /**
   * @notice Gets expected returns on one inch
   * @param {Object} swapArgs - Swap arguments
   * @param {string} swapArgs.fromToken Address of token to swap from
   * @param {string} swapArgs.toToken Address of token to swap to.
   * @param {string} swapArgs.amountWei String amount to swap, in Wei.
   * @param {Object} options Web3 options to supply to send, e.g.
   *      { from: '0x0...',
            value: '1000',
            gasPrice: '... }
   */
  async getExpectedReturn({ fromToken, toToken, amountWei }) {
    const expectedReturn = await this.oneSplitContract.methods
      .getExpectedReturn(fromToken, toToken, amountWei, this.oneInchParts, this.oneInchFlags)
      .call();

    const { returnAmount } = expectedReturn;

    return returnAmount;
  }

  /**
   * @notice Swaps token on one inch
   * @param {Object} swapArgs - Swap arguments
   * @param {string} swapArgs.fromToken Address of token to swap from
   * @param {string} swapArgs.toToken Address of token to swap to.
   * @param {string} swapArgs.minReturnAmountWei Min expected return amount, in Wei.
   * @param {string} swapArgs.amountWei String amount to swap, in Wei.
   * @param {Object} options Web3 options to supply to send, e.g.
   *      { from: '0x0...',
            value: '1000',
            gasPrice: '... }
   */
  async swap({ fromToken, toToken, minReturnAmountWei, amountWei }, options = {}) {
    // Current time for debugging
    const currentTime = Math.floor(Date.now() / 1000);

    const gasPrice = this.gasEstimator.getCurrentFastPrice();

    if (!options.from) {
      throw new Error("Missing from key in options");
    }

    // Need to approve ERC20 tokens
    if (fromToken !== ALTERNATIVE_ETH_ADDRESS) {
      const erc20 = new web3.eth.Contract(this.erc20TokenAbi, fromToken);
      await erc20.methods.approve(this.oneSplitAddress, amountWei).send({
        from: options.from,
        gasPrice
      });
    }

    const expectedReturn = await this.oneSplitContract.methods
      .getExpectedReturn(fromToken, toToken, amountWei, this.oneInchParts, this.oneInchFlags)
      .call();

    const { returnAmount, distribution } = expectedReturn;

    this.logger.debug({
      at: "OneInchExchange",
      message: "GetExpectedReturn",
      currentTime,
      returnAmount,
      distribution
    });

    if (minReturnAmountWei && this.toBN(returnAmount.toString()).lt(this.toBN(minReturnAmountWei.toString()))) {
      this.logger.warn({
        at: "OneInchExchange",
        message: "One Inch exchange return amount too low",
        currentTime,
        returnAmount,
        minReturnAmountWei
      });
      return;
    }

    // Swap
    const swapPartialFunc = await this.oneSplitContract.methods.swap(
      fromToken,
      toToken,
      amountWei,
      returnAmount,
      distribution,
      this.oneInchFlags
    );
    const swapFOptions = {
      ...options,
      gasPrice,
      gas: 8000000,
      value: fromToken === ALTERNATIVE_ETH_ADDRESS ? amountWei : 0
    };

    const gasEstimation = await swapPartialFunc.estimateGas(swapFOptions);
    const gas = Math.min(Math.floor(gasEstimation * GAS_LIMIT_BUFFER), GAS_LIMIT);

    const tx = await swapPartialFunc.send({ ...swapFOptions, gas });

    this.logger.debug({
      at: "OneInchExchange",
      message: "Swapped",
      currentTime,
      fromToken,
      toToken,
      ...tx
    });

    return tx;
  }
}

module.exports = {
  OneInchExchange
};
