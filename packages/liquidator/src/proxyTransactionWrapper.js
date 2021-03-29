const assert = require("assert");
const truffleContract = require("@truffle/contract");

const ynatm = require("@umaprotocol/ynatm");

const { createObjectFromDefaultProps } = require("@uma/common");
const { getAbi, getTruffleContract } = require("@uma/core");

const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");

class ProxyTransactionWrapper {
  constructor({
    web3,
    financialContract,
    gasEstimator,
    syntheticToken,
    collateralToken,
    account,
    dsProxyManager = null,
    isUsingDsProxyToLiquidate = false,
    proxyTransactionWrapperConfig
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

    this.isUsingDsProxyToLiquidate = isUsingDsProxyToLiquidate;

    // TODO: refactor the router to pull from a constant file.
    const defaultConfig = {
      uniswapRouterAddress: {
        value: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
        isValid: x => {
          return this.web3.utils.isAddress(x);
        }
      },
      uniswapFactoryAddress: {
        value: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
        isValid: x => {
          return this.web3.utils.isAddress(x);
        }
      },
      liquidatorReserveCurrencyAddress: {
        value: "",
        isValid: x => {
          return this.web3.utils.isAddress(x) || x === "";
        }
      },
      maxReserverTokenSpent: {
        value: this.toWei("500000").toString(),
        isValid: x => {
          return typeof x == "string";
        }
      }
    };

    // Validate and set config settings to class state.
    const configWithDefaults = createObjectFromDefaultProps(proxyTransactionWrapperConfig, defaultConfig);
    Object.assign(this, configWithDefaults);

    // Preform some basic initalization sanity checks.
    if (this.isUsingDsProxyToLiquidate) {
      assert(
        this.dsProxyManager && this.dsProxyManager.getDSProxyAddress(),
        "DSProxy Manger has not yet been initialized!"
      );
      assert(this.dsProxyManager != null, "Cant use dsProxy to liquidate if the client is set to null!");
      assert(
        this.web3.utils.isAddress(this.liquidatorReserveCurrencyAddress),
        "Must provide a reserve currency address to use the proxy transaction wrapper!"
      );
    }

    this.reserveToken = new web3.eth.Contract(getAbi("ExpandedERC20"), this.liquidatorReserveCurrencyAddress);
    this.ReserveCurrencyLiquidator = getTruffleContract("ReserveCurrencyLiquidator", web3, "latest");
  }

  createContractObjectFromJson(contractJsonObject) {
    let truffleContractCreator = truffleContract(contractJsonObject);
    truffleContractCreator.setProvider(web3.currentProvider);
    return truffleContractCreator;
  }

  // Get the effective synthetic token balance. If the bot is executing in normal mode (liquidations sent from an EOA)
  // then this is simply the token balance of the unlocked account. If the liquidator is using a DSProxy to liquidate,
  // then consider the synthetics could be minted, + any synthetics the DSProxy already has.
  async getSyntheticTokenBalance() {
    const syntheticTokenBallance = await this.syntheticToken.methods.balanceOf(this.account).call();
    if (!this.isUsingDsProxyToLiquidate) return syntheticTokenBallance;
    else {
      // Instantiate uniswap factory to fetch the pair address.
      const uniswapFactory = await this.createContractObjectFromJson(UniswapV2Factory).at(this.uniswapFactoryAddress);

      const pairAddress = await uniswapFactory.getPair(this.reserveToken._address, this.collateralToken._address);
      const uniswapPair = await this.createContractObjectFromJson(IUniswapV2Pair).at(pairAddress);

      // We can now fetch the reserves. At the same time, we can batch a few other required async calls.
      const [
        reserves,
        token0,
        contractPFC,
        contractTokensOutstanding,
        reserveTokenBalance,
        collateralTokenBalance
      ] = await Promise.all([
        uniswapPair.getReserves(),
        uniswapPair.token0(),
        this.financialContract.methods.pfc().call(),
        this.financialContract.methods.totalTokensOutstanding().call(),
        this.reserveToken.methods.balanceOf(this.dsProxyManager.getDSProxyAddress()).call(),
        this.collateralToken.methods.balanceOf(this.dsProxyManager.getDSProxyAddress()).call()
      ]);

      // Detect if the reserve currency is token0 or 1. This informs the order in the following computation.
      const reserveToken0 = token0 == this.reserveToken._address;

      const reserveIn = reserveToken0 ? reserves.reserve0 : reserves.reserve1;
      const reserveOut = !reserveToken0 ? reserves.reserve0 : reserves.reserve1;

      // Compute the maximum amount of collateral that can be purchased with all reserve currency.
      const amountInWithFee = this.toBN(reserveTokenBalance).muln(997);
      const numerator = amountInWithFee.mul(reserveOut);
      const denominator = reserveIn.muln(1000).add(amountInWithFee);

      const maxPurchasableCollateral = numerator.div(denominator);

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
      return maxMintableSynthetics.add(this.toBN(syntheticTokenBallance));
    }
  }

  async submitLiquidationTransaction(liquidationArgs) {
    // If the liquidator is not using a DSProxy, use the old method of liquidating
    if (!this.isUsingDsProxyToLiquidate) return await this._executeLiquidationWithoutDsProxy(liquidationArgs);
    else return await this._executeLiquidationWithDsProxy(liquidationArgs);
  }

  async _executeLiquidationWithoutDsProxy(liquidationArgs) {
    // liquidation strategy will control how much to liquidate
    const liquidation = this.financialContract.methods.createLiquidation(...liquidationArgs);

    // Send the transaction or report failure.
    let receipt;
    let txnConfig;
    try {
      // Configure tx config object
      const gasEstimation = await liquidation.estimateGas({
        from: this.account
      });
      txnConfig = {
        from: this.account,
        gas: Math.min(Math.floor(gasEstimation * this.GAS_LIMIT_BUFFER), this.txnGasLimit),
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      };

      // Make sure to keep trying with this nonce
      const nonce = await this.web3.eth.getTransactionCount(this.account);

      // Min Gas Price, with a max gasPrice of x4
      const minGasPrice = parseInt(this.gasEstimator.getCurrentFastPrice(), 10);
      const maxGasPrice = 2 * 3 * minGasPrice;

      // Doubles gasPrice every iteration
      const gasPriceScalingFunction = ynatm.DOUBLES;

      // Receipt without events
      receipt = await ynatm.send({
        sendTransactionFunction: gasPrice => liquidation.send({ ...txnConfig, nonce, gasPrice }),
        minGasPrice,
        maxGasPrice,
        gasPriceScalingFunction,
        delay: 60000 // Tries and doubles gasPrice every minute if tx hasn't gone through
      });
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
      txnConfig
    };
  }

  async _executeLiquidationWithDsProxy(liquidationArgs) {
    const blockBeforeLiquidation = await this.web3.eth.getBlockNumber();

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

    const liquidationEvent = (
      await this.financialContract.getPastEvents("LiquidationCreated", {
        fromBlock: blockBeforeLiquidation,
        filter: { liquidator: this.dsProxyManager.getDSProxyAddress() }
      })
    )[0];

    return {
      type: "DSProxy Swap, mint and liquidate transaction",
      tx: dsProxyCallReturn.transactionHash,
      sponsor: liquidationEvent.sponsor,
      liquidator: liquidationEvent.liquidator,
      liquidationId: liquidationEvent.liquidationId,
      tokensOutstanding: liquidationEvent.tokensOutstanding,
      lockedCollateral: liquidationEvent.lockedCollateral,
      liquidatedCollateral: liquidationEvent.liquidatedCollateral,
      txnConfig: {
        from: dsProxyCallReturn.from,
        gas: dsProxyCallReturn.gasUsed
      }
    };
  }
}

module.exports = { ProxyTransactionWrapper };
