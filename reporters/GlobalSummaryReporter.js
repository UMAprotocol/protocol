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
    const { toBN } = this.web3.utils;
    await this.update();

    // 1. Sponsor stats table:
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

    // - Cumulative collateral deposited.
    let collateralDeposited = toBN("0");
    for (let event of depositEvents) {
      // Add collateral from deposits.
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
    }
    for (let event of createEvents) {
      // Add collateral from creates.
      collateralDeposited = collateralDeposited.add(toBN(event.collateralAmount));
    }
    allSponsorStatsTable["collateral deposited (cumulative)"] = this.formatDecimalString(collateralDeposited);

    // - Cumulative collateral withdrawn
    let collateralWithdrawn = toBN("0");
    for (let event of withdrawEvents) {
      // Add collateral from withdrawals.
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
    }
    for (let event of redeemEvents) {
      // Add collateral from redemptions.
      collateralWithdrawn = collateralWithdrawn.add(toBN(event.collateralAmount));
    }
    allSponsorStatsTable["collateral withdrawn (cumulative)"] = this.formatDecimalString(collateralWithdrawn);

    console.table(allSponsorStatsTable);
  };
}
module.exports = {
  GlobalSummaryReporter
};
