const { delay } = require("./delay");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// A thick client for getting information about an ExpiringMultiParty.
class ExpiringMultiPartyClient {
  constructor(empAddress) {
    this.positions = [];
    this.sponsorAddresses = [];
    this.emp = new web3.eth.Contract(ExpiringMultiParty.abi, empAddress);
    // TODO: Ideally, we'd want to subscribe to events here, but subscriptions don't work with Truffle HDWalletProvider.
    // One possibility is to experiment with WebSocketProvider instead.
  }

  // Returns an array of { sponsor, numTokens, amountCollateral } for each open position.
  getAllPositions = () => this.positions;

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

    // TODO: Need to handle pending withdrawal requests here.
    this.positions = this.sponsorAddresses.map((address, i) => ({
      sponsor: address,
      numTokens: positions[i].tokensOutstanding.toString(),
      amountCollateral: collateral[i].toString()
    }));
  };
}

module.exports = {
  ExpiringMultiPartyClient
};
