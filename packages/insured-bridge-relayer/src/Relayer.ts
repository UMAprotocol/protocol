import Web3 from "web3";
import winston from "winston";

export class Relayer {
  /**
   * @notice Constructs new Relayer Instance.
   * @param {Object} logger Module used to send logs.
   * @param {Object} web3 Provider from Truffle/node to connect to Ethereum network.
   */
  constructor(readonly logger: winston.Logger, readonly web3: Web3) {}

  async relayPendingDeposits() {
    this.logger.debug({
      at: "Relayer",
      message: "Checking for pending deposits and relaying",
    });
  }
}
module.exports = { Relayer };
