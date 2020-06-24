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

    // This report runs accounting on the current and historical state of EMP positions.
    // Use `accountingVariance` to adjust how much room for error we should allow in calculations, for example to
    // allow for FixedPoint rounding errors.
    this.accountingVariance = this.toBN(this.toWei("0.0001"));
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
    this.totalPfc = await this.empContract.methods.pfc().call();
    this.collateralLockedInLiquidations = this.toBN(this.totalPfc.toString()).sub(
      this.toBN(this.totalPositionCollateral.toString())
    );

    // Pricefeed stats.
    this.priceEstimate = this.referencePriceFeed.getCurrentPrice();
  }

  async generateSummaryStatsTable() {
    await this.update();

    // Set up periods for querying data at specific intervals.
    const periods = [
      { label: "period", start: this.startBlockNumberForPeriod, end: this.endBlockNumberForPeriod },
      { label: "prevPeriod", start: this.startBlockNumberForPreviousPeriod, end: this.startBlockNumberForPeriod }
    ];
    this.isEventInPeriod = (event, period) =>
      Boolean(event.blockNumber >= period.start && event.blockNumber < period.end);

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
    this._generateSponsorStats(periods);
    console.groupEnd();

    // 2. Tokens stats table
    console.group();
    console.log(bold("Token summary stats"));
    console.log(italic("- Token price is sourced from exchange where synthetic token is traded (i.e. Uniswap)"));
    console.log(
      italic("- Token holder counts are equal to the # of unique token holders who held any balance during a period")
    );
    await this._generateTokenStats(periods);
    console.groupEnd();

    // 3. Liquidation stats table
    console.group();
    console.log(bold("Liquidation summary stats"));
    console.log(italic("- Unique liquidations count # of unique sponsors that have been liquidated"));
    console.log(italic("- Collateral & tokens liquidated counts aggregate amounts from all partial liquidations"));
    console.log(italic("- Current collateral liquidated includes any collateral locked in pending liquidations"));
    this._generateLiquidationStats(periods);
    console.groupEnd();

    // 4. Dispute stats table
    console.group();
    console.log(bold("Dispute summary stats"));
    await this._generateDisputeStats(periods);
    console.groupEnd();

    // 5. DVM stats table
    console.group();
    console.log(bold("DVM summary stats"));
    this._generateDvmStats(periods);
    console.groupEnd();
  }

  /** *******************************************************
   *
   * Helper methods to sort event data by block timestamp
   *
   * *******************************************************/
  _filterNewSponsorData(periods, newSponsorEvents) {
    const allUniqueSponsors = {};
    const periodUniqueSponsors = {};

    for (let event of newSponsorEvents) {
      allUniqueSponsors[event.sponsor] = true;

      for (let period of periods) {
        if (!periodUniqueSponsors[period.label]) {
          periodUniqueSponsors[period.label] = {};
        }

        if (this.isEventInPeriod(event, period)) {
          periodUniqueSponsors[period.label][event.sponsor] = true;
        }
      }
    }
    return {
      allUniqueSponsors,
      periodUniqueSponsors
    };
  }

  _filterTransferData(periods, transferEvents) {
    let allCollateralTransferred = this.toBN("0");
    const periodCollateralTransferred = {};

    for (let event of transferEvents) {
      allCollateralTransferred = allCollateralTransferred.add(this.toBN(event.returnValues.value));

      for (let period of periods) {
        if (!periodCollateralTransferred[period.label]) {
          periodCollateralTransferred[period.label] = this.toBN("0");
        }

        if (this.isEventInPeriod(event, period)) {
          periodCollateralTransferred[period.label] = periodCollateralTransferred[period.label].add(
            this.toBN(event.returnValues.value)
          );
        }
      }
    }
    return {
      allCollateralTransferred,
      periodCollateralTransferred
    };
  }

  _filterCreateData(periods, createEvents) {
    let allTokensCreated = this.toBN("0");
    const periodTokensCreated = {};

    for (let event of createEvents) {
      allTokensCreated = allTokensCreated.add(this.toBN(event.tokenAmount));

      for (let period of periods) {
        if (!periodTokensCreated[period.label]) {
          periodTokensCreated[period.label] = this.toBN("0");
        }

        if (this.isEventInPeriod(event, period)) {
          periodTokensCreated[period.label] = periodTokensCreated[period.label].add(this.toBN(event.tokenAmount));
        }
      }
    }
    return {
      allTokensCreated,
      periodTokensCreated
    };
  }

  _filterLiquidationData(periods, liquidateEvents) {
    let allUniqueLiquidations = {};
    let periodUniqueLiquidations = {};
    let allTokensLiquidated = this.toBN("0");
    const periodTokensLiquidated = {};
    let allCollateralLiquidated = this.toBN("0");
    const periodCollateralLiquidated = {};

    for (let event of liquidateEvents) {
      allTokensLiquidated = allTokensLiquidated.add(this.toBN(event.tokensOutstanding));
      // We count "lockedCollateral" instead of "liquidatedCollateral" because this is the amount of the collateral that the liquidator is elegible to draw from
      // the contract.
      allCollateralLiquidated = allCollateralLiquidated.add(this.toBN(event.lockedCollateral));
      allUniqueLiquidations[event.sponsor] = true;

      for (let period of periods) {
        if (!periodTokensLiquidated[period.label]) {
          periodTokensLiquidated[period.label] = this.toBN("0");
        }
        if (!periodCollateralLiquidated[period.label]) {
          periodCollateralLiquidated[period.label] = this.toBN("0");
        }
        if (!periodUniqueLiquidations[period.label]) {
          periodUniqueLiquidations[period.label] = {};
        }

        if (this.isEventInPeriod(event, period)) {
          periodTokensLiquidated[period.label] = periodTokensLiquidated[period.label].add(
            this.toBN(event.tokensOutstanding)
          );
          periodCollateralLiquidated[period.label] = periodCollateralLiquidated[period.label].add(
            this.toBN(event.lockedCollateral)
          );
          periodUniqueLiquidations[period.label][event.sponsor] = true;
        }
      }
    }
    return {
      allUniqueLiquidations,
      periodUniqueLiquidations,
      allTokensLiquidated,
      periodTokensLiquidated,
      allCollateralLiquidated,
      periodCollateralLiquidated
    };
  }

  async _filterDisputeData(periods, disputeEvents, liquidationEvents) {
    let allUniqueDisputes = {};
    let periodUniqueDisputes = {};
    let allTokensDisputed = this.toBN("0");
    const periodTokensDisputed = {};
    let allCollateralDisputed = this.toBN("0");
    const periodCollateralDisputed = {};
    const allResolvedDisputes = {};

    for (let event of disputeEvents) {
      // Fetch disputed collateral & token amounts from corresponding liquidation event that with same ID and sponsor.
      const liquidationData = liquidationEvents.filter(
        e => e.liquidationId === event.liquidationId && e.sponsor === event.sponsor
      )[0];

      allTokensDisputed = allTokensDisputed.add(this.toBN(liquidationData.tokensOutstanding));
      allCollateralDisputed = allCollateralDisputed.add(this.toBN(liquidationData.lockedCollateral));
      allUniqueDisputes[event.sponsor] = true;

      for (let period of periods) {
        if (!periodTokensDisputed[period.label]) {
          periodTokensDisputed[period.label] = this.toBN("0");
        }
        if (!periodCollateralDisputed[period.label]) {
          periodCollateralDisputed[period.label] = this.toBN("0");
        }
        if (!periodUniqueDisputes[period.label]) {
          periodUniqueDisputes[period.label] = {};
        }

        if (this.isEventInPeriod(event, period)) {
          periodTokensDisputed[period.label] = periodTokensDisputed[period.label].add(
            this.toBN(liquidationData.tokensOutstanding)
          );
          periodCollateralDisputed[period.label] = periodCollateralDisputed[period.label].add(
            this.toBN(liquidationData.lockedCollateral)
          );
          periodUniqueDisputes[period.label][event.sponsor] = true;
        }
      }

      // Create list of resolved prices for disputed liquidations.
      const liquidationTimestamp = (await this.web3.eth.getBlock(event.blockNumber)).timestamp;
      const disputeLabel = `Liquidation ID ${event.liquidationId} for sponsor ${event.sponsor}`;
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
          allResolvedDisputes[disputeLabel] = this.formatDecimalString(resolvedPrice);
        } else {
          allResolvedDisputes[disputeLabel] = "unresolved";
        }
      } catch (err) {
        allResolvedDisputes[disputeLabel] = "unresolved";
      }
    }
    return {
      allUniqueDisputes,
      periodUniqueDisputes,
      allTokensDisputed,
      periodTokensDisputed,
      allCollateralDisputed,
      periodCollateralDisputed,
      allResolvedDisputes
    };
  }

  _filterRegFeeData(periods, regFeeEvents) {
    let allRegFeesPaid = this.toBN("0");
    let periodRegFeesPaid = {};
    let allLateFeesPaid = this.toBN("0");
    let periodLateFeesPaid = {};

    for (let event of regFeeEvents) {
      allRegFeesPaid = allRegFeesPaid.add(this.toBN(event.regularFee));
      allLateFeesPaid = allLateFeesPaid.add(this.toBN(event.lateFee));

      for (let period of periods) {
        if (!periodRegFeesPaid[period.label]) {
          periodRegFeesPaid[period.label] = this.toBN("0");
        }
        if (!periodLateFeesPaid[period.label]) {
          periodLateFeesPaid[period.label] = this.toBN("0");
        }

        if (this.isEventInPeriod(event, period)) {
          periodRegFeesPaid = periodRegFeesPaid.add(this.toBN(event.regularFee));
          periodLateFeesPaid = periodLateFeesPaid.add(this.toBN(event.lateFee));
        }
      }
    }

    return {
      allRegFeesPaid,
      periodRegFeesPaid,
      allLateFeesPaid,
      periodLateFeesPaid
    };
  }

  _filterFinalFeeData(periods, finalFeeEvents) {
    let allFinalFeesPaid = this.toBN("0");
    let periodFinalFeesPaid = {};

    for (let event of finalFeeEvents) {
      allFinalFeesPaid = allFinalFeesPaid.add(this.toBN(event.amount));

      for (let period of periods) {
        if (!periodFinalFeesPaid[period.label]) {
          periodFinalFeesPaid[period.label] = this.toBN("0");
        }

        if (this.isEventInPeriod(event, period)) {
          periodFinalFeesPaid[period.label] = periodFinalFeesPaid[period.label].add(this.toBN(event.amount));
        }
      }
    }

    return {
      allFinalFeesPaid,
      periodFinalFeesPaid
    };
  }

  /** *******************************************************
   *
   * Main methods that format data into tables to print to console
   *
   * *******************************************************/
  _generateSponsorStats(periods) {
    let allSponsorStatsTable = {};

    if (this.newSponsorEvents.length === 0) {
      console.log(dim("\tNo positions have been created for this EMP."));
      return;
    }

    // - Lifetime # of unique sponsors.
    const newSponsorData = this._filterNewSponsorData(periods, this.newSponsorEvents);
    const currentUniqueSponsors = this.empClient.getAllPositions();
    allSponsorStatsTable["# of unique sponsors"] = {
      cumulative: Object.keys(newSponsorData.allUniqueSponsors).length,
      current: Object.keys(currentUniqueSponsors).length,
      [this.periodLabelInHours]: Object.keys(newSponsorData.periodUniqueSponsors["period"]).length,
      ["Δ from prev. period"]: addSign(
        Object.keys(newSponsorData.periodUniqueSponsors["period"]).length -
          Object.keys(newSponsorData.periodUniqueSponsors["prevPeriod"]).length
      )
    };

    // - Cumulative collateral deposited into contract
    const depositData = this._filterTransferData(periods, this.collateralDepositEvents);
    allSponsorStatsTable["collateral deposited"] = {
      cumulative: this.formatDecimalString(depositData.allCollateralTransferred),
      [this.periodLabelInHours]: this.formatDecimalString(depositData.periodCollateralTransferred["period"]),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(
        depositData.periodCollateralTransferred["period"].sub(depositData.periodCollateralTransferred["prevPeriod"])
      )
    };

    // - Cumulative collateral withdrawn from contract
    const withdrawData = this._filterTransferData(periods, this.collateralWithdrawEvents);
    allSponsorStatsTable["collateral withdrawn"] = {
      cumulative: this.formatDecimalString(withdrawData.allCollateralTransferred),
      [this.periodLabelInHours]: this.formatDecimalString(withdrawData.periodCollateralTransferred["period"]),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(
        withdrawData.periodCollateralTransferred["period"].sub(withdrawData.periodCollateralTransferred["prevPeriod"])
      )
    };

    // - Net collateral deposited into contract:
    let netCollateralWithdrawn = depositData.allCollateralTransferred.sub(withdrawData.allCollateralTransferred);
    if (
      !netCollateralWithdrawn.lt(this.toBN(this.totalPfc.toString()).add(this.accountingVariance)) &&
      !netCollateralWithdrawn.gt(this.toBN(this.totalPfc.toString()).sub(this.accountingVariance))
    ) {
      throw "Net collateral deposited is not equal to current total position collateral + liquidated collateral";
    }
    let netCollateralWithdrawnPeriod = depositData.periodCollateralTransferred["period"].sub(
      withdrawData.periodCollateralTransferred["period"]
    );
    let netCollateralWithdrawnPrevPeriod = depositData.periodCollateralTransferred["prevPeriod"].sub(
      withdrawData.periodCollateralTransferred["prevPeriod"]
    );
    allSponsorStatsTable["net collateral deposited"] = {
      cumulative: this.formatDecimalString(netCollateralWithdrawn),
      [this.periodLabelInHours]: this.formatDecimalString(netCollateralWithdrawnPeriod),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(
        netCollateralWithdrawnPeriod.sub(netCollateralWithdrawnPrevPeriod)
      )
    };

    // - Tokens minted: tracked via Create events.
    const tokenMintData = this._filterCreateData(periods, this.createEvents);
    allSponsorStatsTable["tokens minted"] = {
      cumulative: this.formatDecimalString(tokenMintData.allTokensCreated),
      [this.periodLabelInHours]: this.formatDecimalString(tokenMintData.periodTokensCreated["period"]),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(
        tokenMintData.periodTokensCreated["period"].sub(tokenMintData.periodTokensCreated["prevPeriod"])
      )
    };

    // - Tokens burned
    const tokenBurnData = this._filterTransferData(periods, this.syntheticBurnedEvents);
    allSponsorStatsTable["tokens burned"] = {
      cumulative: this.formatDecimalString(tokenBurnData.allCollateralTransferred),
      [this.periodLabelInHours]: this.formatDecimalString(tokenBurnData.periodCollateralTransferred["period"]),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(
        tokenBurnData.periodCollateralTransferred["period"].sub(tokenBurnData.periodCollateralTransferred["prevPeriod"])
      )
    };

    // - Net tokens minted:
    let netTokensMinted = tokenMintData.allTokensCreated.sub(tokenBurnData.allCollateralTransferred);
    if (
      !netTokensMinted.lt(this.toBN(this.totalTokensOutstanding.toString()).add(this.accountingVariance)) &&
      !netTokensMinted.gt(this.toBN(this.totalTokensOutstanding.toString()).sub(this.accountingVariance))
    ) {
      throw "Net tokens minted is not equal to current tokens outstanding";
    }
    let netTokensMintedPeriod = tokenMintData.periodTokensCreated["period"].sub(
      tokenBurnData.periodCollateralTransferred["period"]
    );
    let netTokensMintedPrevPeriod = tokenMintData.periodTokensCreated["prevPeriod"].sub(
      tokenBurnData.periodCollateralTransferred["prevPeriod"]
    );
    allSponsorStatsTable["net tokens minted"] = {
      cumulative: this.formatDecimalString(netTokensMinted),
      [this.periodLabelInHours]: this.formatDecimalString(netTokensMintedPeriod),
      ["Δ from prev. period"]: this.formatDecimalStringWithSign(netTokensMintedPeriod.sub(netTokensMintedPrevPeriod))
    };

    // - GCR (collateral / tokens outstanding):
    let currentCollateral = this.toBN(this.totalPositionCollateral.toString());
    let currentTokensOutstanding = this.toBN(this.totalTokensOutstanding.toString());
    let currentGCR = currentCollateral.mul(this.toBN(this.toWei("1"))).div(currentTokensOutstanding);
    allSponsorStatsTable["GCR - collateral / # tokens outstanding"] = {
      current: this.formatDecimalString(currentGCR)
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

  async _generateTokenStats(periods) {
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
    const tokenHolderStats = this._constructTokenHolderList(periods);
    allTokenStatsTable["# of token holders"] = {
      current: Object.keys(tokenHolderStats.currentTokenHolders).length,
      cumulative: Object.keys(tokenHolderStats.countAllTokenHolders).length,
      [this.periodLabelInHours]: Object.keys(tokenHolderStats.countPeriodTokenHolders["period"]).length,
      ["Δ from prev. period"]: addSign(
        Object.keys(tokenHolderStats.countPeriodTokenHolders["period"]).length -
          Object.keys(tokenHolderStats.countPeriodTokenHolders["prevPeriod"]).length
      )
    };
    console.table(allTokenStatsTable);
  }

  _generateLiquidationStats(periods) {
    let allLiquidationStatsTable = {};

    if (this.liquidationEvents.length === 0) {
      console.log(dim("\tNo liquidation events found for this EMP."));
    } else {
      const liquidationData = this._filterLiquidationData(periods, this.liquidationEvents);
      allLiquidationStatsTable = {
        ["# of liquidations"]: {
          cumulative: Object.keys(liquidationData.allUniqueLiquidations).length,
          [this.periodLabelInHours]: Object.keys(liquidationData.periodUniqueLiquidations["period"]).length,
          ["Δ from prev. period"]: addSign(
            Object.keys(liquidationData.periodUniqueLiquidations["period"]).length -
              Object.keys(liquidationData.periodUniqueLiquidations["prevPeriod"]).length
          )
        },
        ["tokens liquidated"]: {
          cumulative: this.formatDecimalString(liquidationData.allTokensLiquidated),
          [this.periodLabelInHours]: this.formatDecimalString(liquidationData.periodTokensLiquidated["period"]),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            liquidationData.periodTokensLiquidated["period"].sub(liquidationData.periodTokensLiquidated["prevPeriod"])
          )
        },
        ["collateral liquidated"]: {
          cumulative: this.formatDecimalString(liquidationData.allCollateralLiquidated),
          [this.periodLabelInHours]: this.formatDecimalString(liquidationData.periodCollateralLiquidated["period"]),
          current: this.formatDecimalString(this.collateralLockedInLiquidations),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            liquidationData.periodCollateralLiquidated["period"].sub(
              liquidationData.periodCollateralLiquidated["prevPeriod"]
            )
          )
        }
      };

      console.table(allLiquidationStatsTable);
    }
  }

  async _generateDisputeStats(periods) {
    let allDisputeStatsTable = {};

    if (this.disputeEvents.length === 0) {
      console.log(dim("\tNo dispute events found for this EMP."));
    } else {
      const disputeData = await this._filterDisputeData(periods, this.disputeEvents, this.liquidationEvents);
      allDisputeStatsTable = {
        ["# of disputes"]: {
          cumulative: Object.keys(disputeData.allUniqueDisputes).length,
          [this.periodLabelInHours]: Object.keys(disputeData.periodUniqueDisputes["period"]).length,
          ["Δ from prev. period"]: addSign(
            Object.keys(disputeData.periodUniqueDisputes["period"]).length -
              Object.keys(disputeData.periodUniqueDisputes["prevPeriod"]).length
          )
        },
        ["tokens disputed"]: {
          cumulative: this.formatDecimalString(disputeData.allTokensDisputed),
          [this.periodLabelInHours]: this.formatDecimalString(disputeData.periodTokensDisputed["period"]),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            disputeData.periodTokensDisputed["period"].sub(disputeData.periodTokensDisputed["prevPeriod"])
          )
        },
        ["collateral disputed"]: {
          cumulative: this.formatDecimalString(disputeData.allCollateralDisputed),
          [this.periodLabelInHours]: this.formatDecimalString(disputeData.periodCollateralDisputed["period"]),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            disputeData.periodCollateralDisputed["period"].sub(disputeData.periodCollateralDisputed["prevPeriod"])
          )
        }
      };

      console.table(allDisputeStatsTable);

      console.group("Dispute resolution prices");
      console.table(disputeData.allResolvedDisputes);
      console.groupEnd();
    }
  }

  _generateDvmStats(periods) {
    let allDvmStatsTable = {};

    // Regular fees
    if (this.regularFeeEvents.length === 0) {
      console.log(dim("\tNo regular fee events found for this EMP."));
    } else {
      const regFeeData = this._filterRegFeeData(periods, this.regularFeeEvents);
      allDvmStatsTable = {
        ["ongoing regular fees paid to store"]: {
          cumulative: this.formatDecimalString(regFeeData.allRegFeesPaid),
          [this.periodLabelInHours]: this.formatDecimalString(regFeeData.periodRegFeesPaid["period"]),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            regFeeData.periodRegFeesPaid["period"].sub(regFeeData.periodRegFeesPaid["prevPeriod"])
          )
        },
        ["ongoing late fees paid to store"]: {
          cumulative: this.formatDecimalString(regFeeData.allLateFeesPaid),
          [this.periodLabelInHours]: this.formatDecimalString(regFeeData.periodLateFeesPaid["period"]),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            regFeeData.periodLateFeesPaid["period"].sub(regFeeData.periodLateFeesPaid["prevPeriod"])
          )
        }
      };
    }

    // Final fees
    if (this.finalFeeEvents.length === 0) {
      console.log(dim("\tNo final fee events found for this EMP."));
    } else {
      const finalFeeData = this._filterFinalFeeData(periods, this.finalFeeEvents);
      allDvmStatsTable = {
        ["final fees paid to store"]: {
          cumulative: this.formatDecimalString(finalFeeData.allFinalFeesPaid),
          [this.periodLabelInHours]: this.formatDecimalString(finalFeeData.periodFinalFeesPaid["period"]),
          ["Δ from prev. period"]: this.formatDecimalStringWithSign(
            finalFeeData.periodFinalFeesPaid["period"].sub(finalFeeData.periodFinalFeesPaid["prevPeriod"])
          )
        }
      };
    }

    if (Object.keys(allDvmStatsTable).length !== 0) {
      console.table(allDvmStatsTable);
    }
  }

  /** *******************************************************
   *
   * Misc. helper methods
   *
   * *******************************************************/

  // Returns token holder statistics since synthetic token inception and for the periods input.
  // Statistics include:
  // - count of unique token holders during a period
  // - final account balance at the end of the period
  _constructTokenHolderList(periods) {
    // Unique token holders who held any balance during a period:
    const countAllTokenHolders = {};
    const countPeriodTokenHolders = {};

    // Net balances during a period:
    const currentTokenHolders = {};
    const periodTokenHolders = {};

    let allTransferEvents = this.syntheticTransferEvents;

    // Sort events from oldest first to newest last.
    allTransferEvents.sort((a, b) => {
      return a.blockNumber < b.blockNumber;
    });

    allTransferEvents.forEach(event => {
      const sender = event.returnValues.from;
      const receiver = event.returnValues.to;

      if (receiver !== ZERO_ADDRESS) {
        // Add to token holder list.
        countAllTokenHolders[receiver] = true;

        // Initialize balance if we have not seen this receiver yet.
        if (!currentTokenHolders[receiver]) {
          currentTokenHolders[receiver] = this.toBN("0");
        }

        // Update balances for periods.
        currentTokenHolders[receiver] = currentTokenHolders[receiver].add(this.toBN(event.returnValues.value));

        // Since we are searching from oldest to newest block, the receiver account's balance for this period will always
        // be equal to its cumulative balance.
        for (let period of periods) {
          if (!periodTokenHolders[period.label]) {
            periodTokenHolders[period.label] = {};
          }
          if (!countPeriodTokenHolders[period.label]) {
            countPeriodTokenHolders[period.label] = {};
          }

          if (this.isEventInPeriod(event, period)) {
            countPeriodTokenHolders[period.label][receiver] = true;
            periodTokenHolders[period.label][receiver] = currentTokenHolders[receiver];
          }
        }
      }

      if (sender !== ZERO_ADDRESS) {
        // Since we are searching from oldest to newest block, it is possible that the sender has not been seen yet
        // as a receiver despite it having a balance. So, we need to initialize the sender's balance for this period
        // before we update its cumulative balance.
        for (let period of periods) {
          if (this.isEventInPeriod(event, period)) {
            countPeriodTokenHolders[period.label][sender] = true;

            if (!currentTokenHolders[sender]) {
              // If we have not seen this sender yet, then we can initialize its balance to 0.
              periodTokenHolders[period.label][sender] = this.toBN("0");
            } else {
              // If we have seen this sender, but we have not seen the sender as a receiver within this period,
              // then its balance should be get initialized to its cumulative balance.
              periodTokenHolders[period.label][sender] = currentTokenHolders[sender];
            }

            periodTokenHolders[period.label][sender] = periodTokenHolders[period.label][sender].sub(
              this.toBN(event.returnValues.value)
            );

            if (periodTokenHolders[period.label][sender].isZero()) {
              delete periodTokenHolders[period.label][sender];
            }
          }
        }

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
      countAllTokenHolders,
      countPeriodTokenHolders,
      currentTokenHolders,
      periodTokenHolders
    };
  }

  // Converts an interval in seconds to block height
  async _getLookbackTimeInBlocks(lookbackTimeInSeconds) {
    const blockTimeInSeconds = await averageBlockTimeSeconds();
    const blocksToLookBack = Math.ceil(lookbackTimeInSeconds / blockTimeInSeconds);
    return blocksToLookBack;
  }
}
module.exports = {
  GlobalSummaryReporter
};
