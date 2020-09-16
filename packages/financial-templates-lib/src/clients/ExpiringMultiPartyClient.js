// A thick client for getting information about an ExpiringMultiParty. Used to get sponsor information, outstanding
// positions, undisputed Liquidations, expired liquidations, disputed liquidations.

const { ConvertDecimals, parseFixed, LiquidationStatesEnum } = require("@uma/common");
const Promise = require("bluebird");

class ExpiringMultiPartyClient {
  /**
   * @notice Constructs new ExpiringMultiPartyClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} empAbi Expiring Multi Party truffle ABI object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} empAddress Ethereum address of the EMP contract deployed on the current network.
   * @return None or throws an Error.
   */
  constructor(logger, empAbi, web3, empAddress, collateralDecimals = 18, syntheticDecimals = 18) {
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
    this.collateralDecimals = collateralDecimals;
    this.syntheticDecimals = syntheticDecimals;

    // Store the last on-chain time the clients were updated to inform price request information.
    this.lastUpdateTimestamp = 0;

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;

    const Convert = (decimals = 18) => number => this.toBN(parseFixed(number.toString(), decimals).toString());

    // currently not implemented
    this.convertSynthetic = Convert(syntheticDecimals);
    this.convertCollateral = Convert(collateralDecimals);
    this.convertCollateralToSynthetic = ConvertDecimals(collateralDecimals, syntheticDecimals, this.web3);
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
    // If it is the first run then get contract contestants. This only needs to be called once.
    if (!this.collateralRequirement || !this.liquidationLiveness || !this.cumulativeFeeMultiplier) {
      await this.initialSetup();
    }
    // Fetch contract state variables in parallel.
    const [newSponsorEvents, endedSponsorEvents, liquidationCreatedEvents, currentTime] = await Promise.all([
      this.emp.getPastEvents("NewSponsor", { fromBlock: 0 }),
      this.emp.getPastEvents("EndedSponsorPosition", { fromBlock: 0 }),
      this.emp.getPastEvents("LiquidationCreated", { fromBlock: 0 }),
      this.emp.methods.getCurrentTime().call()
    ]);

    // Array of all sponsors, over all time. Can contain repeats for every `NewSponsor` event.
    const newSponsorAddresses = newSponsorEvents.map(e => e.returnValues.sponsor);

    // Array of ended sponsors. Can contain repeats for every `EndedSponsorPosition` event.
    const endedSponsorAddresses = endedSponsorEvents.map(e => e.returnValues.sponsor);

    // Filter out the active sponsors by removing ended sponsors from all historic sponsors. Note that a sponsor could
    // create a position, end their position and then create another one. They could potentially do this multiple times.
    // As a result, create a temp array `sponsorsToRemove` which is updated as sponsors are removed from the array.
    let sponsorsToRemove = endedSponsorAddresses; // temp array to contain address to remove.
    this.activeSponsors = newSponsorAddresses.filter(address => {
      // If the sponsorsToRemove contains the current address, then that address should be removed from newSponsorAddresses.
      const index = sponsorsToRemove.indexOf(address);
      // Update the `sponsorsToRemove` by removing the first instance of the address from the sponsorsToRemove array.
      if (index !== -1) {
        sponsorsToRemove = [...sponsorsToRemove.slice(0, index), ...sponsorsToRemove.slice(index + 1)];
        return false; // return false means that the filter will remove the current address from newSponsorAddresses
      }
      return true; // returning true means that the filter will keep the current address from newSponsorAddresses
    });

    // Array of all liquidated sponsors, over all time. Use a Set to ensure only contains unique elements.
    const liquidatedSponsors = [...new Set(liquidationCreatedEvents.map(e => e.returnValues.sponsor))];

    // Fetch sponsor position & liquidation in parallel batches, 20 at a time, to be safe and not overload the web3 node.
    const WEB3_CALLS_BATCH_SIZE = 150;
    const [activePositions, allLiquidations] = await Promise.all([
      Promise.map(this.activeSponsors, address => this.emp.methods.positions(address).call(), {
        concurrency: WEB3_CALLS_BATCH_SIZE
      }),
      Promise.map(liquidatedSponsors, address => this.emp.methods.getLiquidations(address).call(), {
        concurrency: WEB3_CALLS_BATCH_SIZE
      })
    ]);

    const undisputedLiquidations = [];
    const expiredLiquidations = [];
    const disputedLiquidations = [];
    for (let liquidations of allLiquidations) {
      for (const [id, liquidation] of liquidations.entries()) {
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
    // we need to convert our tokens down to collateral decimals
    return this.toBN(numTokens)
      .mul(this.toBN(trv))
      .mul(this.collateralRequirement)
      .gt(
        this.convertCollateralToSynthetic(amountCollateral)
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
