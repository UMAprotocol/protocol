const { createFormatFunction } = require("../common/FormattingUtils");
const { averageBlockTimeSeconds } = require("../common/TimeUtils");
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
    periodLengthSeconds
  ) {
    this.empClient = expiringMultiPartyClient;
    this.empEventClient = expiringMultiPartyEventClient;
    this.referencePriceFeed = referencePriceFeed;
    this.uniswapPriceFeed = uniswapPriceFeed;

    this.periodLengthSeconds = periodLengthSeconds;

    this.web3 = this.empEventClient.web3;

    this.empContract = this.empEventClient.emp;
    this.oracleContract = oracle;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);
  }

  update = async () => {
    const { toBN } = this.web3.utils;

    await this.empClient.update();
    await this.empEventClient.update();
    await this.referencePriceFeed.update();
    await this.uniswapPriceFeed.update();

    // Events accessible by all methods.
    this.newSponsorEvents = this.empEventClient.getAllNewSponsorEvents();
    this.depositEvents = this.empEventClient.getAllDepositEvents();
    this.createEvents = this.empEventClient.getAllCreateEvents();
    this.withdrawEvents = this.empEventClient.getAllWithdrawEvents();
    this.redeemEvents = this.empEventClient.getAllRedeemEvents();
    this.liquidationRewardEvents = this.empEventClient.getAllLiquidationWithdrawnEvents();
    this.expirySettlementEvents = this.empEventClient.getAllSettleExpiredPositionEvents();
    this.regularFeeEvents = this.empEventClient.getAllRegularFeeEvents();
    this.finalFeeEvents = this.empEventClient.getAllFinalFeeEvents();
    this.liquidationEvents = this.empEventClient.getAllLiquidationEvents();
    this.disputeEvents = this.empEventClient.getAllDisputeEvents();
    this.disputeSettledEvents = this.empEventClient.getAllDisputeSettlementEvents();

    // Block number stats.
    this.currentBlockNumber = Number(await this.web3.eth.getBlockNumber());
    this.startBlockNumberForPeriod =
      this.currentBlockNumber - (await this._getLookbackTimeInBlocks(this.periodLengthSeconds));
    this.periodLabelInHours = `${Math.round(this.periodLengthSeconds / (60 * 60))}H`;

    // EMP Contract stats.
    this.totalPositionCollateral = await this.empContract.methods.totalPositionCollateral().call();
    this.totalTokensOutstanding = await this.empContract.methods.totalTokensOutstanding().call();

    // Pricefeed stats.
    this.priceEstimate = toBN(this.referencePriceFeed.getCurrentPrice());
  };

  generateSummaryStatsTable = async () => {
    await this.update();

    // 1. Sponsor stats table
    console.group();
    console.log(bold("Sponsor summary stats"));
    console.log(italic("- Collateral deposited counts collateral transferred into contract from creates and deposits"));
    console.log(
      italic(
        "- Collateral withdrawn counts collateral transferred out of contract from withdrawals, redemptions, expiry settlements, liquidation reward withdrawals, and fees paid"
      )
    );
    console.log(italic("- Tokens minted counts synthetic tokens created"));
    console.log(
      italic(
        "- Tokens burned counts synthetic tokens burned via redemptions, expiry settlements, and liquidations created"
      )
    );
    console.log(italic("- Reference price should be sourced from liquid exchanges (i.e. Coinbase Pro)"));
    await this._generateSponsorStats();
    console.groupEnd();

    // 2. Tokens stats table
    console.group();
    console.log(bold("Token summary stats"));
    console.log(italic("- Token price is sourced from exchange where synthetic token is traded (i.e. Uniswap)"));
    console.log(
      italic(
        "- Uniswap TWAP price window can be modified using the 'twapLength' property in the UNISWAP_PRICE_FEED_CONFIG"
      )
    );
    await this._generateTokenStats();
    console.groupEnd();

    // 3. Liquidation stats table
    console.group();
    console.log(bold("Liquidation summary stats"));
    console.log(italic("- Unique liquidations count # of unique sponsors that have been liquidated"));
    console.log(italic("- Collateral & tokens liquidated counts aggregate amounts from all partial liquidations"));
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
  };

  _generateSponsorStats = async () => {
    const { toBN, toWei } = this.web3.utils;

    let allSponsorStatsTable = {};

    if (this.newSponsorEvents.length === 0) {
      console.log(dim("\tNo positions have been created for this EMP."));
      return;
    }

    // - Lifetime # of unique sponsors.
    const uniqueSponsors = {};
    const currentUniqueSponsors = this.empClient.getAllPositions();
    for (let event of this.newSponsorEvents) {
      uniqueSponsors[event.sponsor] = true;
    }
    allSponsorStatsTable["# of unique sponsors"] = {
      cumulative: Object.keys(uniqueSponsors).length,
      current: Object.keys(currentUniqueSponsors).length
    };

    // - Cumulative collateral deposited into contract: Deposits, Creates
    let collateralDeposited = toBN("0");
    let collateralDepositedPeriod = toBN("0");
    for (let event of this.depositEvents) {
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        collateralDepositedPeriod = collateralDepositedPeriod.add(toBN(event.collateralAmount));
      }
    }
    for (let event of this.createEvents) {
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        collateralDepositedPeriod = collateralDepositedPeriod.add(toBN(event.collateralAmount));
      }
    }
    allSponsorStatsTable["collateral deposited"] = {
      cumulative: this.formatDecimalString(collateralDeposited),
      [this.periodLabelInHours]: this.formatDecimalString(collateralDepositedPeriod)
    };

    // - Cumulative collateral withdrawn from contract: Withdraws, Redeems, SettleExpired's, WithdrawLiquidations, RegularFees, FinalFees
    let collateralWithdrawn = toBN("0");
    let collateralWithdrawnPeriod = toBN("0");
    for (let event of this.withdrawEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        collateralWithdrawnPeriod = collateralWithdrawnPeriod.add(toBN(event.collateralAmount));
      }
    }
    for (let event of this.redeemEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        collateralWithdrawnPeriod = collateralWithdrawnPeriod.add(toBN(event.collateralAmount));
      }
    }
    for (let event of this.expirySettlementEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralReturned));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        collateralWithdrawnPeriod = collateralWithdrawnPeriod.add(toBN(event.collateralReturned));
      }
    }
    for (let event of this.liquidationRewardEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.withdrawalAmount));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        collateralWithdrawnPeriod = collateralWithdrawnPeriod.add(toBN(event.withdrawalAmount));
      }
    }
    for (let event of this.regularFeeEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.regularFee)).add(toBN(event.lateFee));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        collateralWithdrawnPeriod = collateralWithdrawnPeriod.add(toBN(event.regularFee)).add(toBN(event.lateFee));
      }
    }
    for (let event of this.finalFeeEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.amount));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        collateralWithdrawnPeriod = collateralWithdrawnPeriod.add(toBN(event.amount));
      }
    }

    allSponsorStatsTable["collateral withdrawn"] = {
      cumulative: this.formatDecimalString(collateralWithdrawn),
      [this.periodLabelInHours]: this.formatDecimalString(collateralWithdrawnPeriod)
    };

    // - Net collateral deposited into contract:
    let netCollateralWithdrawn = collateralDeposited.sub(collateralWithdrawn);
    let netCollateralWithdrawnPeriod = collateralDepositedPeriod.sub(collateralWithdrawnPeriod);
    allSponsorStatsTable["net collateral deposited"] = {
      cumulative: this.formatDecimalString(netCollateralWithdrawn),
      [this.periodLabelInHours]: this.formatDecimalString(netCollateralWithdrawnPeriod)
    };

    // - Tokens minted: Creates
    let tokensMinted = toBN("0");
    let tokensMintedPeriod = toBN("0");
    for (let event of this.createEvents) {
      tokensMinted = tokensMinted.add(toBN(event.tokenAmount));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        tokensMintedPeriod = tokensMintedPeriod.add(toBN(event.tokenAmount));
      }
    }
    allSponsorStatsTable["tokens minted"] = {
      cumulative: this.formatDecimalString(tokensMinted),
      [this.periodLabelInHours]: this.formatDecimalString(tokensMintedPeriod)
    };

    // - Tokens burned: Redeems, SettleExpired's, Liquidations
    let tokensBurned = toBN("0");
    let tokensBurnedPeriod = toBN("0");
    for (let event of this.redeemEvents) {
      tokensBurned = tokensBurned.add(toBN(event.tokenAmount));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        tokensBurnedPeriod = tokensBurnedPeriod.add(toBN(event.tokenAmount));
      }
    }
    for (let event of this.expirySettlementEvents) {
      tokensBurned = tokensBurned.add(toBN(event.tokensBurned));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        tokensBurnedPeriod = tokensBurnedPeriod.add(toBN(event.tokensBurned));
      }
    }
    for (let event of this.liquidationEvents) {
      tokensBurned = tokensBurned.add(toBN(event.tokensOutstanding));
      if (event.blockNumber >= this.startBlockNumberForPeriod) {
        tokensBurnedPeriod = tokensBurnedPeriod.add(toBN(event.tokensOutstanding));
      }
    }
    allSponsorStatsTable["tokens burned"] = {
      cumulative: this.formatDecimalString(tokensBurned),
      [this.periodLabelInHours]: this.formatDecimalString(tokensBurnedPeriod)
    };

    // - Net tokens minted:
    let netTokensMinted = tokensMinted.sub(tokensBurned);
    let netTokensMintedPeriod = tokensMintedPeriod.sub(tokensBurnedPeriod);
    allSponsorStatsTable["net tokens minted"] = {
      cumulative: this.formatDecimalString(netTokensMinted),
      [this.periodLabelInHours]: this.formatDecimalString(netTokensMintedPeriod)
    };

    // - GCR (collateral / tokens outstanding):
    let currentCollateral = toBN(this.totalPositionCollateral.toString());
    let currentTokensOutstanding = toBN(this.totalTokensOutstanding.toString());
    let currentGCR = currentCollateral.mul(toBN(toWei("1"))).div(currentTokensOutstanding);
    allSponsorStatsTable["GCR - collateral / # tokens outstanding"] = {
      current: this.formatDecimalString(currentGCR)
    };

    // - GCR (collateral / TRV):
    let currentTRV = currentTokensOutstanding.mul(this.priceEstimate).div(toBN(toWei("1")));
    let currentGCRUsingTRV = currentCollateral.mul(toBN(toWei("1"))).div(currentTRV);
    allSponsorStatsTable["GCR - collateral / TRV"] = {
      current: this.formatDecimalString(currentGCRUsingTRV)
    };
    allSponsorStatsTable["price from reference pricefeed"] = {
      current: this.formatDecimalString(this.priceEstimate)
    };

    console.table(allSponsorStatsTable);
  };

  _generateTokenStats = async () => {
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

    // TODO:
    // - # token holders (current) (cumulative)
    // - # trades in uniswap (24H) (cumulative)
    // - volume of trades in uniswap in # of tokens (24H) (cumulative)

    console.table(allTokenStatsTable);
  };

  _generateLiquidationStats = async () => {
    const { toBN } = this.web3.utils;

    let allLiquidationStatsTable = {};

    let uniqueLiquidations = {};
    let uniqueLiquidationsPeriod = {};
    let tokensLiquidated = toBN("0");
    let tokensLiquidatedPeriod = toBN("0");
    let collateralLiquidated = toBN("0");
    let collateralLiquidatedPeriod = toBN("0");

    if (this.liquidationEvents.length === 0) {
      console.log(dim("\tNo liquidation events found for this EMP."));
    } else {
      for (let event of this.liquidationEvents) {
        tokensLiquidated = tokensLiquidated.add(toBN(event.tokensOutstanding));
        // We count "lockedCollateral" instead of "liquidatedCollateral" because this is the amount of the collateral that the liquidator is elegible to draw from
        // the contract.
        collateralLiquidated = collateralLiquidated.add(toBN(event.lockedCollateral));
        uniqueLiquidations[event.sponsor] = true;
        if (event.blockNumber >= this.startBlockNumberForPeriod) {
          tokensLiquidatedDaily = tokensLiquidatedDaily.add(toBN(event.tokensOutstanding));
          collateralLiquidatedDaily = collateralLiquidatedDaily.add(toBN(event.lockedCollateral));
          uniqueLiquidationsDaily[event.sponsor] = true;
        }
      }
      allLiquidationStatsTable = {
        ["# of liquidations"]: {
          cumulative: Object.keys(uniqueLiquidations).length,
          [this.periodLabelInHours]: Object.keys(uniqueLiquidationsPeriod).length
        },
        ["tokens liquidated"]: {
          cumulative: this.formatDecimalString(tokensLiquidated),
          [this.periodLabelInHours]: this.formatDecimalString(tokensLiquidatedPeriod)
        },
        ["collateral liquidated"]: {
          cumulative: this.formatDecimalString(collateralLiquidated),
          [this.periodLabelInHours]: this.formatDecimalString(collateralLiquidatedPeriod)
        }
      };

      console.table(allLiquidationStatsTable);
    }
  };

  _generateDisputeStats = async () => {
    const { toBN } = this.web3.utils;

    let allDisputeStatsTable = {};

    let uniqueDisputes = {};
    let uniqueDisputesPeriod = {};
    let tokensDisputed = toBN("0");
    let tokensDisputedPeriod = toBN("0");
    let collateralDisputed = toBN("0");
    let collateralDisputedPeriod = toBN("0");
    let disputesResolved = {};

    if (this.disputeEvents.length === 0) {
      console.log(dim("\tNo dispute events found for this EMP."));
    } else {
      for (let event of this.disputeEvents) {
        // Fetch disputed collateral & token amounts from corresponding liquidation event that with same ID and sponsor.
        const liquidationData = this.liquidationEvents.filter(
          e => e.liquidationId === event.liquidationId && e.sponsor === event.sponsor
        );
        tokensDisputed = tokensDisputed.add(toBN(liquidationData.tokensOutstanding));
        collateralDisputed = collateralDisputed.add(toBN(liquidationData.lockedCollateral));
        uniqueDisputes[event.sponsor] = true;
        if (event.blockNumber >= this.startBlockNumberForPeriod) {
          tokensDisputedDaily = tokensDisputedPeriod.add(toBN(liquidationData.tokensOutstanding));
          collateralDisputedDaily = collateralDisputedPeriod.add(toBN(liquidationData.lockedCollateral));
          uniqueDisputesPeriod[event.sponsor] = true;
        }

        // TODO: Get resolved prices for disputed liquidation. Use block # from event and use that block's timestamp as the liquidation time.
        try {
          const liquidationTimestamp = "TODO";
          const resolvedPrice = await this.oracle.getPrice(
            await this.empContract.methods.priceIdentifier().call(),
            liquidationTimestamp,
            {
              from: emp.address
            }
          );
          disputesResolved[
            `Liquidation ID ${event.liquidationId} for sponsor ${event.sponsor}`
          ] = this.formatDecimalString(resolvedPrice);
        } catch (err) {
          disputesResolved[`Liquidation ID ${event.liquidationId} for sponsor ${event.sponsor}`] = "unresolved";
        }
      }
      allDisputeStatsTable = {
        ["# of disputes"]: {
          cumulative: Object.keys(uniqueDisputes).length,
          [this.periodLabelInHours]: Object.keys(uniqueDisputesPeriod).length
        },
        ["tokens disputed"]: {
          cumulative: this.formatDecimalString(tokensDisputed),
          [this.periodLabelInHours]: this.formatDecimalString(tokensDisputedPeriod)
        },
        ["collateral disputed"]: {
          cumulative: this.formatDecimalString(collateralDisputed),
          [this.periodLabelInHours]: this.formatDecimalString(collateralDisputedPeriod)
        }
      };

      console.table(allDisputeStatsTable);

      console.group("Dispute resolution prices");
      console.table(disputesResolved);
      console.groupEnd();
    }
  };

  _generateDvmStats = async () => {
    const { toBN } = this.web3.utils;

    let allDvmStatsTable = {};

    let regularFeesPaid = toBN("0");
    let regularFeesPaidPeriod = toBN("0");
    let lateFeesPaid = toBN("0");
    let lateFeesPaidPeriod = toBN("0");
    let finalFeesPaid = toBN("0");
    let finalFeesPaidPeriod = toBN("0");

    if (this.regularFeeEvents.length === 0) {
      console.log(dim("\tNo regular fee events found for this EMP."));
    } else {
      for (let event of this.regularFeeEvents) {
        regularFeesPaid = regularFeesPaid.add(toBN(event.regularFee));
        lateFeesPaid = lateFeesPaid.add(toBN(event.lateFee));
        if (event.blockNumber >= this.startBlockNumberForPeriod) {
          regularFeesPaidPeriod = regularFeesPaidPeriod.add(toBN(event.regularFee));
          lateFeesPaidPeriod = lateFeesPaidPeriod.add(toBN(event.lateFee));
        }
      }
    }

    if (this.finalFeeEvents.length === 0) {
      console.log(dim("\tNo final fee events found for this EMP."));
    } else {
      for (let event of this.finalFeeEvents) {
        finalFeesPaid = finalFeesPaid.add(toBN(event.amount));
        if (event.blockNumber >= this.startBlockNumberForPeriod) {
          finalFeesPaidPeriod = finalFeesPaidPeriod.add(toBN(event.amount));
        }
      }
    }

    if (Object.keys(allDvmStatsTable).length !== 0) {
      allDvmStatsTable = {
        ["final fees paid to store"]: {
          cumulative: this.formatDecimalString(finalFeesPaid),
          [this.periodLabelInHours]: this.formatDecimalString(finalFeesPaidPeriod)
        },
        ["ongoing regular fees paid to store"]: {
          cumulative: this.formatDecimalString(regularFeesPaid),
          [this.periodLabelInHours]: this.formatDecimalString(regularFeesPaidPeriod)
        },
        ["ongoing late fees paid to store"]: {
          cumulative: this.formatDecimalString(lateFeesPaid),
          [this.periodLabelInHours]: this.formatDecimalString(lateFeesPaidPeriod)
        }
      };

      console.table(allDvmStatsTable);
    }
  };

  _getLookbackTimeInBlocks = async lookbackTimeInSeconds => {
    const blockTimeInSeconds = await averageBlockTimeSeconds();
    const blocksToLookBack = Math.ceil(lookbackTimeInSeconds / blockTimeInSeconds);
    return blocksToLookBack;
  };
}
module.exports = {
  GlobalSummaryReporter
};
