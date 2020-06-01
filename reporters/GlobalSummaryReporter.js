const { createFormatFunction } = require("../common/FormattingUtils");
const { averageBlockTimeSeconds } = require("../common/TimeUtils");
const chalkPipe = require("chalk-pipe");
const bold = chalkPipe("bold");
const italic = chalkPipe("italic");
const dim = chalkPipe("dim");

class GlobalSummaryReporter {
  constructor(expiringMultiPartyClient, expiringMultiPartyEventClient, referencePriceFeed, uniswapPriceFeed, oracle) {
    this.empClient = expiringMultiPartyClient;
    this.empEventClient = expiringMultiPartyEventClient;
    this.referencePriceFeed = referencePriceFeed;
    this.uniswapPriceFeed = uniswapPriceFeed;

    this.web3 = this.empEventClient.web3;

    this.empContract = this.empEventClient.emp;
    this.oracleContract = oracle;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);

    this.collateralSymbol = "DAI";
    this.syntheticSymbol = "ETHBTC";
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
    this.blockNumberOneDayAgo = this.currentBlockNumber - (await this._getLookbackTimeInBlocks(24 * 60 * 60));

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
    console.log(italic("- Tokens repaid counts synthetic tokens burned via redemptions and expiry settlements"));
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
    let collateralDepositedDaily = toBN("0");
    for (let event of this.depositEvents) {
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        collateralDepositedDaily = collateralDepositedDaily.add(toBN(event.collateralAmount));
      }
    }
    for (let event of this.createEvents) {
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        collateralDepositedDaily = collateralDepositedDaily.add(toBN(event.collateralAmount));
      }
    }
    allSponsorStatsTable["collateral deposited"] = {
      cumulative: this.formatDecimalString(collateralDeposited),
      "24H": this.formatDecimalString(collateralDepositedDaily)
    };

    // - Cumulative collateral withdrawn from contract: Withdraws, Redeems, SettleExpired's, WithdrawLiquidations, RegularFees, FinalFees
    let collateralWithdrawn = toBN("0");
    let collateralWithdrawnDaily = toBN("0");
    for (let event of this.withdrawEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.collateralAmount));
      }
    }
    for (let event of this.redeemEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.collateralAmount));
      }
    }
    for (let event of this.expirySettlementEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralReturned));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.collateralReturned));
      }
    }
    for (let event of this.liquidationRewardEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.withdrawalAmount));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.withdrawalAmount));
      }
    }
    for (let event of this.regularFeeEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.regularFee)).add(toBN(event.lateFee));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.regularFee)).add(toBN(event.lateFee));
      }
    }
    for (let event of this.finalFeeEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.amount));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.amount));
      }
    }

    allSponsorStatsTable["collateral withdrawn"] = {
      cumulative: this.formatDecimalString(collateralWithdrawn),
      "24H": this.formatDecimalString(collateralWithdrawnDaily)
    };

    // - Net collateral deposited into contract:
    let netCollateralWithdrawn = collateralDeposited.sub(collateralWithdrawn);
    let netCollateralWithdrawnDaily = collateralDepositedDaily.sub(collateralWithdrawnDaily);
    allSponsorStatsTable["net collateral deposited"] = {
      cumulative: this.formatDecimalString(netCollateralWithdrawn),
      "24H": this.formatDecimalString(netCollateralWithdrawnDaily)
    };

    // - Tokens minted: Creates
    let tokensMinted = toBN("0");
    let tokensMintedDaily = toBN("0");
    for (let event of this.createEvents) {
      tokensMinted = tokensMinted.add(toBN(event.tokenAmount));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        tokensMintedDaily = tokensMintedDaily.add(toBN(event.collateralAmount));
      }
    }
    allSponsorStatsTable["tokens minted"] = {
      cumulative: this.formatDecimalString(tokensMinted),
      "24H": this.formatDecimalString(tokensMintedDaily)
    };

    // - Tokens repaid: Redeems, SettleExpired's
    let tokensRepaid = toBN("0");
    let tokensRepaidDaily = toBN("0");
    for (let event of this.redeemEvents) {
      tokensRepaid = tokensRepaid.add(toBN(event.tokenAmount));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        tokensRepaidDaily = tokensRepaidDaily.add(toBN(event.collateralAmount));
      }
    }
    for (let event of this.expirySettlementEvents) {
      tokensRepaid = tokensRepaid.add(toBN(event.tokensBurned));
      if (event.blockNumber >= this.blockNumberOneDayAgo) {
        tokensRepaidDaily = tokensRepaidDaily.add(toBN(event.tokensBurned));
      }
    }
    allSponsorStatsTable["tokens repaid"] = {
      cumulative: this.formatDecimalString(tokensRepaid),
      "24H": this.formatDecimalString(tokensRepaidDaily)
    };

    // - Net tokens minted:
    let netTokensMinted = tokensMinted.sub(tokensRepaid);
    let netTokensMintedDaily = tokensMintedDaily.sub(tokensRepaidDaily);
    allSponsorStatsTable["net tokens minted"] = {
      cumulative: this.formatDecimalString(netTokensMinted),
      "24H": this.formatDecimalString(netTokensMintedDaily)
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
    let uniqueLiquidationsDaily = {};
    let tokensLiquidated = toBN("0");
    let tokensLiquidatedDaily = toBN("0");
    let collateralLiquidated = toBN("0");
    let collateralLiquidatedDaily = toBN("0");

    if (this.liquidationEvents.length === 0) {
      console.log(dim("\tNo liquidation events found for this EMP."));
    } else {
      for (let event of this.liquidationEvents) {
        tokensLiquidated = tokensLiquidated.add(toBN(event.tokensOutstanding));
        // We count "lockedCollateral" instead of "liquidatedCollateral" because this is the amount of the collateral that the liquidator is elegible to draw from
        // the contract.
        collateralLiquidated = collateralLiquidated.add(toBN(event.lockedCollateral));
        uniqueLiquidations[event.sponsor] = true;
        if (event.blockNumber >= this.blockNumberOneDayAgo) {
          tokensLiquidatedDaily = tokensLiquidatedDaily.add(toBN(event.tokensOutstanding));
          collateralLiquidatedDaily = collateralLiquidatedDaily.add(toBN(event.lockedCollateral));
          uniqueLiquidationsDaily[event.sponsor] = true;
        }
      }
      allLiquidationStatsTable = {
        ["# of liquidations"]: {
          cumulative: Object.keys(uniqueLiquidations).length,
          "24H": Object.keys(uniqueLiquidationsDaily).length
        },
        ["tokens liquidated"]: {
          cumulative: this.formatDecimalString(tokensLiquidated),
          "24H": this.formatDecimalString(tokensLiquidatedDaily)
        },
        ["collateral liquidated"]: {
          cumulative: this.formatDecimalString(collateralLiquidated),
          "24H": this.formatDecimalString(collateralLiquidatedDaily)
        }
      };

      console.table(allLiquidationStatsTable);
    }
  };

  _generateDisputeStats = async () => {
    const { toBN } = this.web3.utils;

    let allDisputeStatsTable = {};

    let uniqueDisputes = {};
    let uniqueDisputesDaily = {};
    let tokensDisputed = toBN("0");
    let tokensDisputedDaily = toBN("0");
    let collateralDisputed = toBN("0");
    let collateralDisputedDaily = toBN("0");
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
        if (event.blockNumber >= this.blockNumberOneDayAgo) {
          tokensDisputedDaily = tokensDisputedDaily.add(toBN(liquidationData.tokensOutstanding));
          collateralDisputedDaily = collateralDisputedDaily.add(toBN(liquidationData.lockedCollateral));
          uniqueDisputesDaily[event.sponsor] = true;
        }

        // TODO: Get resolved prices for disputed liquidation. The main issue right now is there is no easy way to get the `liquidationTime` for a disputed
        // liquidation if the liquidation data has been deleted on-chain.
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
          "24H": Object.keys(uniqueDisputesDaily).length
        },
        ["tokens disputed"]: {
          cumulative: this.formatDecimalString(tokensDisputed),
          "24H": this.formatDecimalString(tokensDisputedDaily)
        },
        ["collateral disputed"]: {
          cumulative: this.formatDecimalString(collateralDisputed),
          "24H": this.formatDecimalString(collateralDisputedDaily)
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

    let regularFeesPaid = {};
    let regularFeesPaidDaily = {};
    let lateFeesPaid = {};
    let lateFeesPaidDaily = {};
    let finalFeesPaid = {};
    let finalFeesPaidDaily = {};

    // for (let collateralSymbol of availableCollateralSymbols) {
    // TODO: We currently cannot differentiate between fees denominated in different collateral currencies. For now we will
    // assume that all fees are paid in the hard-coded collateral currency.
    regularFeesPaid[this.collateralSymbol] = toBN("0");
    regularFeesPaidDaily[this.collateralSymbol] = toBN("0");
    lateFeesPaid[this.collateralSymbol] = toBN("0");
    lateFeesPaidDaily[this.collateralSymbol] = toBN("0");
    finalFeesPaid[this.collateralSymbol] = toBN("0");
    finalFeesPaidDaily[this.collateralSymbol] = toBN("0");
    // }

    if (this.regularFeeEvents.length === 0) {
      console.log(dim("\tNo regular fee events found for this EMP."));
    } else {
      for (let event of this.regularFeeEvents) {
        regularFeesPaid[this.collateralSymbol] = regularFeesPaid[this.collateralSymbol].add(toBN(event.regularFee));
        lateFeesPaid[this.collateralSymbol] = lateFeesPaid[this.collateralSymbol].add(toBN(event.lateFee));
        if (event.blockNumber >= this.blockNumberOneDayAgo) {
          regularFeesPaidDaily[this.collateralSymbol] = regularFeesPaidDaily[this.collateralSymbol].add(
            toBN(event.regularFee)
          );
          lateFeesPaidDaily[this.collateralSymbol] = lateFeesPaidDaily[this.collateralSymbol].add(toBN(event.lateFee));
        }
      }
    }

    if (this.finalFeeEvents.length === 0) {
      console.log(dim("\tNo final fee events found for this EMP."));
    } else {
      for (let event of this.finalFeeEvents) {
        finalFeesPaid[this.collateralSymbol] = finalFeesPaid[this.collateralSymbol].add(toBN(event.amount));
        if (event.blockNumber >= this.blockNumberOneDayAgo) {
          finalFeesPaidDaily[this.collateralSymbol] = finalFeesPaidDaily[this.collateralSymbol].add(toBN(event.amount));
        }
      }
    }

    if (Object.keys(allDvmStatsTable).length !== 0) {
      allDvmStatsTable = {
        ["final fees paid to store"]: {
          cumulative: this.formatDecimalString(finalFeesPaid),
          "24H": this.formatDecimalString(finalFeesPaidDaily)
        },
        ["ongoing regular fees paid to store"]: {
          cumulative: this.formatDecimalString(regularFeesPaid),
          "24H": this.formatDecimalString(regularFeesPaidDaily)
        },
        ["ongoing late fees paid to store"]: {
          cumulative: this.formatDecimalString(lateFeesPaid),
          "24H": this.formatDecimalString(lateFeesPaidDaily)
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
