// This notifier is used to monitor a API endpoint serving known contract addresses and their expirations.

const { createEtherscanLinkMarkdown } = require("@uma/common");
const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

class ContractNotifier {
  /**
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} chainId Contracts deployment chain.
   * @param {String} apiEndpoint API endpoint to monitor.
   * @param {Integer} maxTimeTillExpiration Period in seconds to look for upcoming contract expirations.
   */
  constructor({ logger, networker, getTime, chainId, apiEndpoint, maxTimeTillExpiration }) {
    this.logger = logger;
    this.networker = networker;
    this.getTime = getTime;
    this.chainId = chainId;
    this.apiEndpoint = apiEndpoint;
    this.maxTimeTillExpiration = maxTimeTillExpiration;
  }

  // Main function to check contracts for upcoming expirations.
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

    // Get non-expired LSP and EMP contracts (global route) from UMA API endpoint.
    const apiUrl = this.apiEndpoint + "/global/listActive";
    const activeContracts = await this.networker.getJson(apiUrl, { method: "post" });

    const expiringContracts = activeContracts
      .map((contract) => {
        // EMP endpoint covers all contracts registered with DVM including e.g. OptimisticOracle
        // or non-expiring Jarvis contracts that should be filtered out.
        if (!contract.type || !contract.expirationTimestamp) {
          return null;
        }
        // Use long token name for LSP contracts to be consistent with behavior at https://projects.umaproject.org
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
          chainId: this.chainId,
          address: contract.address,
          expirationTimestamp: contract.expirationTimestamp,
          tokenName: tokenName,
          expirationUtcString: expirationUtcString,
        };
      })
      .filter((contract) => {
        return (
          contract &&
          // Include only contracts that expire within maxTimeTillExpiration seconds.
          contract.expirationTimestamp - currentTime <= this.maxTimeTillExpiration &&
          // Filter out contracts that are past expiration, but have not been expired yet.
          contract.expirationTimestamp > currentTime &&
          // Filter out contracts that have already been notified, but repeat notification if they were
          // previosly notified due to longer maxTimeTillExpiration window than current setting.
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
        notificationPath: "outcome-expirations",
      });
    }

    // Update google datastore on notified contracts.
    await this.updateNotifiedExpirations(expiringContracts, currentTime);
  }

  // Gets previously notified contracts from google Datastore.
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

  // Adds notified contracts to google Datastore.
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
