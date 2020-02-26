const { delay } = require("./delay");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// A thick client for getting information about an ExpiringMultiParty.
class ExpiringMultiPartyClient {
  constructor(empAddress) {
    this.sponsorAddresses = [];
    this.positions = [];
    this.undisputedLiquidations = [];
    this.emp = new web3.eth.Contract(ExpiringMultiParty.abi, empAddress);

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

  // Whether the given `liquidation` (`getUndisputedLiquidations` returns an array of `liquidation`s) is disputable.
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
        console.log("Poll error:", error);
      }
      await delay(Number(10_000));
    }
  };

  _isUnderCollateralized = (numTokens, amountCollateral, trv) => {
    const { toBN, toWei } = web3.utils;
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

  _update = async () => {
    this.collateralRequirement = web3.utils.toBN((await this.emp.methods.collateralRequirement().call()).toString());

    const events = await this.emp.getPastEvents("NewSponsor", { fromBlock: 0 });
    this.sponsorAddresses = [...new Set(events.map(e => e.returnValues.sponsor))];

    // Fetch information about each sponsor.
    const positions = await Promise.all(
      this.sponsorAddresses.map(address => this.emp.methods.positions(address).call())
    );
    const collateral = await Promise.all(
      this.sponsorAddresses.map(address => this.emp.methods.getCollateral(address).call())
    );

    const nextUndisputedLiquidations = [];
    const predisputeState = "1";
    const currentTime = Date.now() / 1000;
    for (const address of this.sponsorAddresses) {
      const liquidations = await this.emp.methods.getLiquidations(address).call();
      for (const [id, liquidation] of liquidations.entries()) {
        if (liquidation.state == predisputeState && Number(liquidation.expiry) > currentTime) {
          nextUndisputedLiquidations.push({
            sponsor: liquidation.sponsor,
            id: id.toString(),
            numTokens: liquidation.tokensOutstanding.toString(),
            amountCollateral: liquidation.liquidatedCollateral.toString(),
            liquidationTime: liquidation.liquidationTime
          });
        }
      }
    }

    // TODO: Need to handle pending withdrawal requests here.
    this.positions = this.sponsorAddresses.reduce(
      (acc, address, i) =>
        // Filter out empty positions.
        positions[i].rawCollateral.toString() === "0"
          ? acc
          : acc.concat([
              {
                sponsor: address,
                numTokens: positions[i].tokensOutstanding.toString(),
                amountCollateral: collateral[i].toString()
              }
            ]),
      []
    );
    this.undisputedLiquidations = nextUndisputedLiquidations;
  };
}

module.exports = {
  ExpiringMultiPartyClient
};
