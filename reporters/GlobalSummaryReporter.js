const { createFormatFunction } = require("../common/FormattingUtils");
const chalkPipe = require("chalk-pipe");
const bold = chalkPipe("bold");
const italic = chalkPipe("italic");
const dim = chalkPipe("dim");

class GlobalSummaryReporter {
  constructor(expiringMultiPartyEventClient, priceFeed) {
    this.empEventClient = expiringMultiPartyEventClient;
    this.priceFeed = priceFeed;

    this.web3 = this.empEventClient.web3;

    this.empContract = this.empEventClient.emp;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);

    this.collateralSymbol = "DAI";
    this.syntheticSymbol = "ETHBTC";
  }

  update = async () => {
    await this.empEventClient.update();
    await this.priceFeed.update();
  };

  generateSummaryStatsTable = async () => {
    await this.update();

    // 1. Sponsor stats table
    console.group();
    console.log(bold("Sponsor summary stats"));
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

    let allSponsorStatsTable = {};

    // - Lifetime # of unique sponsors.
    const uniqueSponsors = {};
    for (let event of newSponsorEvents) {
      uniqueSponsors[event.sponsor] = true;
    }
    allSponsorStatsTable["# of unique sponsors"] = Object.keys(uniqueSponsors).length;

    // - Cumulative collateral deposited into contract: Deposits, Creates
    let collateralDeposited = toBN("0");
    for (let event of depositEvents) {
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
    }
    for (let event of createEvents) {
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
    }
    allSponsorStatsTable["collateral deposited"] = this.formatDecimalString(collateralDeposited);

    // - Cumulative collateral withdrawn from contract: Withdraws, Redeems, SettleExpired's, WithdrawLiquidations
    let collateralWithdrawn = toBN("0");
    for (let event of withdrawEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
    }
    for (let event of redeemEvents) {
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
    }
    allSponsorStatsTable["collateral withdrawn"] = this.formatDecimalString(collateralWithdrawn);

    // - Net collateral deposited into contract:
    let netCollateralWithdrawn = collateralDeposited.sub(collateralWithdrawn);
    allSponsorStatsTable["net collateral deposited"] = this.formatDecimalString(netCollateralWithdrawn);

    // - Tokens minted: Creates
    let tokensMinted = toBN("0");
    for (let event of createEvents) {
      tokensMinted = tokensMinted.add(toBN(event.tokenAmount));
    }
    allSponsorStatsTable["tokens minted"] = this.formatDecimalString(tokensMinted);

    // - Tokens repaid: Redeems, SettleExpired's
    let tokensRepaid = toBN("0");
    for (let event of redeemEvents) {
      tokensRepaid = tokensRepaid.add(toBN(event.tokenAmount));
    }
    allSponsorStatsTable["tokens repaid"] = this.formatDecimalString(tokensRepaid);

    // - Net tokens minted:
    let netTokensMinted = tokensMinted.sub(tokensRepaid);
    allSponsorStatsTable["net tokens minted"] = this.formatDecimalString(netTokensMinted);

    // - GCR (collateral / tokens outstanding):
    let currentCollateral = toBN((await this.empContract.methods.totalPositionCollateral().call()).toString());
    let currentTokensOutstanding = toBN((await this.empContract.methods.totalTokensOutstanding().call()).toString());
    let currentGCR = currentCollateral.mul(toBN(toWei("1"))).div(currentTokensOutstanding);
    allSponsorStatsTable["GCR - collateral / # tokens outstanding"] = this.formatDecimalString(currentGCR);

    // - GCR (collateral / TRV):
    let priceEstimate = toBN(this.priceFeed.getCurrentPrice());
    let currentTRV = currentTokensOutstanding.mul(priceEstimate).div(toBN(toWei("1")));
    let currentGCRUsingTRV = currentCollateral.mul(toBN(toWei("1"))).div(currentTRV);
    allSponsorStatsTable["GCR - collateral / TRV"] = this.formatDecimalString(currentGCRUsingTRV);

    console.table(allSponsorStatsTable);
  };
}
module.exports = {
  GlobalSummaryReporter
};
