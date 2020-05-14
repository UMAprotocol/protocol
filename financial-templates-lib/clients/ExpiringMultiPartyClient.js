const { LiquidationStatesEnum } = require("../../common/Enums");

// A thick client for getting information about an ExpiringMultiParty. Used to get sponsor information, outstanding
// positions, undisputed Liquidations, expired liquidations, disputed liquidations. Client is used by both the
//  liquidator and dispute bots.
class ExpiringMultiPartyClient {
  constructor(logger, empAbi, web3, empAddress) {
    this.logger = logger;
    this.web3 = web3;

    // EMP contract
    this.emp = new web3.eth.Contract(empAbi, empAddress);
    this.empAddress = empAddress;

    // EMP Data structures & values to enable synchronous returns of the emp state seen by the client.
    this.sponsorAddresses = [];
    this.positions = [];
    this.undisputedLiquidations = [];
    this.expiredLiquidations = [];
    this.disputedLiquidations = [];
    this.collateralRequirement = null;

    // Store the last on-chain time the clients were updated to inform price request information.
    this.lastUpdateTimestamp = 0;
  }

  // Returns an array of { sponsor, numTokens, amountCollateral } for each open position.
  getAllPositions = () => this.positions;

  // Returns an array of { sponsor, numTokens, amountCollateral } for each position that is undercollateralized
  // according to the provided `tokenRedemptionValue`. Note that the `amountCollateral` fed into
  // `_isUnderCollateralized` is taken as the positions `amountCollateral` minus any `withdrawalRequestAmount`. As a
  // result this function will return positions that are undercollateralized due to too little collateral or a withdrawal
  // that, if passed, would make the position undercollateralized.
  getUnderCollateralizedPositions = tokenRedemptionValue => {
    return this.positions.filter(position => {
      const collateralNetWithdrawal = this.web3.utils
        .toBN(position.amountCollateral)
        .sub(this.web3.utils.toBN(position.withdrawalRequestAmount))
        .toString();
      return this._isUnderCollateralized(position.numTokens, collateralNetWithdrawal, tokenRedemptionValue);
    });
  };

  // Returns an array of { sponsor, id, numTokens, amountCollateral, liquidationTime } for each undisputed liquidation.
  // To check whether a liquidation can be disputed, call `isDisputable` with the token redemption value at
  // `liquidationTime`.
  getUndisputedLiquidations = () => this.undisputedLiquidations;

  // Returns an array of { sponsor, id, numTokens, amountCollateral, liquidationTime } for each undisputed liquidation.
  // Liquidators can withdraw rewards from these expired liquidations.
  getExpiredLiquidations = () => this.expiredLiquidations;

  // Returns an array of { sponsor, id, numTokens, amountCollateral, liquidationTime } for each undisputed liquidation.
  // Liquidators can withdraw rewards from these disputed liquidations.
  getDisputedLiquidations = () => this.disputedLiquidations;

  // Whether the given undisputed `liquidation` (`getUndisputedLiquidations` returns an array of `liquidation`s) is disputable.
  // `tokenRedemptionValue` should be the redemption value at `liquidation.time`.
  isDisputable = (liquidation, tokenRedemptionValue) => {
    return !this._isUnderCollateralized(liquidation.numTokens, liquidation.amountCollateral, tokenRedemptionValue);
  };

  // Returns an array of sponsor addresses.
  getAllSponsors = () => this.sponsorAddresses;

  // Returns the last update timestamp.
  getLastUpdateTime = () => this.lastUpdateTimestamp;

  update = async () => {
    this.collateralRequirement = this.web3.utils.toBN(
      (await this.emp.methods.collateralRequirement().call()).toString()
    );
    this.liquidationLiveness = Number(await this.emp.methods.liquidationLiveness().call());

    const events = await this.emp.getPastEvents("NewSponsor", { fromBlock: 0 });
    this.sponsorAddresses = [...new Set(events.map(e => e.returnValues.sponsor))];

    // Fetch information about each sponsor.
    const positions = await Promise.all(
      this.sponsorAddresses.map(address => this.emp.methods.positions(address).call())
    );
    const collateral = await Promise.all(
      this.sponsorAddresses.map(address => this.emp.methods.getCollateral(address).call())
    );

    const undisputedLiquidations = [];
    const expiredLiquidations = [];
    const disputedLiquidations = [];
    for (const address of this.sponsorAddresses) {
      const liquidations = await this.emp.methods.getLiquidations(address).call();
      for (const [id, liquidation] of liquidations.entries()) {
        // Liquidations that have had all of their rewards withdrawn will still show up here but have their properties set to default values.
        // We can skip them.
        if (liquidation.state === LiquidationStatesEnum.UNINITIALIZED) {
          continue;
        }

        // Construct Liquidation data to save
        const liquidationData = {
          sponsor: liquidation.sponsor,
          id: id.toString(),
          numTokens: liquidation.tokensOutstanding.toString(),
          amountCollateral: liquidation.liquidatedCollateral.toString(),
          liquidationTime: liquidation.liquidationTime,
          liquidator: liquidation.liquidator,
          disputer: liquidation.disputer
        };

        // Get all undisputed liquidations.
        if (this._isLiquidationPreDispute(liquidation)) {
          // Determine whether liquidation has expired.
          if (!(await this._isExpired(liquidation))) {
            undisputedLiquidations.push(liquidationData);
          } else {
            expiredLiquidations.push(liquidationData);
          }
        } else {
          disputedLiquidations.push(liquidationData);
        }
      }
    }
    this.undisputedLiquidations = undisputedLiquidations;
    this.expiredLiquidations = expiredLiquidations;
    this.disputedLiquidations = disputedLiquidations;

    this.positions = this.sponsorAddresses.reduce(
      (acc, address, i) =>
        // Filter out empty positions.
        positions[i].rawCollateral.toString() === "0"
          ? acc
          : /* eslint-disable indent */
            acc.concat([
              {
                sponsor: address,
                withdrawalRequestPassTimestamp: positions[i].withdrawalRequestPassTimestamp,
                withdrawalRequestAmount: positions[i].withdrawalRequestAmount.toString(),
                numTokens: positions[i].tokensOutstanding.toString(),
                amountCollateral: collateral[i].toString(),
                hasPendingWithdrawal: positions[i].withdrawalRequestPassTimestamp > 0
              }
            ]),
      []
    );
    this.lastUpdateTimestamp = await this.emp.methods.getCurrentTime().call();
    this.logger.debug({
      at: "ExpiringMultiPartyClient",
      message: "Expiring multi party state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  };
  _isUnderCollateralized = (numTokens, amountCollateral, trv) => {
    const { toBN, toWei } = this.web3.utils;
    const fixedPointAdjustment = toBN(toWei("1"));
    // The formula for an undercollateralized position is:
    // (numTokens * trv) * collateralRequirement > amountCollateral.
    // Need to adjust by 10**18 twice because each value is represented as a fixed point scaled up by 10**18.
    return toBN(numTokens)
      .mul(toBN(trv))
      .mul(this.collateralRequirement)
      .gt(
        toBN(amountCollateral)
          .mul(fixedPointAdjustment)
          .mul(fixedPointAdjustment)
      );
  };

  _isExpired = async liquidation => {
    const currentTime = await this.emp.methods.getCurrentTime().call();
    return Number(liquidation.liquidationTime) + this.liquidationLiveness <= currentTime;
  };

  _isLiquidationPreDispute = liquidation => {
    return liquidation.state === LiquidationStatesEnum.PRE_DISPUTE;
  };
}

module.exports = {
  ExpiringMultiPartyClient
};
