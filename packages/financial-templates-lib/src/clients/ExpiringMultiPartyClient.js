// A thick client for getting information about an ExpiringMultiParty. Used to get sponsor information, outstanding
// positions, undisputed Liquidations, expired liquidations, disputed liquidations.

const { ConvertDecimals, LiquidationStatesEnum, getFromBlock } = require("@uma/common");
const Promise = require("bluebird");
class ExpiringMultiPartyClient {
  /**
   * @notice Constructs new ExpiringMultiPartyClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} empAbi Expiring Multi Party truffle ABI object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} empAddress Ethereum address of the EMP contract deployed on the current network.
   * @param {Number} collateralDecimals Number of decimals within the collateral currency.
   * @param {Number} syntheticDecimals Number of decimals within the synthetic currency.
   * @param {Number} priceFeedDecimals Number of decimals a price feed returned by the DVM would be scaled by. For old
   * EMPS this is scaled to the number of decimals in the collateral currency (8 for BTC) and in new EMPs this has been
   * updated to always use 18 decimals, irrespective of the collateral type for consistency.
   * @return None or throws an Error.
   */
  constructor(
    logger,
    empAbi,
    web3,
    empAddress,
    collateralDecimals = 18,
    syntheticDecimals = 18,
    priceFeedDecimals = 18,
    contractType = "ExpiringMultiParty" // Default to EMP for now to enable backwards compatibility with other bots. This will be removed as soon as the other bots have been updated to work with these contract types.
  ) {
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
    this.priceFeedDecimals = priceFeedDecimals;

    // Perpetual financial products require the latest fundingRate to correctly calculate fundingRate adjusted debt.
    this.latestCumulativeFundingRateMultiplier;

    // Store the last on-chain time the clients were updated to inform price request information.
    this.lastUpdateTimestamp = 0;

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;

    // Define a set of normalization functions. These Convert a number delimited with given base number of decimals to a
    // number delimited with a given number of decimals (18). For example, consider normalizeCollateralDecimals. 100 BTC
    // is 100*10^8. This function would return 100*10^18, thereby converting collateral decimals to 18 decimal places.
    this.normalizeCollateralDecimals = ConvertDecimals(collateralDecimals, 18, this.web3);
    this.normalizeSyntheticDecimals = ConvertDecimals(syntheticDecimals, 18, this.web3);
    this.normalizePriceFeedDecimals = ConvertDecimals(priceFeedDecimals, 18, this.web3);

    this.fixedPointAdjustment = this.toBN(this.toWei("1"));

    if (contractType != "ExpiringMultiParty" && contractType != "Perpetual")
      throw new Error(
        `Invalid contract type provided: ${contractType}! The financial product client only supports ExpiringMultiParty or Perpetual`
      );
    this.contractType = contractType;
  }

  getContractType() {
    return this.contractType;
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

  getLatestCumulativeFundingRateMultiplier() {
    return this.latestCumulativeFundingRateMultiplier;
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
    const fromBlock = await getFromBlock(this.web3);
    const [newSponsorEvents, endedSponsorEvents, liquidationCreatedEvents, currentTime] = await Promise.all([
      this.emp.getPastEvents("NewSponsor", { fromBlock }),
      this.emp.getPastEvents("EndedSponsorPosition", { fromBlock }),
      this.emp.getPastEvents("LiquidationCreated", { fromBlock }),
      this.emp.methods.getCurrentTime().call()
    ]);

    if (this.contractType === "Perpetual") {
      this.latestCumulativeFundingRateMultiplier = this.toBN(
        (await this.emp.methods.fundingRate().call()).cumulativeMultiplier.rawValue
      );
    } else {
      this.latestCumulativeFundingRateMultiplier = this.fixedPointAdjustment;
    }

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

    // Fetch sponsor position & liquidation in parallel batches, 150 at a time, to be safe and not overload the web3 node.
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
        numTokens: this.toBN(position.tokensOutstanding.toString()) // Apply the current funding rate to the sponsor debt.
          .mul(this.latestCumulativeFundingRateMultiplier)
          .div(this.fixedPointAdjustment)
          .toString(),
        amountCollateral: this.toBN(position.rawCollateral.toString()) // Apply the current outstanding fees to collateral.
          .mul(this.cumulativeFeeMultiplier)
          .div(this.fixedPointAdjustment)
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
  // The formula for an undercollateralized position is: (numTokens * trv) * collateralRequirement > amountCollateral.
  // This equation assumes the decimal points across the inputs are normalized to the same basis. However, this wont always
  // be the case and so we need to consider arbitrary decimals coming into the equation. When considering decimals of
  // each variable within the as collateral (cD), synthetic (sD), CR (1e18), trv (trvD) this equation becomes:
  // numTokens * 10^sD * trv * 10^trvD * collateralRequirement * 10^18 > amountCollateral * 10^cD.
  // To accommodate these different decimal points we can normalize each term to the 10^18 basis and then apply a "correction"
  // factor due to the additional scalling from multiplying basis numbers.
  _isUnderCollateralized(numTokens, amountCollateral, tokenRedemptionValue) {
    // Normalize the inputs. Now all terms are 18 decimal delimited and no extra conversion is needed.
    const normalizedNumTokens = this.normalizeSyntheticDecimals(numTokens);
    const normalizedAmountCollateral = this.normalizeCollateralDecimals(amountCollateral);
    const normalizedTokenRedemptionValue = this.normalizePriceFeedDecimals(tokenRedemptionValue);

    return normalizedNumTokens
      .mul(normalizedTokenRedemptionValue)
      .mul(this.collateralRequirement)
      .gt(normalizedAmountCollateral.mul(this.fixedPointAdjustment).mul(this.fixedPointAdjustment));
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
