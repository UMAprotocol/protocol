const { Logger } = require("../financial-templates-lib/logger/Logger");

class BalanceMonitor {
  constructor(account, botMonitorObject, walletMonitorObject) {
    this.account = account;

    // An array of bot objects to monitor. Each bot's `botName` `address`,
    // `CollateralTokenThreshold` and`syntheticTokenThreshold` must be given. Example:
    // [{ botName: "Liquidator Bot",
    //   address: '0x12345'
    //   collateralTokenThreshold: x1,
    //   syntheticTokenThreshold: x2,
    //   etherThreshold: x3 },
    // ...]
    this.botMonitorObject = botMonitorObject;

    // An array of wallets to Monitor. Each wallet's `walletName`, `address`, `crAlert`
    // must be given. Example:
    // [{ walletName: "Market Making bot",
    //    address: '0x12345',
    //    crAlert: 150},
    // ...];
    this.walletMonitorObject = walletMonitorObject;

    // Instance of the expiring multiparty to perform on-chain disputes
    this.empContract = this.empClient.emp;
    this.web3 = this.empClient.web3;
  }

  // Queries disputable liquidations and disputes any that were incorrectly liquidated.
  checkBalances = async priceFunction => {
    Logger.debug({
      at: "BalanceMonitor",
      message: "Checking for Balances"
    });

    // Update the client to get the latest liquidation information.
    await this.empClient._update();
  };
}

module.exports = {
  Disputer
};
