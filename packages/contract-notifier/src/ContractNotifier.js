// This notifier is used to monitor a API endpoint serving known contract addresses and their expirations.

const { createEtherscanLinkMarkdown } = require("@uma/common");
const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

class ContractNotifier {
  /**
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {String} apiEndpoint API endpoint to monitor.
   * @param {Integer} maxTimeTillExpiration Period in seconds to look for upcoming contract expirations.
   */
  constructor({ logger, networker, getTime, apiEndpoint, maxTimeTillExpiration }) {
    this.logger = logger;
    this.networker = networker;
    this.getTime = getTime;
    this.apiEndpoint = apiEndpoint;
    this.maxTimeTillExpiration = maxTimeTillExpiration;
  }

  async checkUpcomingExpirations() {
    this.logger.debug({
      at: "ExpirationsNotifier",
      message: "Checking for upcoming expirations",
      apiEndpoint: this.apiEndpoint,
      maxTimeTillExpiration: this.maxTimeTillExpiration,
    });

    const currentTime = await this.getTime();
    const notifiedExpirations = await this.getNotifiedExpirations();
    const expirationPeriod =
      this.maxTimeTillExpiration > 259200
        ? parseInt(this.maxTimeTillExpiration / 86400) + " days"
        : parseInt(this.maxTimeTillExpiration / 3600) + " hours";
    const apiUrl = this.apiEndpoint + "/global/listActive";
    const activeContracts = await this.networker.getJson(apiUrl, { method: "post" });
    const expiringContracts = activeContracts
      .map((contract) => {
        if (!contract.type || !contract.expirationTimestamp) {
          return null;
        }
        let tokenName;
        if (contract.type === "emp") {
          tokenName = contract.tokenName;
        } else if (contract.type === "lsp") {
          tokenName = contract.longTokenName;
        } else {
          tokenName = "";
        }
        const expirationUtcString = new Date(contract.expirationTimestamp * 1000).toUTCString();
        return {
          // UMA API currently supports only Ethereum mainnet, thus chainId of 1 is hardcoded here:
          chainId: 1,
          address: contract.address,
          expirationTimestamp: contract.expirationTimestamp,
          tokenName: tokenName,
          expirationUtcString: expirationUtcString,
        };
      })
      .filter((contract) => {
        return (
          contract &&
          contract.expirationTimestamp - currentTime <= this.maxTimeTillExpiration &&
          contract.expirationTimestamp > currentTime &&
          (!Object.keys(notifiedExpirations).includes(contract.chainId + "_" + contract.address) ||
            contract.expirationTimestamp -
              notifiedExpirations[contract.chainId + "_" + contract.address].notificationTimestamp >
              this.maxTimeTillExpiration)
        );
      });

    let mrkdwn = `Following contracts are expiring in ${expirationPeriod}:`;
    for (let contract of expiringContracts) {
      mrkdwn =
        mrkdwn +
        `\n- ${createEtherscanLinkMarkdown(contract.address, contract.chainId)}:` +
        ` ${contract.tokenName}` +
        ` is expiring on ${contract.expirationUtcString}`;
    }
    if (expiringContracts.length) {
      this.logger.warn({
        at: "ExpirationsNotifier",
        message: "Expiring contracts reminder 🔔",
        mrkdwn,
        notificationPath: "dev-x",
      });
    }

    // Update google datastore on notified contracts.
    await this.updateNotifiedExpirations(expiringContracts, currentTime);
  }

  async getNotifiedExpirations() {
    const notifiedExpirations = (await datastore.runQuery(datastore.createQuery("NotifiedExpirations")))[0];
    return notifiedExpirations.reduce((contracts, contract) => {
      return {
        ...contracts,
        [contract.chainId + "_" + contract.address]: {
          address: contract.address,
          chainId: contract.chainId,
          notificationTimestamp: contract.notificationTimestamp,
        },
      };
    }, {});
  }

  async updateNotifiedExpirations(notifiedContracts, currentTime) {
    const promises = notifiedContracts.map((contract) => {
      const key = datastore.key(["NotifiedExpirations", contract.chainId + "_" + contract.address]);
      const data = { address: contract.address, chainId: contract.chainId, notificationTimestamp: currentTime };
      datastore.save({ key: key, data: data });
    });
    await Promise.all(promises);
  }
}

module.exports = { ContractNotifier };
