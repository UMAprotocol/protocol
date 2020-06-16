const { createFormatFunction, formatDateShort, formatWithMaxDecimals, addSign } = require("../common/FormattingUtils");
const { revertWrapper } = require("../common/ContractUtils");
const { ZERO_ADDRESS } = require("../common/Constants");
const { averageBlockTimeSeconds } = require("../common/TimeUtils");
const { getUniswapClient, queries } = require("./uniswapSubgraphClient");
const { getUniswapPairDetails } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const chalkPipe = require("chalk-pipe");
const bold = chalkPipe("bold");
const italic = chalkPipe("italic");
const dim = chalkPipe("dim");

class GlobalSummaryReporter {
  constructor(
    expiringMultiPartyClient,
    expiringMultiPartyEventClient,
    referencePriceFeed,
    uniswapPriceFeed,
    oracle,
    collateralToken,
    syntheticToken,
    endDateOffsetSeconds,
    periodLengthSeconds
  ) {
    this.empClient = expiringMultiPartyClient;
    this.empEventClient = expiringMultiPartyEventClient;
    this.referencePriceFeed = referencePriceFeed;
    this.uniswapPriceFeed = uniswapPriceFeed;

    this.endDateOffsetSeconds = endDateOffsetSeconds;
    this.periodLengthSeconds = periodLengthSeconds;

    this.web3 = this.empEventClient.web3;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;

    this.empContract = this.empEventClient.emp;
    this.collateralContract = collateralToken;
    this.syntheticContract = syntheticToken;
    this.oracleContract = oracle;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);
    this.formatDecimalStringWithSign = createFormatFunction(this.web3, 2, 4, true);
  }

  async update() {
    await this.empClient.update();
    await this.empEventClient.update();
    await this.referencePriceFeed.update();
    await this.uniswapPriceFeed.update();

    // Block number stats.
    this.currentBlockNumber = await this.web3.eth.getBlockNumber();
    this.endBlockNumberForPeriod =
      this.currentBlockNumber - (await this._getLookbackTimeInBlocks(this.endDateOffsetSeconds));
    this.startBlockNumberForPeriod =
      this.endBlockNumberForPeriod - (await this._getLookbackTimeInBlocks(this.periodLengthSeconds));
    this.startBlockNumberForPreviousPeriod =
      this.startBlockNumberForPeriod - (await this._getLookbackTimeInBlocks(this.periodLengthSeconds));
    this.startBlockTimestamp = (await this.web3.eth.getBlock(this.startBlockNumberForPeriod)).timestamp;
    this.endBlockTimestamp = (await this.web3.eth.getBlock(this.endBlockNumberForPeriod)).timestamp;
    this.periodLabelInHours = `${formatDateShort(this.startBlockTimestamp)} to ${formatDateShort(
      this.endBlockTimestamp
    )}`;

    // Query events not already queried by EMPEventClient
    this.collateralDepositEvents = await this.collateralContract.getPastEvents("Transfer", {
      fromBlock: 0,
      toBlock: this.currentBlockNumber,
      filter: { to: this.empContract.options.address }
    });
    this.collateralWithdrawEvents = await this.collateralContract.getPastEvents("Transfer", {
      fromBlock: 0,
      toBlock: this.currentBlockNumber,
      filter: { from: this.empContract.options.address }
    });
    this.syntheticTransferEvents = await this.syntheticContract.getPastEvents("Transfer", {
      fromBlock: 0,
      toBlock: this.currentBlockNumber
    });
    this.syntheticBurnedEvents = this.syntheticTransferEvents.filter(
      event => event.returnValues.from === this.empContract.options.address && event.returnValues.to === ZERO_ADDRESS
    );

    // Events loaded by EMPEventClient.update()
    this.newSponsorEvents = this.empEventClient.getAllNewSponsorEvents();
    this.createEvents = this.empEventClient.getAllCreateEvents();
    this.regularFeeEvents = this.empEventClient.getAllRegularFeeEvents();
    this.finalFeeEvents = this.empEventClient.getAllFinalFeeEvents();
    this.liquidationEvents = this.empEventClient.getAllLiquidationEvents();
    this.disputeEvents = this.empEventClient.getAllDisputeEvents();
    this.disputeSettledEvents = this.empEventClient.getAllDisputeSettlementEvents();

    // EMP Contract stats.
    this.totalPositionCollateral = await this.empContract.methods.totalPositionCollateral().call();
    this.totalTokensOutstanding = await this.empContract.methods.totalTokensOutstanding().call();
    this.collateralLockedInLiquidations = this.toBN((await this.empContract.methods.pfc().call()).toString()).sub(
      this.toBN(this.totalPositionCollateral.toString())
    );

    // Pricefeed stats.
    this.priceEstimate = this.referencePriceFeed.getCurrentPrice();
  }

  async generateSummaryStatsTable() {
    await this.update();

    // 1. Sponsor stats table
    console.group();
    console.log(bold("Sponsor summary stats"));
    console.log(
      italic(
        "- Collateral deposited counts collateral transferred into contract from creates, deposits, final fee bonds, and dispute bonds"
      )
    );
    console.log(
      italic("- Current collateral deposited does not include collateral that is locked in pending liquidations")
    );
    console.log(
      italic(
        "- Collateral withdrawn counts collateral transferred out of contract from withdrawals, redemptions, expiry settlements, liquidation reward withdrawals, and fees paid"
      )
    );
    console.log(italic("- Tokens minted counts synthetic tokens created"));
    console.log(italic("- Current tokens minted is the outstanding supply and should be equal to net tokens minted"));
    console.log(
      italic(
        "- Tokens burned counts synthetic tokens burned via redemptions, expiry settlements, and liquidations created"
      )
    );
    console.log(italic("- Reference price is sourced from liquid exchanges (i.e. Coinbase Pro)"));
    console.log(
      italic(
        "- The collateral amount used to calculate GCR's is equal to the current collateral deposited, and does not include liquidated collateral"
      )
    );
    await this._generateSponsorStats();
    console.groupEnd();

    // 2. Tokens stats table
    console.group();
    console.log(bold("Token summary stats"));
    console.log(italic("- Token price is sourced from exchange where synthetic token is traded (i.e. Uniswap)"));
    await this._generateTokenStats();
    console.groupEnd();

    // 3. Liquidation stats table
    console.group();
    console.log(bold("Liquidation summary stats"));
    console.log(italic("- Unique liquidations count # of unique sponsors that have been liquidated"));
    console.log(italic("- Collateral & tokens liquidated counts aggregate amounts from all partial liquidations"));
    console.log(italic("- Current collateral liquidated includes any collateral locked in pending liquidations"));
    await this._generateLiquidationStats();
    console.groupEnd();

    // 4. Dispute stats table
    console.group();
    console.log(bold("Dispute summary stats"));
    await this._generateDisputeStats();
    console.groupEnd();

    // 5. DVM stats table
    console.group();
    console.log(bold("DVM summary stats"));
    await this._generateDvmStats();
    console.groupEnd();
  }

  async _generateSponsorStats() {
    let allSponsorStatsTable = {};

    if (this.newSponsorEvents.length === 0) {
      console.log(dim("\tNo positions have been created for this EMP."));
      return;
    }

    // - Lifetime # of unique sponsors.
    const uniqueSponsors = {};
    const periodUniqueSponsors = {};
    const prevPeriodUniqueSponsors = {};
    const currentUniqueSponsors = this.empClient.getAllPositions();
    for (let event of this.newSponsorEvents) {
      uniqueSponsors[event.sponsor] = true;
      if (event.blockNumber >= this.startBlockNumberForPeriod && event.blockNumber < this.endBlockNumberForPeriod) {
        periodUniqueSponsors[event.sponsor] = true;
      }
      if (
        event.blockNumber >= this.startBlockNumberForPreviousPeriod &&
        event.blockNumber < this.startBlockNumberForPeriod
      ) {
        prevPeriodUniqueSponsors[event.sponsor] = true;
      }
    }
    allSponsorStatsTable["# of unique sponsors"] = {
      cumulative: Object.keys(uniqueSponsors).length,
      current: Object.keys(currentUniqueSponsors).length,
      [this.periodLabelInHours]: Object.keys(periodUniqueSponsors).length,
      ["Δ from prev. period"]: addSign(
        Object.keys(periodUniqueSponsors).length - Object.keys(prevPeriodUniqueSponsors).length
      )
    };

    // - Cumulative collateral deposited into contract
    let collateralDeposited = this.toBN("0");
    let collateralDepositedPeriod = this.toBN("0");
    let collateralDepositedPrevPeriod = this.toBN("0");
    for (let event of this.collateralDepositEvents) {
      collateralDeposited = collateralDeposited.add(this.toBN(event.returnValues.value));
      if (event.blockNumber >= this.startBlockNumberForPeriod && event.blockNumber < this.endBlockNumberForPeriod) {
        collateralDepositedPeriod = collateralDepositedPeriod.add(this.toBN(event.returnValues.value));
      }
      if (
        event.blockNumber >= this.startBlockNumberForPreviousPeriod &&
        event.blockNumber < this.startBlockNumberForPeriod
      ) {
        collateralDepositedPrevPeriod = collateralDepositedPrevPeriod.add(this.toBN(event.returnValues.value));
      }
    }
    allSponsorStatsTable["collateral deposited"] = {
      cumulative: this.formatDecimalString(collateralDeposited),
      [this.periodLabelInHours]: this.formatDecimalString(collateralDepositedPeriod),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(
        collateralDepositedPeriod.sub(collateralDepositedPrevPeriod)
      )
    };

    // - Cumulative collateral withdrawn from contract
    let collateralWithdrawn = this.toBN("0");
    let collateralWithdrawnPeriod = this.toBN("0");
    let collateralWithdrawnPrevPeriod = this.toBN("0");
    for (let event of this.collateralWithdrawEvents) {
      collateralWithdrawn = collateralWithdrawn.add(this.toBN(event.returnValues.value));
      if (event.blockNumber >= this.startBlockNumberForPeriod && event.blockNumber < this.endBlockNumberForPeriod) {
        collateralWithdrawnPeriod = collateralWithdrawnPeriod.add(this.toBN(event.returnValues.value));
      }
      if (
        event.blockNumber >= this.startBlockNumberForPreviousPeriod &&
        event.blockNumber < this.startBlockNumberForPeriod
      ) {
        collateralWithdrawnPrevPeriod = collateralWithdrawnPrevPeriod.add(this.toBN(event.returnValues.value));
      }
    }
    allSponsorStatsTable["collateral withdrawn"] = {
      cumulative: this.formatDecimalString(collateralWithdrawn),
      [this.periodLabelInHours]: this.formatDecimalString(collateralWithdrawnPeriod),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(
        collateralWithdrawnPeriod.sub(collateralWithdrawnPrevPeriod)
      )
    };

    // - Net collateral deposited into contract:
    let netCollateralWithdrawn = collateralDeposited.sub(collateralWithdrawn);
    if (!netCollateralWithdrawn.eq(this.toBN(this.totalPositionCollateral.toString()))) {
      throw "Net collateral deposited is not equal to current total position collateral";
    }
    let netCollateralWithdrawnPeriod = collateralDepositedPeriod.sub(collateralWithdrawnPeriod);
    let netCollateralWithdrawnPrevPeriod = collateralDepositedPrevPeriod.sub(collateralWithdrawnPrevPeriod);
    allSponsorStatsTable["net collateral deposited"] = {
      cumulative: this.formatDecimalString(netCollateralWithdrawn),
      [this.periodLabelInHours]: this.formatDecimalString(netCollateralWithdrawnPeriod),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(
        netCollateralWithdrawnPeriod.sub(netCollateralWithdrawnPrevPeriod)
      )
    };

    // - Tokens minted: tracked via Create events.
    let tokensMinted = this.toBN("0");
    let tokensMintedPeriod = this.toBN("0");
    let tokensMintedPrevPeriod = this.toBN("0");
    for (let event of this.createEvents) {
      tokensMinted = tokensMinted.add(this.toBN(event.tokenAmount));
      if (event.blockNumber >= this.startBlockNumberForPeriod && event.blockNumber < this.endBlockNumberForPeriod) {
        tokensMintedPeriod = tokensMintedPeriod.add(this.toBN(event.tokenAmount));
      }
      if (
        event.blockNumber >= this.startBlockNumberForPreviousPeriod &&
        event.blockNumber < this.startBlockNumberForPeriod
      ) {
        tokensMintedPrevPeriod = tokensMintedPrevPeriod.add(this.toBN(event.tokenAmount));
      }
    }
    allSponsorStatsTable["tokens minted"] = {
      cumulative: this.formatDecimalString(tokensMinted),
      [this.periodLabelInHours]: this.formatDecimalString(tokensMintedPeriod),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(tokensMintedPrevPeriod.sub(tokensMintedPeriod))
    };

    // - Tokens burned
    let tokensBurned = this.toBN("0");
    let tokensBurnedPeriod = this.toBN("0");
    let tokensBurnedPrevPeriod = this.toBN("0");
    for (let event of this.syntheticBurnedEvents) {
      tokensBurned = tokensBurned.add(this.toBN(event.returnValues.value));
      if (event.blockNumber >= this.startBlockNumberForPeriod && event.blockNumber < this.endBlockNumberForPeriod) {
        tokensBurnedPeriod = tokensBurnedPeriod.add(this.toBN(event.returnValues.value));
      }
      if (
        event.blockNumber >= this.startBlockNumberForPreviousPeriod &&
        event.blockNumber < this.startBlockNumberForPeriod
      ) {
        tokensBurnedPrevPeriod = tokensBurnedPrevPeriod.add(this.toBN(event.returnValues.value));
      }
    }
    allSponsorStatsTable["tokens burned"] = {
      cumulative: this.formatDecimalString(tokensBurned),
      [this.periodLabelInHours]: this.formatDecimalString(tokensBurnedPeriod),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(tokensBurnedPeriod.sub(tokensBurnedPrevPeriod))
    };

    // - Net tokens minted:
    let netTokensMinted = tokensMinted.sub(tokensBurned);
    if (!netTokensMinted.eq(this.toBN(this.totalTokensOutstanding.toString()))) {
      throw "Net tokens minted is not equal to current tokens outstanding";
    }
    let netTokensMintedPeriod = tokensMintedPeriod.sub(tokensBurnedPeriod);
    let netTokensMintedPrevPeriod = tokensMintedPrevPeriod.sub(tokensBurnedPrevPeriod);
    allSponsorStatsTable["net tokens minted"] = {
      cumulative: this.formatDecimalString(netTokensMinted),
      [this.periodLabelInHours]: this.formatDecimalString(netTokensMintedPeriod),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(netTokensMintedPeriod.sub(netTokensMintedPrevPeriod))
    };

    // - GCR (collateral / tokens outstanding):
    let currentCollateral = this.toBN(this.totalPositionCollateral.toString());
    let prevPeriodCollateral = currentCollateral.sub(netCollateralWithdrawnPeriod);
    let currentTokensOutstanding = this.toBN(this.totalTokensOutstanding.toString());
    let prevPeriodTokensOutstanding = currentTokensOutstanding.sub(netTokensMintedPeriod);
    let currentGCR = currentCollateral.mul(this.toBN(this.toWei("1"))).div(currentTokensOutstanding);
    let prevGCR = prevPeriodCollateral.mul(this.toBN(this.toWei("1"))).div(prevPeriodTokensOutstanding);
    allSponsorStatsTable["GCR - collateral / # tokens outstanding"] = {
      current: this.formatDecimalString(currentGCR),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(currentGCR.sub(prevGCR))
    };

    // - GCR (collateral / TRV):
    let currentTRV = currentTokensOutstanding.mul(this.priceEstimate).div(this.toBN(this.toWei("1")));
    let currentGCRUsingTRV = currentCollateral.mul(this.toBN(this.toWei("1"))).div(currentTRV);
    allSponsorStatsTable["GCR - collateral / TRV"] = {
      current: this.formatDecimalString(currentGCRUsingTRV)
    };
    allSponsorStatsTable["price from reference pricefeed"] = {
      current: this.formatDecimalString(this.priceEstimate)
    };

    console.table(allSponsorStatsTable);
  }

  async _generateTokenStats() {
    let allTokenStatsTable = {};

    const currentTokenPrice = this.uniswapPriceFeed.getLastBlockPrice();
    const twapTokenPrice = this.uniswapPriceFeed.getCurrentPrice();
    allTokenStatsTable["Token price"] = {
      current: this.formatDecimalString(currentTokenPrice),
      TWAP: this.formatDecimalString(twapTokenPrice)
    };

    allTokenStatsTable["# tokens outstanding"] = {
      current: this.formatDecimalString(this.totalTokensOutstanding)
    };

    // Get uniswap data via graphql.
    const uniswapPairDetails = await getUniswapPairDetails(
      this.web3,
      this.syntheticContract.address,
      this.collateralContract.address
    );
    const uniswapPairAddress = uniswapPairDetails.pairAddress.toLowerCase();
    const uniswapClient = getUniswapClient();
    const allTokenData = (await uniswapClient.request(queries.PAIR_DATA(uniswapPairAddress))).pairs[0];
    const startPeriodTokenData = (
      await uniswapClient.request(queries.PAIR_DATA(uniswapPairAddress, this.startBlockNumberForPeriod))
    ).pairs[0];
    const endPeriodTokenData = (
      await uniswapClient.request(queries.PAIR_DATA(uniswapPairAddress, this.endBlockNumberForPeriod))
    ).pairs[0];
    const startPrevPeriodTokenData = (
      await uniswapClient.request(queries.PAIR_DATA(uniswapPairAddress, this.startBlockNumberForPreviousPeriod))
    ).pairs[0];

    const tradeCount = parseInt(allTokenData.txCount);
    const periodTradeCount = parseInt(endPeriodTokenData.txCount) - parseInt(startPeriodTokenData.txCount);
    const prevPeriodTradeCount = parseInt(startPeriodTokenData.txCount) - parseInt(startPrevPeriodTokenData.txCount);

    const volumeTokenLabel = uniswapPairDetails.inverted ? "volumeToken1" : "volumeToken0";
    const tradeVolumeTokens = parseFloat(allTokenData[volumeTokenLabel]);
    const periodTradeVolumeTokens =
      parseFloat(endPeriodTokenData[volumeTokenLabel]) - parseFloat(startPeriodTokenData[volumeTokenLabel]);
    const prevPeriodTradeVolumeTokens =
      parseFloat(startPeriodTokenData[volumeTokenLabel]) - parseFloat(startPrevPeriodTokenData[volumeTokenLabel]);

    allTokenStatsTable["# trades in Uniswap"] = {
      cumulative: tradeCount,
      [this.periodLabelInHours]: periodTradeCount,
      ["Δ from prev. period"]: addSign(periodTradeCount - prevPeriodTradeCount)
    };
    allTokenStatsTable["volume of trades in Uniswap in # of tokens"] = {
      cumulative: formatWithMaxDecimals(tradeVolumeTokens, 2, 4, false),
      [this.periodLabelInHours]: formatWithMaxDecimals(periodTradeVolumeTokens, 2, 4, false),
      ["Δ from prev. period"]: formatWithMaxDecimals(
        periodTradeVolumeTokens - prevPeriodTradeVolumeTokens,
        2,
        4,
        false,
        true
      )
    };

    // Get token holder stats.
    const tokenHolders = await this._constructTokenHolderList();
    if (tokenHolders) {
      allTokenStatsTable["# of token holders"] = {
        current: Object.keys(tokenHolders.current).length,
        cumulative: Object.keys(tokenHolders.cumulative).length
      };
    }
    console.table(allTokenStatsTable);
  }

  async _generateLiquidationStats() {
    let allLiquidationStatsTable = {};

    let uniqueLiquidations = {};
    let uniqueLiquidationsPeriod = {};
    let uniqueLiquidationsPrevPeriod = {};
    let tokensLiquidated = this.toBN("0");
    let tokensLiquidatedPeriod = this.toBN("0");
    let tokensLiquidatedPrevPeriod = this.toBN("0");
    let collateralLiquidated = this.toBN("0");
    let collateralLiquidatedPeriod = this.toBN("0");
    let collateralLiquidatedPrevPeriod = this.toBN("0");

    if (this.liquidationEvents.length === 0) {
      console.log(dim("\tNo liquidation events found for this EMP."));
    } else {
      for (let event of this.liquidationEvents) {
        tokensLiquidated = tokensLiquidated.add(this.toBN(event.tokensOutstanding));
        // We count "lockedCollateral" instead of "liquidatedCollateral" because this is the amount of the collateral that the liquidator is elegible to draw from
        // the contract.
        collateralLiquidated = collateralLiquidated.add(this.toBN(event.lockedCollateral));
        uniqueLiquidations[event.sponsor] = true;
        if (event.blockNumber >= this.startBlockNumberForPeriod && event.blockNumber < this.endBlockNumberForPeriod) {
          tokensLiquidatedPeriod = tokensLiquidatedPeriod.add(this.toBN(event.tokensOutstanding));
          collateralLiquidatedPeriod = collateralLiquidatedPeriod.add(this.toBN(event.lockedCollateral));
          uniqueLiquidationsPeriod[event.sponsor] = true;
        }
        if (
          event.blockNumber >= this.startBlockNumberForPreviousPeriod &&
          event.blockNumber < this.startBlockNumberForPeriod
        ) {
          tokensLiquidatedPrevPeriod = tokensLiquidatedPrevPeriod.add(this.toBN(event.tokensOutstanding));
          collateralLiquidatedPrevPeriod = collateralLiquidatedPrevPeriod.add(this.toBN(event.lockedCollateral));
          uniqueLiquidationsPrevPeriod[event.sponsor] = true;
        }
      }
      allLiquidationStatsTable = {
        ["# of liquidations"]: {
          cumulative: Object.keys(uniqueLiquidations).length,
          [this.periodLabelInHours]: Object.keys(uniqueLiquidationsPeriod).length,
          ["Δ from prev. period"]: addSign(
            Object.keys(uniqueLiquidationsPeriod).length - Object.keys(uniqueLiquidationsPrevPeriod).length
          )
        },
        ["tokens liquidated"]: {
          cumulative: this.formatDecimalString(tokensLiquidated),
          [this.periodLabelInHours]: this.formatDecimalString(tokensLiquidatedPeriod),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            tokensLiquidatedPeriod.sub(tokensLiquidatedPrevPeriod)
          )
        },
        ["collateral liquidated"]: {
          cumulative: this.formatDecimalString(collateralLiquidated),
          [this.periodLabelInHours]: this.formatDecimalString(collateralLiquidatedPeriod),
          current: this.formatDecimalString(this.collateralLockedInLiquidations),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            collateralLiquidatedPeriod.sub(collateralLiquidatedPrevPeriod)
          )
        }
      };

      console.table(allLiquidationStatsTable);
    }
  }

  async _generateDisputeStats() {
    let allDisputeStatsTable = {};

    let uniqueDisputes = {};
    let uniqueDisputesPeriod = {};
    let uniqueDisputesPrevPeriod = {};
    let tokensDisputed = this.toBN("0");
    let tokensDisputedPeriod = this.toBN("0");
    let tokensDisputedPrevPeriod = this.toBN("0");
    let collateralDisputed = this.toBN("0");
    let collateralDisputedPeriod = this.toBN("0");
    let collateralDisputedPrevPeriod = this.toBN("0");
    let disputesResolved = {};

    if (this.disputeEvents.length === 0) {
      console.log(dim("\tNo dispute events found for this EMP."));
    } else {
      for (let event of this.disputeEvents) {
        // Fetch disputed collateral & token amounts from corresponding liquidation event that with same ID and sponsor.
        const liquidationData = this.liquidationEvents.filter(
          e => e.liquidationId === event.liquidationId && e.sponsor === event.sponsor
        );
        tokensDisputed = tokensDisputed.add(this.toBN(liquidationData.tokensOutstanding));
        collateralDisputed = collateralDisputed.add(this.toBN(liquidationData.lockedCollateral));
        uniqueDisputes[event.sponsor] = true;
        if (event.blockNumber >= this.startBlockNumberForPeriod && event.blockNumber < this.endBlockNumberForPeriod) {
          tokensDisputedPeriod = tokensDisputedPeriod.add(this.toBN(liquidationData.tokensOutstanding));
          collateralDisputedPeriod = collateralDisputedPeriod.add(this.toBN(liquidationData.lockedCollateral));
          uniqueDisputesPeriod[event.sponsor] = true;
        }
        if (
          event.blockNumber >= this.startBlockNumberForPreviousPeriod &&
          event.blockNumber < this.startBlockNumberForPeriod
        ) {
          tokensDisputedPrevPeriod = tokensDisputedPrevPeriod.add(this.toBN(liquidationData.tokensOutstanding));
          collateralDisputedPrevPeriod = collateralDisputedPrevPeriod.add(this.toBN(liquidationData.lockedCollateral));
          uniqueDisputesPrevPeriod[event.sponsor] = true;
        }

        // Create list of resolved prices for disputed liquidations.
        const liquidationTimestamp = (await this.web3.eth.getBlock(event.blockNumber)).timestamp;
        try {
          // `getPrice` will revert or return the resolved price. Due to a web3 bug, it is possible that `getPrice` won't revert as expected
          // but return a very high integer--a false positive. `revertWrapper` handles this case and returns the resolved price or `null`
          // if the call should have reverted but returned the high integer instead.
          const resolvedPrice = await this.oracleContract.getPrice(
            await this.empContract.methods.priceIdentifier().call(),
            liquidationTimestamp,
            {
              from: this.empContract.options.address
            }
          );
          if (revertWrapper(resolvedPrice)) {
            disputesResolved[
              `Liquidation ID ${event.liquidationId} for sponsor ${event.sponsor}`
            ] = this.formatDecimalString(resolvedPrice);
          } else {
            throw "getPrice reverted but web3.Contract method call returned a false positive price";
          }
        } catch (err) {
          disputesResolved[`Liquidation ID ${event.liquidationId} for sponsor ${event.sponsor}`] = "unresolved";
        }
      }
      allDisputeStatsTable = {
        ["# of disputes"]: {
          cumulative: Object.keys(uniqueDisputes).length,
          [this.periodLabelInHours]: Object.keys(uniqueDisputesPeriod).length,
          ["Δ from prev. period"]: addSign(
            Object.keys(uniqueDisputesPeriod).length - Object.keys(uniqueDisputesPrevPeriod).length
          )
        },
        ["tokens disputed"]: {
          cumulative: this.formatDecimalString(tokensDisputed),
          [this.periodLabelInHours]: this.formatDecimalString(tokensDisputedPeriod),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(tokensDisputedPeriod.sub(tokensDisputedPrevPeriod))
        },
        ["collateral disputed"]: {
          cumulative: this.formatDecimalString(collateralDisputed),
          [this.periodLabelInHours]: this.formatDecimalString(collateralDisputedPeriod),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            collateralDisputedPeriod.sub(collateralDisputedPrevPeriod)
          )
        }
      };

      console.table(allDisputeStatsTable);

      console.group("Dispute resolution prices");
      console.table(disputesResolved);
      console.groupEnd();
    }
  }

  async _generateDvmStats() {
    let allDvmStatsTable = {};

    let regularFeesPaid = this.toBN("0");
    let regularFeesPaidPeriod = this.toBN("0");
    let regularFeesPaidPrevPeriod = this.toBN("0");
    let lateFeesPaid = this.toBN("0");
    let lateFeesPaidPeriod = this.toBN("0");
    let lateFeesPaidPrevPeriod = this.toBN("0");
    let finalFeesPaid = this.toBN("0");
    let finalFeesPaidPeriod = this.toBN("0");
    let finalFeesPaidPrevPeriod = this.toBN("0");

    if (this.regularFeeEvents.length === 0) {
      console.log(dim("\tNo regular fee events found for this EMP."));
    } else {
      for (let event of this.regularFeeEvents) {
        regularFeesPaid = regularFeesPaid.add(this.toBN(event.regularFee));
        lateFeesPaid = lateFeesPaid.add(this.toBN(event.lateFee));
        if (event.blockNumber >= this.startBlockNumberForPeriod && event.blockNumber < this.endBlockNumberForPeriod) {
          regularFeesPaidPeriod = regularFeesPaidPeriod.add(this.toBN(event.regularFee));
          lateFeesPaidPeriod = lateFeesPaidPeriod.add(this.toBN(event.lateFee));
        }
        if (
          event.blockNumber >= this.startBlockNumberForPreviousPeriod &&
          event.blockNumber < this.startBlockNumberForPeriod
        ) {
          regularFeesPaidPrevPeriod = regularFeesPaidPrevPeriod.add(this.toBN(event.regularFee));
          lateFeesPaidPrevPeriod = lateFeesPaidPrevPeriod.add(this.toBN(event.lateFee));
        }
      }
    }

    if (this.finalFeeEvents.length === 0) {
      console.log(dim("\tNo final fee events found for this EMP."));
    } else {
      for (let event of this.finalFeeEvents) {
        finalFeesPaid = finalFeesPaid.add(this.toBN(event.amount));
        if (event.blockNumber >= this.startBlockNumberForPeriod && event.blockNumber < this.endBlockNumberForPeriod) {
          finalFeesPaidPeriod = finalFeesPaidPeriod.add(this.toBN(event.amount));
        }
        if (
          event.blockNumber >= this.startBlockNumberForPreviousPeriod &&
          event.blockNumber < this.startBlockNumberForPeriod
        ) {
          finalFeesPaidPrevPeriod = finalFeesPaidPrevPeriod.add(this.toBN(event.amount));
        }
      }
    }

    if (Object.keys(allDvmStatsTable).length !== 0) {
      allDvmStatsTable = {
        ["final fees paid to store"]: {
          cumulative: this.formatDecimalString(finalFeesPaid),
          [this.periodLabelInHours]: this.formatDecimalString(finalFeesPaidPeriod),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(finalFeesPaidPeriod.sub(finalFeesPaidPrevPeriod))
        },
        ["ongoing regular fees paid to store"]: {
          cumulative: this.formatDecimalString(regularFeesPaid),
          [this.periodLabelInHours]: this.formatDecimalString(regularFeesPaidPeriod),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            regularFeesPaidPeriod.sub(regularFeesPaidPrevPeriod)
          )
        },
        ["ongoing late fees paid to store"]: {
          cumulative: this.formatDecimalString(lateFeesPaid),
          [this.periodLabelInHours]: this.formatDecimalString(lateFeesPaidPeriod),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(lateFeesPaidPeriod.sub(lateFeesPaidPrevPeriod))
        }
      };

      console.table(allDvmStatsTable);
    }
  }

  async _getLookbackTimeInBlocks(lookbackTimeInSeconds) {
    const blockTimeInSeconds = await averageBlockTimeSeconds();
    const blocksToLookBack = Math.ceil(lookbackTimeInSeconds / blockTimeInSeconds);
    return blocksToLookBack;
  }

  async _constructTokenHolderList() {
    const cumulativeTokenHolders = {};
    const currentTokenHolders = {};

    let allTransferEvents = this.syntheticTransferEvents;

    // Sort events from oldest first to newest last.
    allTransferEvents.sort((a, b) => {
      return a.blockNumber < b.blockNumber;
    });

    allTransferEvents.forEach(event => {
      const sender = event.returnValues.from;
      const receiver = event.returnValues.to;

      if (receiver !== ZERO_ADDRESS) {
        // Add to cumulative holder list.
        cumulativeTokenHolders[receiver] = true;

        // Initialize current holder.
        if (!currentTokenHolders[receiver]) {
          currentTokenHolders[receiver] = this.toBN("0");
        }

        // Update balance
        currentTokenHolders[receiver] = currentTokenHolders[receiver].add(this.toBN(event.returnValues.value));
      }

      if (sender !== ZERO_ADDRESS) {
        // Since we are searching from oldest events first, the sender must already have a balance since we are ignoring
        // events where the sender is the zero address.
        currentTokenHolders[sender] = currentTokenHolders[sender].sub(this.toBN(event.returnValues.value));

        // If sender transferred full balance, delete it from the dictionary.
        if (currentTokenHolders[sender].isZero()) {
          delete currentTokenHolders[sender];
        }
      }
    });

    return {
      cumulative: cumulativeTokenHolders,
      current: currentTokenHolders
    };
  }
}
module.exports = {
  GlobalSummaryReporter
};
