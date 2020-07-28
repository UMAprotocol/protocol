const Token = artifacts.require("ExpandedERC20");
const OneSplit = artifacts.require("OneSplit");

const oneSplitAddress = "0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E";

// As defined in 1inch
const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

class OneInchExchange {
  /**
   * @notice Creates OneInchExchange client
   * @param {Object} args.web3 Web3 instance
   * @param {Object} args.gasEstimator GasEstimator instance
   * */
  constructor(args = { web3, gasEstimator }) {
    this.gasEstimator = gasEstimator;

    this.web3 = web3;
    this.web3.currentProvider.timeout = 1200000;
    this.oneSplitContract = new web3.eth.Contract(OneSplit.abi, oneSplitAddress);

    this.toBN = web3.utils.toBN;
  }

  /**
   * @notice Swaps token on one inch
   * @param {string} args.fromToken Address of token to swap from
   * @param {string} args.toToken Address of token to swap to.
   * @param {string} args.amountWei String amount to swap, in Wei.
   * @param {Object} options Web3 options to supply to send, e.g.
   *      { from: '0x0...',
            value: '1000',
            gasPrice: '... }
   */
  async swap(args = { fromToken, toToken, amountWei }, options = {}) {
    // Update gasEstimator state
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

    // TODO: Remove hardcoded gas
    const tx = await this.oneSplitContract.methods
      .swap(fromToken, toToken, amountWei, returnAmount, distribution, flags)
      .send({ ...options, gasPrice, gas: 8000000 });

    return tx;
  }
}

module.exports = {
  OneInchExchange
};
