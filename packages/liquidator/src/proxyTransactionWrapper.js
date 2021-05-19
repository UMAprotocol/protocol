const assert = require("assert");
const truffleContract = require("@truffle/contract");

const { createObjectFromDefaultProps, runTransaction, blockUntilBlockMined, MAX_UINT_VAL } = require("@uma/common");
const { getAbi, getTruffleContract } = require("@uma/core");

const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");

class ProxyTransactionWrapper {
  /**
   * @notice Constructs new ProxyTransactionWrapper. This adds support DSProxy atomic liquidation support to the bots.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {Object} financialContract instance of a financial contract. Either a EMP or a perp. Used to send liquidations.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {Object} syntheticToken Synthetic token issued by the financial contract(tokenCurrency).
   * @param {Object} collateralToken Collateral token backing the financial contract.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} dsProxyManager Module to send transactions via DSProxy. If null will use the unlocked account EOA.
   * @param {Boolean} useDsProxyToLiquidate Toggles the mode liquidations will be sent with. If true then then liquidations.
   * are sent from the DSProxy. Else, Transactions are sent from the EOA. If true dsProxyManager must not be null.
   * @param {Object} proxyTransactionWrapperConfig configuration object used to paramaterize how the DSProxy is used. Expected:
   *      { uniswapRouterAddress: 0x123..., // uniswap router address. Defaults to mainnet router
            uniswapFactoryAddress: 0x123..., // uniswap factory address. Defaults to mainnet factory
            liquidatorReserveCurrencyAddress: 0x123... // address of the reserve currency for the bot to trade against
            maxReserverTokenSpent: "10000" // define the maximum amount of reserve currency the bot should use in 1tx. }
   * */
  constructor({
    web3,
    financialContract,
    gasEstimator,
    syntheticToken,
    collateralToken,
    account,
    dsProxyManager = undefined,
    proxyTransactionWrapperConfig,
  }) {
    this.web3 = web3;
    this.financialContract = financialContract;
    this.gasEstimator = gasEstimator;
    this.syntheticToken = syntheticToken;
    this.collateralToken = collateralToken;
    this.account = account;
    this.dsProxyManager = dsProxyManager;

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.toChecksumAddress = this.web3.utils.toChecksumAddress;

    // TODO: refactor the router to pull from a constant file.
    const defaultConfig = {
      useDsProxyToLiquidate: {
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
      uniswapFactoryAddress: {
        value: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
        isValid: (x) => {
          return this.web3.utils.isAddress(x);
        },
      },
      liquidatorReserveCurrencyAddress: {
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
    if (this.useDsProxyToLiquidate) {
      assert(
        this.dsProxyManager && this.dsProxyManager.getDSProxyAddress(),
        "DSProxy Manger has not yet been initialized!"
      );
      assert(this.dsProxyManager != undefined, "Cant use dsProxy to liquidate if the client is set to undefined!");
      assert(
        this.web3.utils.isAddress(this.liquidatorReserveCurrencyAddress),
        "Must provide a reserve currency address to use the proxy transaction wrapper!"
      );
    }

    this.reserveToken = new this.web3.eth.Contract(getAbi("ExpandedERC20"), this.liquidatorReserveCurrencyAddress);
    this.ReserveCurrencyLiquidator = getTruffleContract("ReserveCurrencyLiquidator", this.web3);
  }

  // TODO: wrap this into a common util.
  createContractObjectFromJson(contractJsonObject) {
    let truffleContractCreator = truffleContract(contractJsonObject);
    truffleContractCreator.setProvider(this.web3.currentProvider);
    return truffleContractCreator;
  }

  // Get the effective synthetic token balance. If the bot is executing in normal mode (liquidations sent from an EOA)
  // then this is simply the token balance of the unlocked account. If the liquidator is using a DSProxy to liquidate,
  // then consider the synthetics could be minted, + any synthetics the DSProxy already has.
  async getEffectiveSyntheticTokenBalance() {
    const syntheticTokenBalance = await this.syntheticToken.methods.balanceOf(this.account).call();
    // If using the DSProxy to liquidate then return the current synthetic token balance.
    if (!this.useDsProxyToLiquidate) return syntheticTokenBalance;
    else {
      // Else, if using the DSProxy to liquidate we need to work out the effective balance.
      const [contractPFC, contractTokensOutstanding, reserveTokenBalance, collateralTokenBalance] = await Promise.all([
        this.financialContract.methods.pfc().call(),
        this.financialContract.methods.totalTokensOutstanding().call(),
        this.reserveToken.methods.balanceOf(this.dsProxyManager.getDSProxyAddress()).call(),
        this.collateralToken.methods.balanceOf(this.dsProxyManager.getDSProxyAddress()).call(),
      ]);
      let maxPurchasableCollateral = this.toBN("0"); // set to the reserve token balance (if reserve==collateral) or the max purchasable.

      // If the reserve currency is the collateral currency then there is no trading needed.
      if (this.toChecksumAddress(this.reserveToken._address) === this.toChecksumAddress(this.collateralToken._address))
        maxPurchasableCollateral = this.toBN(reserveTokenBalance);
      // Else, work out how much collateral could be purchased using all the reserve currency.
      else {
        // Instantiate uniswap factory to fetch the pair address.
        const uniswapFactory = await this.createContractObjectFromJson(UniswapV2Factory).at(this.uniswapFactoryAddress);

        const pairAddress = await uniswapFactory.getPair(this.reserveToken._address, this.collateralToken._address);
        const uniswapPair = await this.createContractObjectFromJson(IUniswapV2Pair).at(pairAddress);

        // We can now fetch the reserves. At the same time, we can batch a few other required async calls.
        const [reserves, token0] = await Promise.all([uniswapPair.getReserves(), uniswapPair.token0()]);

        // Detect if the reserve currency is token0 or 1. This informs the order in the following computation.
        const reserveToken0 = token0 == this.reserveToken._address;

        const reserveIn = reserveToken0 ? reserves.reserve0 : reserves.reserve1;
        const reserveOut = !reserveToken0 ? reserves.reserve0 : reserves.reserve1;

        // Compute the maximum amount of collateral that can be purchased with all reserve currency.
        const amountInWithFee = this.toBN(reserveTokenBalance).muln(997);
        const numerator = amountInWithFee.mul(reserveOut);
        const denominator = reserveIn.muln(1000).add(amountInWithFee);

        maxPurchasableCollateral = numerator.div(denominator);
      }

      // Compute how many synthetics could be minted, given the collateral we can buy with the reserve currency.
      const gcr = this.toBN(contractPFC.rawValue)
        .mul(this.toBN(this.toWei("1")))
        .div(this.toBN(contractTokensOutstanding));

      // Calculate the max mintable synthetics with the collateral. Use the sum of the max that can be purchased and any
      // collateral the DSProxy already has in the computation.
      const maxMintableSynthetics = maxPurchasableCollateral
        .add(this.toBN(collateralTokenBalance))
        .mul(this.toBN(this.toWei("1")))
        .div(gcr);

      // Finally, the effective synthetic balance is the sum of the max that can be minted using the collateral swapped
      // from reserve and the current synthetics within the DSProxy account.
      return maxMintableSynthetics.add(this.toBN(syntheticTokenBalance));
    }
  }

  // Main entry point for submitting a liquidation. If the bot is not using a DSProxy then simply send a normal EOA tx.
  // If the bot is using a DSProxy then route the tx via it.
  async submitLiquidationTransaction(liquidationArgs) {
    // If the liquidator is not using a DSProxy, use the old method of liquidating
    if (!this.useDsProxyToLiquidate) return await this._executeLiquidationWithoutDsProxy(liquidationArgs);
    else return await this._executeLiquidationWithDsProxy(liquidationArgs);
  }

  async _executeLiquidationWithoutDsProxy(liquidationArgs) {
    // liquidation strategy will control how much to liquidate
    const liquidation = this.financialContract.methods.createLiquidation(...liquidationArgs);

    // Send the transaction or report failure.
    let receipt;
    try {
      const txResponse = await runTransaction({
        transaction: liquidation,
        config: {
          gasPrice: this.gasEstimator.getCurrentFastPrice(),
          from: this.account,
          nonce: await this.web3.eth.getTransactionCount(this.account),
        },
      });
      receipt = txResponse.receipt;
    } catch (error) {
      return new Error("Failed to liquidate position🚨");
    }

    return {
      type: "Standard EOA liquidation",
      tx: receipt && receipt.transactionHash,
      sponsor: receipt.events.LiquidationCreated.returnValues.sponsor,
      liquidator: receipt.events.LiquidationCreated.returnValues.liquidator,
      liquidationId: receipt.events.LiquidationCreated.returnValues.liquidationId,
      tokensOutstanding: receipt.events.LiquidationCreated.returnValues.tokensOutstanding,
      lockedCollateral: receipt.events.LiquidationCreated.returnValues.lockedCollateral,
      liquidatedCollateral: receipt.events.LiquidationCreated.returnValues.liquidatedCollateral,
      txnConfig: {
        gasPrice: this.gasEstimator.getCurrentFastPrice(),
        from: this.account,
      },
    };
  }

  async _executeLiquidationWithDsProxy(liquidationArgs) {
    const reserveCurrencyLiquidator = new this.web3.eth.Contract(this.ReserveCurrencyLiquidator.abi);

    // TODO: the liquidation args, as structured hare is hard to read and maintain. We should refactor the liquidation
    // strategy to better pass around these parms as they are no longer directly fed into the liquidation method.
    const callData = reserveCurrencyLiquidator.methods
      .swapMintLiquidate(
        this.uniswapRouterAddress, // uniswapRouter
        this.financialContract._address, // financialContract
        this.reserveToken._address, // reserveCurrency
        liquidationArgs[0], // liquidatedSponsor
        { rawValue: this.maxReserverTokenSpent }, // maxReserverTokenSpent
        { rawValue: liquidationArgs[1].rawValue }, // minCollateralPerTokenLiquidated
        { rawValue: liquidationArgs[2].rawValue }, // maxCollateralPerTokenLiquidated. This number need to be >= the token price.
        { rawValue: liquidationArgs[3].rawValue }, // maxTokensToLiquidate. This is how many tokens the positions has (liquidated debt).
        liquidationArgs[4]
      )
      .encodeABI();
    const callCode = this.ReserveCurrencyLiquidator.bytecode;

    const dsProxyCallReturn = await this.dsProxyManager.callFunctionOnNewlyDeployedLibrary(callCode, callData);
    const blockAfterLiquidation = await this.web3.eth.getBlockNumber();

    // Wait exactly one block to fetch events. This ensures that the events have been indexed by your node.
    await blockUntilBlockMined(this.web3, blockAfterLiquidation + 1);

    const liquidationEvent = (
      await this.financialContract.getPastEvents("LiquidationCreated", {
        fromBlock: blockAfterLiquidation - 1,
        filter: {
          liquidator: this.dsProxyManager.getDSProxyAddress(),
        },
      })
    )[0];

    // Return the same data sent back from the EOA liquidation.
    return {
      type: "DSProxy Swap, mint and liquidate transaction",
      tx: dsProxyCallReturn.transactionHash,
      sponsor: liquidationEvent.returnValues.sponsor,
      liquidator: liquidationEvent.returnValues.liquidator,
      liquidationId: liquidationEvent.returnValues.liquidationId,
      tokensOutstanding: liquidationEvent.returnValues.tokensOutstanding,
      lockedCollateral: liquidationEvent.returnValues.lockedCollateral,
      liquidatedCollateral: liquidationEvent.returnValues.liquidatedCollateral,
      txnConfig: {
        from: dsProxyCallReturn.from,
        gas: dsProxyCallReturn.gasUsed,
      },
    };
  }
}

module.exports = { ProxyTransactionWrapper };
