// A thick client for getting information about an ExpiringMultiParty. Used to get sponsor information, outstanding
// positions, undisputed Liquidations, expired liquidations, disputed liquidations.

const { LiquidationStatesEnum } = require("@umaprotocol/common");

class ExpiringMultiPartyClient {
  /**
   * @notice Constructs new ExpiringMultiPartyClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} empAbi Expiring Multi Party truffle ABI object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} empAddress Ethereum address of the EMP contract deployed on the current network.
   * @return None or throws an Error.
   */
  constructor(logger, empAbi, web3, empAddress) {
    this.logger = logger;
    this.web3 = web3;

    // EMP contract
    this.emp = new web3.eth.Contract(empAbi, empAddress);
    this.empAddress = empAddress;

    // EMP Data structures & values to enable synchronous returns of the emp state seen by the client.
    this.activeSponsors = [];
    this.positions = [];
    this.undisputedLiquidations = [];
    this.expiredLiquidations = [];
    this.disputedLiquidations = [];
    this.collateralRequirement = null;
    this.liquidationLiveness = null;

    // Store the last on-chain time the clients were updated to inform price request information.
    this.lastUpdateTimestamp = 0;

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
  }

  // Returns an array of { sponsor, numTokens, amountCollateral } for each open position.
  getAllPositions() {
    return this.positions;
  }

  // Returns an array of { sponsor, numTokens, amountCollateral } for each position that is undercollateralized
  // according to the provided `tokenRedemptionValue`. Note that the `amountCollateral` fed into
  // `_isUnderCollateralized` is taken as the positions `amountCollateral` minus any `withdrawalRequestAmount`. As a
  // result this function will return positions that are undercollateralized due to too little collateral or a withdrawal
  // that, if passed, would make the position undercollateralized.
  getUnderCollateralizedPositions(tokenRedemptionValue) {
    return this.positions.filter(position => {
      const collateralNetWithdrawal = this.toBN(position.amountCollateral)
        .sub(this.toBN(position.withdrawalRequestAmount))
        .toString();
      return this._isUnderCollateralized(position.numTokens, collateralNetWithdrawal, tokenRedemptionValue);
    });
  }

  // Returns an array of { sponsor, id, numTokens, amountCollateral, liquidationTime } for each undisputed liquidation.
  // To check whether a liquidation can be disputed, call `isDisputable` with the token redemption value at
  // `liquidationTime`.
  getUndisputedLiquidations() {
    return this.undisputedLiquidations;
  }

  // Returns an array of { sponsor, id, numTokens, amountCollateral, liquidationTime } for each undisputed liquidation.
  // Liquidators can withdraw rewards from these expired liquidations.
  getExpiredLiquidations() {
    return this.expiredLiquidations;
  }

  // Returns an array of { sponsor, id, numTokens, amountCollateral, liquidationTime } for each undisputed liquidation.
  // Liquidators can withdraw rewards from these disputed liquidations.
  getDisputedLiquidations() {
    return this.disputedLiquidations;
  }

  // Whether the given undisputed `liquidation` (`getUndisputedLiquidations` returns an array of `liquidation`s) is
  // disputable. `tokenRedemptionValue` should be the redemption value at `liquidation.time`.
  isDisputable(liquidation, tokenRedemptionValue) {
    return !this._isUnderCollateralized(liquidation.numTokens, liquidation.liquidatedCollateral, tokenRedemptionValue);
  }

  // Returns an array of sponsor addresses.
  getAllSponsors() {
    return this.activeSponsors;
  }

  // Returns the last update timestamp.
  getLastUpdateTime() {
    return this.lastUpdateTimestamp;
  }

  async initialSetup() {
    const [collateralRequirement, liquidationLiveness, cumulativeFeeMultiplier] = await Promise.all([
      this.emp.methods.collateralRequirement().call(),
      this.emp.methods.liquidationLiveness().call(),
      this.emp.methods.cumulativeFeeMultiplier().call()
    ]);
    this.collateralRequirement = this.toBN(collateralRequirement.toString());
    this.liquidationLiveness = Number(liquidationLiveness);
    this.cumulativeFeeMultiplier = this.toBN(cumulativeFeeMultiplier.toString());
  }

  async update() {
    if (!this.collateralRequirement) {
      await this.initialSetup();
    }
    const [newSponsorEvents, endedSponsorEvents, liquidationCreatedEvents, currentTime] = await Promise.all([
      this.emp.getPastEvents("NewSponsor", { fromBlock: 0 }),
      this.emp.getPastEvents("EndedSponsorPosition", { fromBlock: 0 }),
      this.emp.getPastEvents("LiquidationCreated", { fromBlock: 0 }),
      await this.emp.methods.getCurrentTime().call()
    ]);

    // Array of all sponsors, over all time.
    const allSponsors = [...new Set(newSponsorEvents.map(e => e.returnValues.sponsor))];
    console.log("this.allSponsors", this.allSponsors);

    // Array of ended sponsors.
    const endedSponsors = [...new Set(endedSponsorEvents.map(e => e.returnValues.sponsor))];

    // Filter out the active sponsors by removing the ended sponsors from all historic sponsors.
    this.activeSponsors = allSponsors.filter(address => !endedSponsors.includes(address));
    console.log("this.activeSponsors", this.activeSponsors);

    // Fetch information about each sponsor.
    const activePositions = await Promise.all(this.activeSponsors.map(addr => this.emp.methods.positions(addr).call()));

    // Array of all liquidated sponsors, over all time.
    const liquidatedSponsors = [...new Set(liquidationCreatedEvents.map(e => e.returnValues.sponsor))];
    const liquidationData = await Promise.all(
      liquidatedSponsors.map(address => this.emp.methods.getLiquidations(address).call())
    );

    const undisputedLiquidations = [];
    const expiredLiquidations = [];
    const disputedLiquidations = [];
    for (const sponsorLiquidationArray of liquidationData) {
      for (const [id, liquidation] of sponsorLiquidationArray.entries()) {
        // Liquidations that have had all of their rewards withdrawn will still show up here but have their properties
        // set to default values. We can skip them.
        if (liquidation.state === LiquidationStatesEnum.UNINITIALIZED) {
          continue;
        }

        // Construct Liquidation data to save
        const liquidationData = {
          sponsor: liquidation.sponsor,
          id: id.toString(),
          state: liquidation.state,
          numTokens: liquidation.tokensOutstanding.toString(),
          liquidatedCollateral: liquidation.liquidatedCollateral.toString(),
          lockedCollateral: liquidation.lockedCollateral.toString(),
          liquidationTime: liquidation.liquidationTime,
          liquidator: liquidation.liquidator,
          disputer: liquidation.disputer
        };

        // Get all undisputed liquidations.
        if (this._isLiquidationPreDispute(liquidation)) {
          // Determine whether liquidation has expired.
          if (!this._isExpired(liquidation, currentTime)) {
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

    console.log("activePositions", activePositions);
    console.log("activeSponsors", this.activeSponsors);

    // this.positions = this.activeSponsors.reduce((acc, address, i) => {
    //   acc.concat([
    //     {
    //       sponsor: address,
    //       withdrawalRequestPassTimestamp: activePositions[i].withdrawalRequestPassTimestamp,
    //       withdrawalRequestAmount: activePositions[i].withdrawalRequestAmount.toString(),
    //       numTokens: activePositions[i].tokensOutstanding.toString(),
    //       amountCollateral: this.toBN(activePositions[i].rawCollateral.toString())
    //         .mul(this.cumulativeFeeMultiplier)
    //         .div(this.toBN(this.toWei("1")))
    //         .toString(),
    //       hasPendingWithdrawal: activePositions[i].withdrawalRequestPassTimestamp > 0
    //     }
    //   ]);
    // }, []);
    this.positions = activePositions.map((position, index) => {
      return {
        sponsor: this.activeSponsors[index],
        withdrawalRequestPassTimestamp: position.withdrawalRequestPassTimestamp,
        withdrawalRequestAmount: position.withdrawalRequestAmount.toString(),
        numTokens: position.tokensOutstanding.toString(),
        amountCollateral: this.toBN(position.rawCollateral.toString())
          .mul(this.cumulativeFeeMultiplier)
          .div(this.toBN(this.toWei("1")))
          .toString(),
        hasPendingWithdrawal: position.withdrawalRequestPassTimestamp > 0
      };
    });

    console.log("this.positions", this.positions);

    this.lastUpdateTimestamp = currentTime;
    this.logger.debug({
      at: "ExpiringMultiPartyClient",
      message: "Expiring multi party state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  }
  _isUnderCollateralized(numTokens, amountCollateral, trv) {
    const fixedPointAdjustment = this.toBN(this.toWei("1"));
    // The formula for an undercollateralized position is:
    // (numTokens * trv) * collateralRequirement > amountCollateral.
    // Need to adjust by 10**18 twice because each value is represented as a fixed point scaled up by 10**18.
    return this.toBN(numTokens)
      .mul(this.toBN(trv))
      .mul(this.collateralRequirement)
      .gt(
        this.toBN(amountCollateral)
          .mul(fixedPointAdjustment)
          .mul(fixedPointAdjustment)
      );
  }

  _isExpired(liquidation, currentTime) {
    return Number(liquidation.liquidationTime) + this.liquidationLiveness <= currentTime;
  }

  _isLiquidationPreDispute(liquidation) {
    return liquidation.state === LiquidationStatesEnum.PRE_DISPUTE;
  }
}

module.exports = {
  ExpiringMultiPartyClient
};
