const { delay } = require("./delay");
const { Logger } = require("./Logger");

// A thick client for getting information about an ExpiringMultiParty.
class ExpiringMultiPartyClient {
  constructor(abi, web3, empAddress) {
    this.web3 = web3;
    this.sponsorAddresses = [];
    this.positions = [];
    this.undisputedLiquidations = [];
    this.expiredLiquidations = [];
    this.disputedLiquidations = [];
    this.emp = new web3.eth.Contract(abi, empAddress);
    this.empAddress = empAddress;

    this.collateralRequirement = null;
    // TODO: Ideally, we'd want to subscribe to events here, but subscriptions don't work with Truffle HDWalletProvider.
    // One possibility is to experiment with WebSocketProvider instead.
  }

  // Returns an array of { sponsor, numTokens, amountCollateral } for each open position.
  getAllPositions = () => this.positions;

  // Returns an array of { sponsor, numTokens, amountCollateral } for each position that is undercollateralized
  // according to the provided `tokenRedemptionValue`.
  getUnderCollateralizedPositions = tokenRedemptionValue => {
    return this.positions.filter(position =>
      this._isUnderCollateralized(position.numTokens, position.amountCollateral, tokenRedemptionValue)
    );
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

  start = () => {
    this._poll();
  };

  _poll = async () => {
    while (true) {
      try {
        await this._update();
      } catch (error) {
        Logger.error({
          at: "ExpiringMultiPartyClient",
          message: "client polling error",
          error: error
        });
      }
      await delay(Number(10_000));
    }
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
    // @dev: Liquidation's can't have state == 0 (Uninitialized),
    // and disputed liquidations have state > 1
    const predisputeState = "1";
    return liquidation.state === predisputeState;
  };

  _update = async () => {
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
        // Liquidations that have had their rewards withdrawn will still show up here but have their "sponsor" property deleted.
        // We can skip them.
        if (liquidation.sponsor === "0x0000000000000000000000000000000000000000") {
          continue;
        }

        // Construct Liquidation data to save.
        const liquidationData = {
          sponsor: liquidation.sponsor,
          id: id.toString(),
          numTokens: liquidation.tokensOutstanding.toString(),
          amountCollateral: liquidation.liquidatedCollateral.toString(),
          liquidationTime: liquidation.liquidationTime
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
          : acc.concat([
              {
                sponsor: address,
                requestPassTimestamp: positions[i].requestPassTimestamp,
                withdrawalRequestAmount: positions[i].withdrawalRequestAmount.toString(),
                numTokens: positions[i].tokensOutstanding.toString(),
                amountCollateral: collateral[i].toString(),
                hasPendingWithdrawal: positions[i].requestPassTimestamp > 0
              }
            ]),
      []
    );
    Logger.info({
      at: "ExpiringMultiPartyClient",
      message: "client updated"
    });
  };
}

module.exports = {
  ExpiringMultiPartyClient
};
