// A thick client for getting information about an ExpiringMultiParty.
export default class ExpiringMultiPartyClient {
  constructor() {
    this.positions = [];
  }

  // Returns an array of { sponsor, numTokens, amountCollateral } for each open position.
  getAllPositions = () => this.positions;
}
