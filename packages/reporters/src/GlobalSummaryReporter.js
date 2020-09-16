const {
  createFormatFunction,
  formatDateShort,
  formatDate,
  formatWithMaxDecimals,
  addSign,
  revertWrapper,
  averageBlockTimeSeconds
} = require("@uma/common");
const { getUniswapClient, queries: uniswapQueries } = require("./graphql/uniswapSubgraph");
const { getUmaClient, queries: umaQueries } = require("./graphql/umaSubgraph");
const { getUniswapPairDetails } = require("@uma/financial-templates-lib");
const chalkPipe = require("chalk-pipe");
const bold = chalkPipe("bold");
const italic = chalkPipe("italic");
const dim = chalkPipe("dim");
const fetch = require("node-fetch");

class GlobalSummaryReporter {
  constructor(
    expiringMultiPartyEventClient,
    referencePriceFeed,
    uniswapPriceFeed,
    oracle,
    collateralToken,
    syntheticToken,
    exchangePairOverride,
    endDateOffsetSeconds,
    periodLengthSeconds
  ) {
    this.empEventClient = expiringMultiPartyEventClient;
    this.referencePriceFeed = referencePriceFeed;
    this.uniswapPriceFeed = uniswapPriceFeed;

    this.endDateOffsetSeconds = endDateOffsetSeconds;
    this.periodLengthSeconds = periodLengthSeconds;

    this.web3 = this.empEventClient.web3;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.toChecksumAddress = this.web3.utils.toChecksumAddress;

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

    this.exchangePairOverride = exchangePairOverride;

    // If we have data from one of the swap exchanges to display, then this will be `true`.
    this.hasExchangeData = false;
  }

  async update() {
    await this.empEventClient.update();
    await this.referencePriceFeed.update();

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

    // Events loaded by EMPEventClient.update()
    this.newSponsorEvents = this.empEventClient.getAllNewSponsorEvents();
    this.createEvents = this.empEventClient.getAllCreateEvents();
    this.regularFeeEvents = this.empEventClient.getAllRegularFeeEvents();
    this.finalFeeEvents = this.empEventClient.getAllFinalFeeEvents();
    this.disputeEvents = this.empEventClient.getAllDisputeEvents();
    this.disputeSettledEvents = this.empEventClient.getAllDisputeSettlementEvents();

    // Events queried from UMA subgraph
    this.umaClient = getUmaClient();
    const empData = (await this.umaClient.request(umaQueries.EMP_STATS(this.empContract.options.address.toLowerCase())))
      .financialContracts[0];
    this.liquidationRelatedEvents = empData.liquidations;
    this.liquidationCreatedEvents = [];
    if (this.liquidationRelatedEvents) {
      this.liquidationRelatedEvents.forEach(liq => {
        liq.events.forEach(e => {
          if (e.__typename === "LiquidationCreatedEvent") {
            this.liquidationCreatedEvents.push({
              ...e.liquidation,
              // Add event block # to liquidation data
              block: Number(e.block)
            });
          }
        });
      });
    }
    this.totalCollateralDeposited = empData.totalCollateralDeposited;
    this.totalCollateralWithdrawn = empData.totalCollateralWithdrawn;
    this.totalSyntheticTokensBurned = empData.totalSyntheticTokensBurned;
    this.totalSyntheticTokensCreated = empData.totalSyntheticTokensCreated;
    this.currentUniqueSponsors = empData.positions.length;

    const endPeriodEmpData = (
      await this.umaClient.request(
        umaQueries.EMP_STATS(this.empContract.options.address.toLowerCase(), this.endBlockNumberForPeriod)
      )
    ).financialContracts[0];
    const startPeriodEmpData = (
      await this.umaClient.request(
        umaQueries.EMP_STATS(this.empContract.options.address.toLowerCase(), this.startBlockNumberForPeriod)
      )
    ).financialContracts[0];
    const startPrevPeriodEmpData = (
      await this.umaClient.request(
        umaQueries.EMP_STATS(this.empContract.options.address.toLowerCase(), this.startBlockNumberForPreviousPeriod)
      )
    ).financialContracts[0];

    // endPeriodEmpData should always have data because it is the most recent snapshot,
    // however if either `startPeriodEmpData` or `startPrevPeriodEmpData` are undefined then it is
    // possible that the subgraph does not have data that far back.
    if (startPeriodEmpData) {
      this.periodTotalCollateralDeposited = (
        Number(endPeriodEmpData.totalCollateralDeposited) - Number(startPeriodEmpData.totalCollateralDeposited)
      ).toString();
      this.periodTotalCollateralWithdrawn = (
        Number(endPeriodEmpData.totalCollateralWithdrawn) - Number(startPeriodEmpData.totalCollateralWithdrawn)
      ).toString();
      this.periodTotalSyntheticTokensBurned = (
        Number(endPeriodEmpData.totalSyntheticTokensBurned) - Number(startPeriodEmpData.totalSyntheticTokensBurned)
      ).toString();
      this.periodTotalSyntheticTokensCreated = (
        Number(endPeriodEmpData.totalSyntheticTokensCreated) - Number(startPeriodEmpData.totalSyntheticTokensCreated)
      ).toString();
    }

    if (startPrevPeriodEmpData) {
      this.prevPeriodTotalCollateralDeposited = (
        Number(startPeriodEmpData.totalCollateralDeposited) - Number(startPrevPeriodEmpData.totalCollateralDeposited)
      ).toString();
      this.prevPeriodTotalCollateralWithdrawn = (
        Number(startPeriodEmpData.totalCollateralWithdrawn) - Number(startPrevPeriodEmpData.totalCollateralWithdrawn)
      ).toString();
      this.prevPeriodTotalSyntheticTokensBurned = (
        Number(startPeriodEmpData.totalSyntheticTokensBurned) -
        Number(startPrevPeriodEmpData.totalSyntheticTokensBurned)
      ).toString();
      this.prevPeriodTotalSyntheticTokensCreated = (
        Number(startPeriodEmpData.totalSyntheticTokensCreated) -
        Number(startPrevPeriodEmpData.totalSyntheticTokensCreated)
      ).toString();
    }

    // EMP Contract stats.
    this.totalPositionCollateral = await this.empContract.methods.totalPositionCollateral().call();
    this.totalTokensOutstanding = await this.empContract.methods.totalTokensOutstanding().call();
    this.totalPfc = await this.empContract.methods.pfc().call();
    this.collateralLockedInLiquidations = this.toBN(this.totalPfc.toString()).sub(
      this.toBN(this.totalPositionCollateral.toString())
    );

    // Pricefeed stats.
    this.priceEstimate = this.referencePriceFeed.getCurrentPrice();

    // Initialize exchange pair address to get trade data for. Default pair token is the collateral token.
    this.exchangePairToken = this.exchangePairOverride[this.toChecksumAddress(this.empContract.options.address)]
      ? this.exchangePairOverride[this.toChecksumAddress(this.empContract.options.address)]
      : this.collateralContract;

    // Uniswap data:
    if (this.uniswapPriceFeed) {
      await this.uniswapPriceFeed.update();

      this.uniswapPairDetails = await getUniswapPairDetails(
        this.web3,
        this.syntheticContract.address,
        this.exchangePairToken.address
      );
      this.uniswapPairAddress = this.uniswapPairDetails.pairAddress.toLowerCase();

      // Set up Uniswap subgraph client and query latest update stats.
      // If the `latestSwapBlockNumber` < `endBlockNumberForPeriod`, then set `endBlockNumberForPeriod = latestSwapBlockNumber`
      // otherwise the graphQL client will throw an error when trying to access a block that it has not indexed yet.
      // Its ok to use the latest swap's block number as the end-period block number because we are only querying swap data for this pair.
      // If we were using `endBlockNumberForPeriod` to query data for some other pair as well,
      // then we wouldn't be able to set `endBlockNumberForPeriod = latestSwapBlockNumber`
      this.uniswapClient = getUniswapClient();
      const latestSwap = (await this.uniswapClient.request(uniswapQueries.LAST_TRADE_FOR_PAIR(this.uniswapPairAddress)))
        .swaps[0].transaction;
      this.latestSwapTimestamp = latestSwap.timestamp;
      this.latestSwapBlockNumber = Number(latestSwap.blockNumber);
      // Note: `lastExchangeBlockNumberForPeriod` is the highest block number that we will manually query the uniswap subgraph for.
      if (this.endBlockNumberForPeriod > this.latestSwapBlockNumber) {
        this.lastExchangeBlockNumberForPeriod = this.latestSwapBlockNumber;
      } else {
        this.lastExchangeBlockNumberForPeriod = this.endBlockNumberForPeriod;
      }
    }

    // TODO: Balancer data:

    // Have we successfully fetched any exchange data from the graph API?
    this.hasExchangeData = this.latestSwapTimestamp;
  }

  async generateSummaryStatsTable() {
    await this.update();

    // Set up periods for querying data at specific intervals.
    const periods = [
      { label: "period", start: this.startBlockNumberForPeriod, end: this.endBlockNumberForPeriod },
      { label: "prevPeriod", start: this.startBlockNumberForPreviousPeriod, end: this.startBlockNumberForPeriod }
    ];
    this.isBlockInPeriod = (blockNum, period) => {
      return Boolean(blockNum >= period.start && blockNum < period.end);
    };

    // 1. Sponsor stats table
    console.group();
    console.log(
      bold(`Sponsor summary stats (as of ${formatDate(this.empEventClient.lastUpdateTimestamp, this.web3)})`)
    );
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

    // 2a. Tokens Swaps table
    if (this.hasExchangeData) {
      console.group();
      console.log(
        bold(
          `Exchange pair (${await this.syntheticContract.symbol()}-${await this.exchangePairToken.symbol()}) summary stats (as of the latest swap @ ${formatDate(
            this.latestSwapTimestamp,
            this.web3
          )})`
        )
      );
      console.log(
        italic("- Token price is sourced from exchange where synthetic token is traded (i.e. Uniswap, Balancer)")
      );
      await this._generateExchangeStats();
      console.groupEnd();
    }

    // 2b. Tokens Holder table
    console.group();
    console.log(
      bold(`Synthetic Token Ownership stats (as of ${formatDate(this.empEventClient.lastUpdateTimestamp, this.web3)})`)
    );
    console.log(
      italic("- Token holder counts are equal to the # of unique token holders who held any balance during a period")
    );
    await this._generateTokenHolderStats();
    console.groupEnd();

    // 3. Liquidation stats table
    console.group();
    console.log(
      bold(`Liquidation summary stats (as of ${formatDate(this.empEventClient.lastUpdateTimestamp, this.web3)})`)
    );
    console.log(italic("- Unique liquidations count # of unique sponsors that have been liquidated"));
    console.log(italic("- Collateral & tokens liquidated counts aggregate amounts from all partial liquidations"));
    console.log(italic("- Current collateral liquidated includes any collateral locked in pending liquidations"));
    this._generateLiquidationStats(periods);
    console.groupEnd();

    // 4. Dispute stats table
    console.group();
    console.log(
      bold(`Dispute summary stats (as of ${formatDate(this.empEventClient.lastUpdateTimestamp, this.web3)})`)
    );
    await this._generateDisputeStats(periods);
    console.groupEnd();

    // 5. DVM stats table
    console.group();
    console.log(bold(`DVM summary stats (as of ${formatDate(this.empEventClient.lastUpdateTimestamp, this.web3)})`));
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

        if (this.isBlockInPeriod(event.blockNumber, period)) {
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

        if (this.isBlockInPeriod(event.blockNumber, period)) {
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

        if (this.isBlockInPeriod(event.blockNumber, period)) {
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
    let allTokensLiquidated = 0;
    const periodTokensLiquidated = {};
    let allCollateralLiquidated = 0;
    const periodCollateralLiquidated = {};

    for (let event of liquidateEvents) {
      allTokensLiquidated += parseFloat(event.tokensLiquidated);
      // We count "lockedCollateral" instead of "liquidatedCollateral" because this is the amount of the collateral that the liquidator is elegible to draw from
      // the contract.
      allCollateralLiquidated += parseFloat(event.lockedCollateral);
      allUniqueLiquidations[event.sponsor.id] = true;

      for (let period of periods) {
        if (!periodTokensLiquidated[period.label]) {
          periodTokensLiquidated[period.label] = 0;
        }
        if (!periodCollateralLiquidated[period.label]) {
          periodCollateralLiquidated[period.label] = 0;
        }
        if (!periodUniqueLiquidations[period.label]) {
          periodUniqueLiquidations[period.label] = {};
        }

        if (this.isBlockInPeriod(event.block, period)) {
          periodTokensLiquidated[period.label] += parseFloat(event.tokensLiquidated);
          periodCollateralLiquidated[period.label] += parseFloat(event.lockedCollateral);
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
    let allTokensDisputed = 0;
    const periodTokensDisputed = {};
    let allCollateralDisputed = 0;
    const periodCollateralDisputed = {};
    const allResolvedDisputes = {};

    for (let event of disputeEvents) {
      // Fetch disputed collateral & token amounts from corresponding liquidation event that with same ID and sponsor.
      const liquidationData = liquidationEvents.filter(
        e => e.liquidationId === event.liquidationId && e.sponsor.id === event.sponsor.toLowerCase()
      )[0];

      allTokensDisputed += parseFloat(liquidationData.tokensLiquidated);
      allCollateralDisputed += parseFloat(liquidationData.lockedCollateral);
      allUniqueDisputes[event.sponsor] = true;

      for (let period of periods) {
        if (!periodTokensDisputed[period.label]) {
          periodTokensDisputed[period.label] = 0;
        }
        if (!periodCollateralDisputed[period.label]) {
          periodCollateralDisputed[period.label] = 0;
        }
        if (!periodUniqueDisputes[period.label]) {
          periodUniqueDisputes[period.label] = {};
        }

        if (this.isBlockInPeriod(event.blockNumber, period)) {
          periodTokensDisputed[period.label] += parseFloat(liquidationData.tokensLiquidated);
          periodCollateralDisputed[period.label] += parseFloat(liquidationData.lockedCollateral);
          periodUniqueDisputes[period.label][event.sponsor] = true;
        }
      }

      // Create list of resolved prices for disputed liquidations. Note that this `web3.getBlock().timestamp` call to get the liquidation timestamp
      // only works on public networks. It will NOT work on local networks that use the MockOracle/Timer contract where block timestamp !== EMP timestamp.
      const liquidationTimestamp = (await this.web3.eth.getBlock(liquidationData.block)).timestamp;
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

        if (this.isBlockInPeriod(event.blockNum, period)) {
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

        if (this.isBlockInPeriod(event.blockNumber, period)) {
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
    const currentUniqueSponsors = this.currentUniqueSponsors;
    allSponsorStatsTable["# of unique sponsors"] = {
      cumulative: Object.keys(newSponsorData.allUniqueSponsors).length,
      current: currentUniqueSponsors,
      [this.periodLabelInHours]: Object.keys(newSponsorData.periodUniqueSponsors["period"]).length,
      ["Δ from prev. period"]: addSign(
        Object.keys(newSponsorData.periodUniqueSponsors["period"]).length -
          Object.keys(newSponsorData.periodUniqueSponsors["prevPeriod"]).length
      )
    };

    // - Cumulative collateral deposited into contract
    allSponsorStatsTable["collateral deposited"] = {
      cumulative: this.formatDecimalString(this.toWei(this.totalCollateralDeposited))
    };
    if (this.periodTotalCollateralDeposited && this.prevPeriodTotalCollateralDeposited) {
      allSponsorStatsTable["collateral deposited"] = {
        ...allSponsorStatsTable["collateral deposited"],
        [this.periodLabelInHours]: this.formatDecimalString(this.toWei(this.periodTotalCollateralDeposited)),
        ["Δ from prev. period"]: this.formatDecimalStringWithSign(
          this.toBN(this.toWei(this.periodTotalCollateralDeposited)).sub(
            this.toBN(this.toWei(this.prevPeriodTotalCollateralDeposited))
          )
        )
      };
    }

    // - Cumulative collateral withdrawn from contract
    allSponsorStatsTable["collateral withdrawn"] = {
      cumulative: this.formatDecimalString(this.toWei(this.totalCollateralWithdrawn))
    };
    if (this.periodTotalCollateralWithdrawn && this.prevPeriodTotalCollateralWithdrawn) {
      allSponsorStatsTable["collateral withdrawn"] = {
        ...allSponsorStatsTable["collateral withdrawn"],
        [this.periodLabelInHours]: this.formatDecimalString(this.toWei(this.periodTotalCollateralWithdrawn)),
        ["Δ from prev. period"]: this.formatDecimalStringWithSign(
          this.toBN(this.toWei(this.periodTotalCollateralWithdrawn)).sub(
            this.toBN(this.toWei(this.prevPeriodTotalCollateralWithdrawn))
          )
        )
      };
    }

    // - Net collateral deposited into contract:
    let netCollateralWithdrawn = this.toBN(this.toWei(this.totalCollateralDeposited)).sub(
      this.toBN(this.toWei(this.totalCollateralWithdrawn))
    );
    if (
      !netCollateralWithdrawn.lt(this.toBN(this.totalPfc.toString()).add(this.accountingVariance)) &&
      !netCollateralWithdrawn.gt(this.toBN(this.totalPfc.toString()).sub(this.accountingVariance))
    ) {
      throw "Net collateral deposited is not equal to current total position collateral + liquidated collateral";
    }
    allSponsorStatsTable["net collateral deposited"] = {
      cumulative: this.formatDecimalString(netCollateralWithdrawn)
    };
    if (
      this.periodTotalCollateralWithdrawn &&
      this.prevPeriodTotalCollateralWithdrawn &&
      this.periodTotalCollateralDeposited &&
      this.prevPeriodTotalCollateralDeposited
    ) {
      this.netCollateralWithdrawnPeriod = (
        Number(this.periodTotalCollateralDeposited) - Number(this.periodTotalCollateralWithdrawn)
      ).toString();
      this.netCollateralWithdrawnPrevPeriod = (
        Number(this.prevPeriodTotalCollateralDeposited) - Number(this.prevPeriodTotalCollateralWithdrawn)
      ).toString();
      allSponsorStatsTable["net collateral deposited"] = {
        ...allSponsorStatsTable["net collateral deposited"],
        [this.periodLabelInHours]: this.formatDecimalString(this.toWei(this.netCollateralWithdrawnPeriod)),
        ["Δ from prev. period"]: this.formatDecimalStringWithSign(
          this.toBN(this.toWei(this.netCollateralWithdrawnPeriod)).sub(
            this.toBN(this.toWei(this.netCollateralWithdrawnPrevPeriod))
          )
        )
      };
    }

    // - Tokens minted: tracked via Create events.
    allSponsorStatsTable["tokens minted"] = {
      cumulative: this.formatDecimalString(this.toWei(this.totalSyntheticTokensCreated))
    };
    if (this.periodTotalSyntheticTokensCreated && this.prevPeriodTotalSyntheticTokensCreated) {
      allSponsorStatsTable["tokens minted"] = {
        ...allSponsorStatsTable["tokens minted"],
        [this.periodLabelInHours]: this.formatDecimalString(this.toWei(this.periodTotalSyntheticTokensCreated)),
        ["Δ from prev. period"]: this.formatDecimalStringWithSign(
          this.toBN(this.toWei(this.periodTotalSyntheticTokensCreated)).sub(
            this.toBN(this.toWei(this.prevPeriodTotalSyntheticTokensCreated))
          )
        )
      };
    }

    // - Tokens burned
    allSponsorStatsTable["tokens burned"] = {
      cumulative: this.formatDecimalString(this.toWei(this.totalSyntheticTokensBurned))
    };
    if (this.periodTotalSyntheticTokensBurned && this.prevPeriodTotalSyntheticTokensBurned) {
      allSponsorStatsTable["tokens burned"] = {
        ...allSponsorStatsTable["tokens burned"],
        [this.periodLabelInHours]: this.formatDecimalString(this.toWei(this.periodTotalSyntheticTokensBurned)),
        ["Δ from prev. period"]: this.formatDecimalStringWithSign(
          this.toBN(this.toWei(this.periodTotalSyntheticTokensBurned)).sub(
            this.toBN(this.toWei(this.prevPeriodTotalSyntheticTokensBurned))
          )
        )
      };
    }

    // - Net tokens minted:
    let netTokensMinted = this.toBN(this.toWei(this.totalSyntheticTokensCreated)).sub(
      this.toBN(this.toWei(this.totalSyntheticTokensBurned))
    );
    if (
      !netTokensMinted.lt(this.toBN(this.totalTokensOutstanding.toString()).add(this.accountingVariance)) &&
      !netTokensMinted.gt(this.toBN(this.totalTokensOutstanding.toString()).sub(this.accountingVariance))
    ) {
      throw "Net tokens minted is not equal to current tokens outstanding";
    }
    allSponsorStatsTable["net tokens minted"] = {
      cumulative: this.formatDecimalString(netTokensMinted)
    };
    if (
      this.periodTotalSyntheticTokensCreated &&
      this.periodTotalSyntheticTokensBurned &&
      this.prevPeriodTotalSyntheticTokensCreated &&
      this.prevPeriodTotalSyntheticTokensBurned
    ) {
      this.netTokensMintedPeriod = (
        Number(this.periodTotalSyntheticTokensCreated) - Number(this.periodTotalSyntheticTokensBurned)
      ).toString();
      this.netTokensMintedPrevPeriod = (
        Number(this.prevPeriodTotalSyntheticTokensCreated) - Number(this.prevPeriodTotalSyntheticTokensBurned)
      ).toString();
      allSponsorStatsTable["net tokens minted"] = {
        ...allSponsorStatsTable["net tokens minted"],
        [this.periodLabelInHours]: this.formatDecimalString(this.toWei(this.netTokensMintedPeriod)),
        ["Δ from prev. period"]: this.formatDecimalStringWithSign(
          this.toBN(this.toWei(this.netTokensMintedPeriod)).sub(this.toBN(this.toWei(this.netTokensMintedPrevPeriod)))
        )
      };
    }

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

  async _generateTokenHolderStats() {
    let allTokenHolderStatsTable = {};

    allTokenHolderStatsTable["# tokens outstanding"] = {
      current: this.formatDecimalString(this.totalTokensOutstanding)
    };

    // Get token holder stats.
    const tokenHolderCount = await this._getTokenHolderCount();
    allTokenHolderStatsTable["# of token holders"] = {
      current: tokenHolderCount
    };
    console.table(allTokenHolderStatsTable);
  }

  async _generateExchangeStats() {
    let allExchangeStatsTable = {};

    if (this.uniswapPriceFeed) {
      const currentTokenPrice = this.uniswapPriceFeed.getLastBlockPrice();
      const twapTokenPrice = this.uniswapPriceFeed.getCurrentPrice();
      allExchangeStatsTable["Token price"] = {
        current: this.formatDecimalString(currentTokenPrice),
        TWAP: this.formatDecimalString(twapTokenPrice)
      };

      // Get uniswap trade data via graphql.
      const volumeTokenLabel = this.uniswapPairDetails.inverted ? "volumeToken1" : "volumeToken0";
      const allTokenData = (await this.uniswapClient.request(uniswapQueries.PAIR_DATA(this.uniswapPairAddress)))
        .pairs[0];
      const tradeCount = parseInt(allTokenData.txCount);
      const tradeVolumeTokens = parseFloat(allTokenData[volumeTokenLabel]);

      // Calculate Uniswap trade count and volume data.
      if (!allTokenData) {
        // If there is no data for this pair, then we cannot get trade count or volume data.
        allExchangeStatsTable["# trades in Uniswap"] = {
          cumulative: "Graph data unavailable"
        };
        allExchangeStatsTable["volume of trades in Uniswap in # of tokens"] = {
          cumulative: "Graph data unavailable"
        };
      } else {
        // Try to get sub period data from graph. This might fail if subgraph latest block is too far behind actual latest block.
        let periodTradeCount, prevPeriodTradeCount;
        let periodTradeVolumeTokens, prevPeriodTradeVolumeTokens;
        try {
          const startPeriodTokenData = (
            await this.uniswapClient.request(
              uniswapQueries.PAIR_DATA(this.uniswapPairAddress, this.startBlockNumberForPeriod)
            )
          ).pairs[0];
          const endPeriodTokenData = (
            await this.uniswapClient.request(
              uniswapQueries.PAIR_DATA(this.uniswapPairAddress, this.lastExchangeBlockNumberForPeriod)
            )
          ).pairs[0];
          const startPrevPeriodTokenData = (
            await this.uniswapClient.request(
              uniswapQueries.PAIR_DATA(this.uniswapPairAddress, this.startBlockNumberForPreviousPeriod)
            )
          ).pairs[0];

          periodTradeCount = parseInt(endPeriodTokenData.txCount) - parseInt(startPeriodTokenData.txCount);
          prevPeriodTradeCount = parseInt(startPeriodTokenData.txCount) - parseInt(startPrevPeriodTokenData.txCount);

          periodTradeVolumeTokens =
            parseFloat(endPeriodTokenData[volumeTokenLabel]) - parseFloat(startPeriodTokenData[volumeTokenLabel]);
          prevPeriodTradeVolumeTokens =
            parseFloat(startPeriodTokenData[volumeTokenLabel]) - parseFloat(startPrevPeriodTokenData[volumeTokenLabel]);
        } catch (error) {
          console.error("Could not get data for subperiod:", error.message);
          // Ignore error, mark data as unavailable.
        }

        // Display data in table.
        allExchangeStatsTable["# trades in Uniswap"] = {
          cumulative: tradeCount,
          [this.periodLabelInHours]: periodTradeCount,
          ["Δ from prev. period"]: addSign(periodTradeCount - prevPeriodTradeCount)
        };
        allExchangeStatsTable["volume of trades in Uniswap in # of tokens"] = {
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
      }
    }

    console.table(allExchangeStatsTable);
  }

  _generateLiquidationStats(periods) {
    let allLiquidationStatsTable = {};

    if (this.liquidationCreatedEvents.length === 0) {
      console.log(dim("\tNo liquidation events found for this EMP."));
    } else {
      const liquidationData = this._filterLiquidationData(periods, this.liquidationCreatedEvents);
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
          cumulative: liquidationData.allTokensLiquidated.toLocaleString(),
          [this.periodLabelInHours]: liquidationData.periodTokensLiquidated["period"].toLocaleString(),
          ["Δ from prev. period"]: (
            liquidationData.periodTokensLiquidated["period"] - liquidationData.periodTokensLiquidated["prevPeriod"]
          ).toLocaleString()
        },
        ["collateral liquidated"]: {
          cumulative: liquidationData.allCollateralLiquidated.toLocaleString(),
          [this.periodLabelInHours]: liquidationData.periodCollateralLiquidated["period"].toLocaleString(),
          current: this.formatDecimalString(this.collateralLockedInLiquidations),
          ["Δ from prev. period"]: (
            liquidationData.periodCollateralLiquidated["period"] -
            liquidationData.periodCollateralLiquidated["prevPeriod"]
          ).toLocaleString()
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
      const disputeData = await this._filterDisputeData(periods, this.disputeEvents, this.liquidationCreatedEvents);
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
          cumulative: disputeData.allTokensDisputed.toLocaleString(),
          [this.periodLabelInHours]: disputeData.periodTokensDisputed["period"].toLocaleString(),
          ["Δ from prev. period"]: (
            disputeData.periodTokensDisputed["period"] - disputeData.periodTokensDisputed["prevPeriod"]
          ).toLocaleString()
        },
        ["collateral disputed"]: {
          cumulative: disputeData.allCollateralDisputed.toLocaleString(),
          [this.periodLabelInHours]: disputeData.periodCollateralDisputed["period"].toLocaleString(),
          ["Δ from prev. period"]: (
            disputeData.periodCollateralDisputed["period"] - disputeData.periodCollateralDisputed["prevPeriod"]
          ).toLocaleString()
        }
      };

      console.table(allDisputeStatsTable);

      console.log(italic("- Dispute resolution prices"));
      console.table(disputeData.allResolvedDisputes);
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

  _getTokenHolderCount = async () => {
    try {
      // Rate limiting for free tier ("freekey"):
      // - Requests are limited to 5 per second, 50/min, 200/hour, 2000/24hours, 3000/week.
      const ethplorerTokenInfoUrl = `https://api.ethplorer.io/getTokenInfo/${this.syntheticContract.address}?apiKey=freekey`;
      const response = await fetch(ethplorerTokenInfoUrl);
      const json = await response.json();
      return Number(json.holdersCount);
    } catch (err) {
      console.error(err);
      return -1;
    }
  };

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
