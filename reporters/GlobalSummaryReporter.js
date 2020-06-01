const { createFormatFunction } = require("../common/FormattingUtils");
const { averageBlockTimeSeconds } = require("../common/TimeUtils");
const chalkPipe = require("chalk-pipe");
const bold = chalkPipe("bold");
const italic = chalkPipe("italic");
const dim = chalkPipe("dim");

class GlobalSummaryReporter {
  constructor(expiringMultiPartyClient, expiringMultiPartyEventClient, priceFeed) {
    this.empClient = expiringMultiPartyClient;
    this.empEventClient = expiringMultiPartyEventClient;
    this.priceFeed = priceFeed;

    this.web3 = this.empEventClient.web3;

    this.empContract = this.empEventClient.emp;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);

    this.collateralSymbol = "DAI";
    this.syntheticSymbol = "ETHBTC";
  }

  update = async () => {
    await this.empClient.update();
    await this.empEventClient.update();
    await this.priceFeed.update();
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

    await this._generateSponsorStats();
    console.groupEnd();

    // 2. Tokens stats table
    // TODO

    // 3. Liquidation stats table
    // TODO

    // 4. Dispute stats table
    // TODO

    // 5. DVM stats table
    // TODO
  };

  _generateSponsorStats = async () => {
    const { toBN, toWei } = this.web3.utils;

    const newSponsorEvents = this.empEventClient.getAllNewSponsorEvents();
    const depositEvents = this.empEventClient.getAllDepositEvents();
    const createEvents = this.empEventClient.getAllCreateEvents();
    const withdrawEvents = this.empEventClient.getAllWithdrawEvents();
    const redeemEvents = this.empEventClient.getAllRedeemEvents();
    const liquidationRewardEvents = this.empEventClient.getAllLiquidationWithdrawnEvents();
    const expirySettlementEvents = this.empEventClient.getAllSettleExpiredPositionEvents();
    const regularFeeEvents = this.empEventClient.getAllRegularFeeEvents();
    const finalFeeEvents = this.empEventClient.getAllFinalFeeEvents();

    const currentBlockNumber = Number(await this.web3.eth.getBlockNumber());
    const blockNumberOneDayAgo = currentBlockNumber - (await this._getLookbackTimeInBlocks(24 * 60 * 60));

    let allSponsorStatsTable = {};

    // - Lifetime # of unique sponsors.
    const uniqueSponsors = {};
    const currentUniqueSponsors = this.empClient.getAllPositions();
    for (let event of newSponsorEvents) {
      uniqueSponsors[event.sponsor] = true;
    }
    allSponsorStatsTable["# of unique sponsors"] = {
      cumulative: Object.keys(uniqueSponsors).length,
      current: Object.keys(currentUniqueSponsors).length
    };

    // - Cumulative collateral deposited into contract: Deposits, Creates
    let collateralDeposited = toBN("0");
    let collateralDepositedDaily = toBN("0");
    for (let event of depositEvents) {
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
      if (event.blockNumber >= blockNumberOneDayAgo) {
        collateralDepositedDaily = collateralDepositedDaily.add(toBN(event.collateralAmount));
      }
    }
    for (let event of createEvents) {
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
      if (event.blockNumber >= blockNumberOneDayAgo) {
        collateralDepositedDaily = collateralDepositedDaily.add(toBN(event.collateralAmount));
      }
    }
    allSponsorStatsTable["collateral deposited"] = {
      cumulative: this.formatDecimalString(collateralDeposited),
      "24H": this.formatDecimalString(collateralDepositedDaily),
      current: this.formatDecimalString(await this.empContract.methods.totalPositionCollateral().call())
    };

    // - Cumulative collateral withdrawn from contract: Withdraws, Redeems, SettleExpired's, WithdrawLiquidations, RegularFees, FinalFees
    let collateralWithdrawn = toBN("0");
    let collateralWithdrawnDaily = toBN("0");
    for (let event of withdrawEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
      if (event.blockNumber >= blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.collateralAmount));
      }
    }
    for (let event of redeemEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
      if (event.blockNumber >= blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.collateralAmount));
      }
    }
    for (let event of expirySettlementEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralReturned));
      if (event.blockNumber >= blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.collateralReturned));
      }
    }
    for (let event of liquidationRewardEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.withdrawalAmount));
      if (event.blockNumber >= blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.withdrawalAmount));
      }
    }
    for (let event of regularFeeEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.regularFee)).add(toBN(event.lateFee));
      if (event.blockNumber >= blockNumberOneDayAgo) {
        collateralWithdrawnDaily = collateralWithdrawnDaily.add(toBN(event.regularFee)).add(toBN(event.lateFee));
      }
    }
    for (let event of finalFeeEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.amount));
      if (event.blockNumber >= blockNumberOneDayAgo) {
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
    for (let event of createEvents) {
      tokensMinted = tokensMinted.add(toBN(event.tokenAmount));
      if (event.blockNumber >= blockNumberOneDayAgo) {
        tokensMintedDaily = tokensMintedDaily.add(toBN(event.collateralAmount));
      }
    }
    allSponsorStatsTable["tokens minted"] = {
      cumulative: this.formatDecimalString(tokensMinted),
      "24H": this.formatDecimalString(tokensMintedDaily),
      current: this.formatDecimalString(await this.empContract.methods.totalTokensOutstanding().call())
    };

    // - Tokens repaid: Redeems, SettleExpired's
    let tokensRepaid = toBN("0");
    let tokensRepaidDaily = toBN("0");
    for (let event of redeemEvents) {
      tokensRepaid = tokensRepaid.add(toBN(event.tokenAmount));
      if (event.blockNumber >= blockNumberOneDayAgo) {
        tokensRepaidDaily = tokensRepaidDaily.add(toBN(event.collateralAmount));
      }
    }
    for (let event of expirySettlementEvents) {
      tokensRepaid = tokensRepaid.add(toBN(event.tokensBurned));
      if (event.blockNumber >= blockNumberOneDayAgo) {
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
    let currentCollateral = toBN((await this.empContract.methods.totalPositionCollateral().call()).toString());
    let currentTokensOutstanding = toBN((await this.empContract.methods.totalTokensOutstanding().call()).toString());
    let currentGCR = currentCollateral.mul(toBN(toWei("1"))).div(currentTokensOutstanding);
    allSponsorStatsTable["GCR - collateral / # tokens outstanding"] = {
      current: this.formatDecimalString(currentGCR)
    };

    // - GCR (collateral / TRV):
    let priceEstimate = toBN(this.priceFeed.getCurrentPrice());
    let currentTRV = currentTokensOutstanding.mul(priceEstimate).div(toBN(toWei("1")));
    let currentGCRUsingTRV = currentCollateral.mul(toBN(toWei("1"))).div(currentTRV);
    allSponsorStatsTable["GCR - collateral / TRV"] = {
      current: this.formatDecimalString(currentGCRUsingTRV)
    };
    allSponsorStatsTable["price from pricefeed"] = {
      current: this.formatDecimalString(priceEstimate)
    };

    console.table(allSponsorStatsTable);
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
