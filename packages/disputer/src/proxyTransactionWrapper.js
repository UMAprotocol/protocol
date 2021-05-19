const assert = require("assert");

const { createObjectFromDefaultProps, runTransaction, blockUntilBlockMined, MAX_UINT_VAL } = require("@uma/common");
const { getAbi, getTruffleContract } = require("@uma/core");

class ProxyTransactionWrapper {
  /**
   * @notice Constructs new ProxyTransactionWrapper. This adds support DSProxy atomic dispute support to the bots.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {Object} financialContract instance of a financial contract. Either a EMP or a perp. Used to send disputes.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} dsProxyManager Module to send transactions via DSProxy. If null will use the unlocked account EOA.
   * @param {Boolean} useDsProxyToDispute Toggles the mode Disputes will be sent with. If true then then Disputes.
   * are sent from the DSProxy. Else, Transactions are sent from the EOA. If true dsProxyManager must not be null.
   * @param {Object} proxyTransactionWrapperConfig configuration object used to paramaterize how the DSProxy is used. Expected:
   *      { uniswapRouterAddress: 0x123..., // uniswap router address. Defaults to mainnet router
            disputerReserveCurrencyAddress: 0x123... // address of the reserve currency for the bot to trade against
            maxReserverTokenSpent: "10000" // define the maximum amount of reserve currency the bot should use in 1tx. }
   * */
  constructor({
    web3,
    financialContract,
    gasEstimator,
    account,
    dsProxyManager = undefined,
    proxyTransactionWrapperConfig,
  }) {
    this.web3 = web3;
    this.financialContract = financialContract;
    this.gasEstimator = gasEstimator;
    this.account = account;
    this.dsProxyManager = dsProxyManager;

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.toChecksumAddress = this.web3.utils.toChecksumAddress;

    this.tradeDeadline = 10 * 60 * 60;

    // TODO: refactor the router to pull from a constant file.
    const defaultConfig = {
      useDsProxyToDispute: {
        value: false,
        isValid: (x) => {
          return typeof x == "boolean";
        },
      },
      uniswapRouterAddress: {
        value: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
        isValid: (x) => {
          return this.web3.utils.isAddress(x);
        },
      },
      disputerReserveCurrencyAddress: {
        value: "",
        isValid: (x) => {
          return this.web3.utils.isAddress(x) || x === "";
        },
      },
      maxReserverTokenSpent: {
        value: MAX_UINT_VAL,
        isValid: (x) => {
          return typeof x == "string";
        },
      },
    };

    // Validate and set config settings to class state.
    const configWithDefaults = createObjectFromDefaultProps(proxyTransactionWrapperConfig, defaultConfig);
    Object.assign(this, configWithDefaults);

    // Preform some basic initalization sanity checks.
    if (this.useDsProxyToDispute) {
      assert(
        this.dsProxyManager && this.dsProxyManager.getDSProxyAddress(),
        "DSProxy Manger has not yet been initialized!"
      );
      assert(this.dsProxyManager != undefined, "Cant use dsProxy to dispute if the client is set to undefined!");
      assert(
        this.web3.utils.isAddress(this.disputerReserveCurrencyAddress),
        "Must provide a reserve currency address to use the proxy transaction wrapper!"
      );
    }

    this.reserveToken = new this.web3.eth.Contract(getAbi("ExpandedERC20"), this.disputerReserveCurrencyAddress);
    this.ReserveCurrencyDisputer = getTruffleContract("ReserveCurrencyDisputer", this.web3);
  }

  // Main entry point for submitting a dispute. If the bot is not using a DSProxy then simply send a normal EOA tx.
  // If the bot is using a DSProxy then route the tx via it.
  async submitDisputeTransaction(disputeArgs) {
    // If the liquidator is not using a DSProxy, use the old method of liquidating
    if (!this.useDsProxyToDispute) return await this._executeDisputeWithoutDsProxy(disputeArgs);
    else return await this._executeDisputeWithDsProxy(disputeArgs);
  }

  async _executeDisputeWithoutDsProxy(disputeArgs) {
    // Dispute strategy will control how much to liquidate
    // Create the transaction.
    const dispute = this.financialContract.methods.dispute(...disputeArgs);

    // Send the transaction or report failure.
    let receipt, returnValue;
    try {
      // Get successful transaction receipt and return value or error.
      const transactionResult = await runTransaction({
        transaction: dispute,
        config: {
          gasPrice: this.gasEstimator.getCurrentFastPrice(),
          from: this.account,
          nonce: await this.web3.eth.getTransactionCount(this.account),
        },
      });
      receipt = transactionResult.receipt;
      returnValue = transactionResult.returnValue.toString();
    } catch (error) {
      return error;
    }

    return {
      type: "Standard EOA Dispute",
      tx: receipt && receipt.transactionHash,
      sponsor: receipt.events.LiquidationDisputed.returnValues.sponsor,
      liquidator: receipt.events.LiquidationDisputed.returnValues.liquidator,
      id: receipt.events.LiquidationDisputed.returnValues.liquidationId,
      disputeBondPaid: receipt.events.LiquidationDisputed.returnValues.disputeBondAmount,
      totalPaid: returnValue,
      txnConfig: {
        gasPrice: this.gasEstimator.getCurrentFastPrice(),
        from: this.account,
      },
    };
  }

  async _executeDisputeWithDsProxy(disputeArgs) {
    const reserveCurrencyDisputer = new this.web3.eth.Contract(this.ReserveCurrencyDisputer.abi);

    const callData = reserveCurrencyDisputer.methods
      .swapDispute(
        this.uniswapRouterAddress, // uniswapRouter
        this.financialContract._address, // financialContract
        this.reserveToken._address, // reserveCurrency
        disputeArgs[0], // liquidationId
        disputeArgs[1], // sponsor
        this.maxReserverTokenSpent, // maxReserverTokenSpent
        Number((await this.web3.eth.getBlock("latest")).timestamp) + this.tradeDeadline
      )
      .encodeABI();
    const callCode = this.ReserveCurrencyDisputer.bytecode;

    const dsProxyCallReturn = await this.dsProxyManager.callFunctionOnNewlyDeployedLibrary(callCode, callData);
    const blockAfterDispute = await this.web3.eth.getBlockNumber();

    // Wait exactly one block to fetch events. This ensures that the events have been indexed by your node.
    await blockUntilBlockMined(this.web3, blockAfterDispute + 1);

    const DisputeEvent = (
      await this.financialContract.getPastEvents("LiquidationDisputed", {
        fromBlock: blockAfterDispute - 1,
        filter: { disputer: this.dsProxyManager.getDSProxyAddress() },
      })
    )[0];

    // Return the same data sent back from the EOA Dispute.
    return {
      type: "DSProxy Swap and dispute transaction",
      tx: dsProxyCallReturn.transactionHash,
      sponsor: DisputeEvent.returnValues.sponsor,
      liquidator: DisputeEvent.returnValues.liquidator,
      disputer: DisputeEvent.returnValues.disputer,
      liquidationId: DisputeEvent.returnValues.liquidationId,
      disputeBondAmount: DisputeEvent.returnValues.disputeBondAmount,
      txnConfig: {
        from: dsProxyCallReturn.from,
        gas: dsProxyCallReturn.gasUsed,
      },
    };
  }
}

module.exports = { ProxyTransactionWrapper };
