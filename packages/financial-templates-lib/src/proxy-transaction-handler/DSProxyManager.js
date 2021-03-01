const { getFromBlock } = require("@uma/common");

class DSProxyManager {
  /**
   * @notice Constructs new Liquidator bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} web3 Web3 object to submit transactions and process on-chain info.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {String} account Ethereum account from which to send txns.
   * @param {String} dsProxyFactoryAddress address of the DSProxy factory to create new DSProxies and the like.
   */
  constructor({ logger, web3, gasEstimator, account, dsProxyFactoryAddress, dsProxyFactoryAbi, dsProxyAbi }) {
    assert(web3.utils.isAddress(account), "Account needs to be a valid address");
    assert(web3.utils.isAddress(dsProxyFactoryAddress), "dsProxyFactoryAddress needs to be a valid contract address");
    this.logger = logger;
    this.account = account;
    this.web3 = web3;
    this.gasEstimator = gasEstimator;
    this.dsProxyFactoryAddress = dsProxyFactoryAddress;
    this.dsProxyFactory = new web3.eth.Contract(dsProxyFactoryAbi, dsProxyFactoryAddress);
    this.dsProxyAbi = dsProxyAbi;
    this.dsProxy = null;
    this.dsProxyAddress = null;

    // Helper functions from web3.
    this.BN = this.web3.utils.BN;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.fromWei = this.web3.utils.fromWei;
    this.utf8ToHex = this.web3.utils.utf8ToHex;
    this.isAddress = this.web3.utils.isAddress;

    // Multiplier applied to Truffle's estimated gas limit for a transaction to send.
    this.GAS_LIMIT_BUFFER = 1.25;
  }

  getDSProxyFactoryAddress() {
    return this.dsProxyFactoryAddress;
  }

  getDSProxyAddress() {
    if (!this.dsProxyFactoryAddress) throw new Error("DSProxy not yet set! call initializeDSProxy first!");
    return this.dsProxyAddress;
  }

  // Load in an existing DSProxy for the account EOA if one already exists OR create a new one for the user.
  async initializeDSProxy() {
    this.logger.debug({
      at: "DSProxyManager",
      message: "Initalizing...Looking for existing DSProxies or deploying a new one for the provided EOA",
      dsProxyFactoryAddress: this.dsProxyFactoryAddress
    });

    if (this.dsProxy && this.dsProxyAddress) return this.dsProxyAddress;
    const fromBlock = await getFromBlock(this.web3);
    const events = await this.dsProxyFactory.getPastEvents("Created", {
      fromBlock,
      filter: { owner: this.account }
    });

    // The user already has a DSProxy deployed. Load it in from the events.
    if (events.length > 0) {
      this.dsProxyAddress = events[events.length - 1].returnValues.proxy;
      this.dsProxy = new web3.eth.Contract(this.dsProxyAbi, this.dsProxyAddress);
      this.logger.debug({
        at: "DSProxyManager",
        message: "DSProxy has been loaded in for the EOA",
        dsProxyAddress: this.dsProxyAddress,
        tx: events[events.length - 1].transactionHash,
        account: this.account
      });
    }

    // The user does not yet have a DSProxy. Create them one.
    if (events.length == 0) {
      this.logger.debug({
        at: "DSProxyManager",
        message: "No DSProxy found for EOA. Deploying new DSProxy",
        account: this.account
      });
      const dsProxyCreateTx = await this.dsProxyFactory.methods.build().send({
        from: this.account,
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      });
      this.dsProxyAddress = dsProxyCreateTx.events.Created.returnValues.proxy;
      this.dsProxy = new web3.eth.Contract(this.dsProxyAbi, this.dsProxyAddress);
      this.logger.info({
        at: "DSProxyManager",
        message: "DSProxy has been deployed for the EOA 🚀",
        dsProxyAddress: this.dsProxyAddress,
        tx: dsProxyCreateTx.transactionHash,
        account: this.account
      });
    }
    return this.dsProxyAddress;
  }
  // Encode with `yourTruffleContractInstance.yourMethod(params1,param2).encodeABI()
  async callFunctionOnExistingLibrary(libraryAddress, callData) {
    assert(this.dsProxy, "DSProxy must first be initialized to use this method");
    assert(this.isAddress(libraryAddress), "Library address must be valid address");
    assert(typeof callData === "string", "Call data must be a string");
    this.logger.debug({
      at: "DSProxyManager",
      message: "Executing function on deployed library",
      libraryAddress,
      callData
    });

    const executeTransaction = await this.dsProxy.methods["execute(address,bytes)"](libraryAddress, callData).send({
      from: this.account,
      gasPrice: this.gasEstimator.getCurrentFastPrice()
    });

    this.logger.info({
      at: "DSProxyManager",
      message: "Executed function on deployed library 📸",
      libraryAddress,
      callData,
      tx: executeTransaction.transactionHash
    });
    return executeTransaction;
  }
  // Extract call code using the `.abi` syntax on a truffle object or the `getABI(contractType,contractVersion)` from common.
  async callFunctionOnNewlyDeployedLibrary(callCode, callData) {
    assert(this.dsProxy, "DSProxy must first be initialized to use this method");
    assert(typeof callCode === "string", "Call code must be a string");
    assert(typeof callData === "string", "Call data must be a string");
    this.logger.debug({
      at: "DSProxyManager",
      message: "Executing function on library that will be deployed in the same transaction",
      callCode,
      callData
    });

    const executeTransaction = await this.dsProxy.methods["execute(bytes,bytes)"](callCode, callData).send({
      from: this.account,
      gasPrice: this.gasEstimator.getCurrentFastPrice()
    });

    this.logger.info({
      at: "DSProxyManager",
      message: "Executed function on a freshly minted library, created in the same tx 🤗",
      callCodeHash: web3.utils.soliditySha3(callCode),
      callData,
      tx: executeTransaction.transactionHash
    });
    return executeTransaction;
  }
}

module.exports = {
  DSProxyManager
};
