const { delay } = require("./delay");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// A thick client for getting information about an ExpiringMultiParty.
class ExpiringMultiPartyClient {
  constructor(empAddress) {
    this.sponsorAddresses = [];
    this.positions = [];
    this.undisputedLiquidations = [];
    this.emp = new web3.eth.Contract(ExpiringMultiParty.abi, empAddress);
    // TODO: Ideally, we'd want to subscribe to events here, but subscriptions don't work with Truffle HDWalletProvider.
    // One possibility is to experiment with WebSocketProvider instead.
  }

  // Returns an array of { sponsor, numTokens, amountCollateral } for each open position.
  getAllPositions = () => this.positions;

  // Returns an array of { sponsor, id, numTokens, amountCollateral, liquidationTime } for each undisputed liquidation.
  getUndisputedLiquidations = () => this.undisputedLiquidations;

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

  _update = async () => {
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
    for (const address of this.sponsorAddresses) {
      const liquidations = await this.emp.methods.getLiquidations(address).call();
      for (const [id, liquidation] of liquidations.entries()) {
        if (liquidation.state == predisputeState) {
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
