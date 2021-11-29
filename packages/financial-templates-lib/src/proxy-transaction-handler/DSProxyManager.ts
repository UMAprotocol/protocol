import assert from "assert";

import { getFromBlock, runTransaction } from "@uma/common";
import { TransactionReceipt } from "web3-eth";
import Web3 from "web3";
import type { Logger } from "winston";
import type { GasEstimator } from "../helpers/GasEstimator";
import type { Abi } from "../types";
import type { DSProxyFactoryWeb3, DSProxyWeb3, DSProxyFactoryWeb3Events } from "@uma/contracts-node";
import type { TransactionType } from "@uma/common";

interface Params {
  logger: Logger;
  web3: Web3;
  gasEstimator: GasEstimator;
  account: string;
  dsProxyFactoryAddress: string;
  dsProxyFactoryAbi: Abi;
  dsProxyAbi: Abi;
  availableAccounts?: number;
}

export class DSProxyManager {
  private readonly logger: Logger;
  private readonly web3: Web3;
  private readonly account: string;
  private readonly dsProxyFactoryAddress: string;
  private readonly dsProxyFactory: DSProxyFactoryWeb3;
  private readonly gasEstimator: GasEstimator;
  private readonly dsProxyAbi: Abi;
  private readonly availableAccounts: number;

  // Helper functions from web3.
  private readonly isAddress = Web3.utils.isAddress;

  // Multiplier applied to Truffle's estimated gas limit for a transaction to send.
  private readonly GAS_LIMIT_BUFFER = 1.25;
  private dsProxy: DSProxyWeb3 | null = null;
  private dsProxyAddress: string | null = null;

  /**
   * @notice Constructs new Liquidator bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} web3 Web3 object to submit transactions and process on-chain info.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {String} account Ethereum account from which to send txns.
   * @param {String} dsProxyFactoryAddress address of the DSProxy factory to create new DSProxies.
   * @param {object} dsProxyFactoryAbi ABI of DSProxy factory to enable methods to be called on the contract.
   * @param {object} dsProxyAbi ABI of DSProxy to enable `execute` to be called.
   * @param {number} availableAccounts the number of EOAs that should be accessible when calling the DSProxy. Each EOA
   * needs to be permissioned to call the DSProxy with `DSAuthority`.
   */
  constructor({
    logger,
    web3,
    gasEstimator,
    account,
    dsProxyFactoryAddress,
    dsProxyFactoryAbi,
    dsProxyAbi,
    availableAccounts = 1,
  }: Params) {
    assert(web3.utils.isAddress(account), "Account needs to be a valid address");
    assert(web3.utils.isAddress(dsProxyFactoryAddress), "dsProxyFactoryAddress needs to be a valid contract address");
    this.logger = logger;
    this.account = account;
    this.web3 = web3;
    this.gasEstimator = gasEstimator;
    this.dsProxyFactoryAddress = dsProxyFactoryAddress;
    this.dsProxyFactory = (new web3.eth.Contract(
      dsProxyFactoryAbi,
      dsProxyFactoryAddress
    ) as unknown) as DSProxyFactoryWeb3;
    this.dsProxyAbi = dsProxyAbi;
    this.availableAccounts = availableAccounts;
  }

  public getDSProxyFactoryAddress(): string {
    return this.dsProxyFactoryAddress;
  }

  public getDSProxyAddress(): string {
    if (!this.dsProxyAddress) throw new Error("DSProxy not yet set! call initializeDSProxy first!");
    return this.dsProxyAddress;
  }

  // Load in an existing DSProxy for the account EOA if one already exists or create a new one for the user. Note that
  // the user can provide a dsProxyAddress if they want to override the factory behaviour and load in a DSProxy directly.
  public async initializeDSProxy(
    dsProxyAddress: string | null = null,
    shouldCreateProxy = true
  ): Promise<string | null> {
    if (dsProxyAddress) {
      this.logger.debug({ at: "DSProxyManager", message: "Initalizing to a provided DSProxy Address", dsProxyAddress });
      this.dsProxyAddress = dsProxyAddress;
      this.dsProxy = (new this.web3.eth.Contract(this.dsProxyAbi, dsProxyAddress) as unknown) as DSProxyWeb3;
      return dsProxyAddress;
    }
    this.logger.debug({
      at: "DSProxyManager",
      message: "Initalizing...Looking for existing DSProxies or deploying a new one for the provided EOA",
      dsProxyFactoryAddress: this.dsProxyFactoryAddress,
    });

    if (this.dsProxy && this.dsProxyAddress) return this.dsProxyAddress;
    const fromBlock = await getFromBlock(this.web3);
    const events = await ((this.dsProxyFactory.getPastEvents("Created", {
      fromBlock,
      filter: { owner: this.account },
    }) as unknown) as Promise<DSProxyFactoryWeb3Events.Created[]>);

    // The user already has a DSProxy deployed. Load it in from the events.
    if (events.length > 0) {
      this.dsProxyAddress = events[events.length - 1].returnValues.proxy; // use the most recent DSProxy (end index).
      this.dsProxy = (new this.web3.eth.Contract(this.dsProxyAbi, this.dsProxyAddress) as unknown) as DSProxyWeb3;
      this.logger.debug({
        at: "DSProxyManager",
        message: "DSProxy has been loaded in for the EOA",
        dsProxyAddress: this.dsProxyAddress,
        tx: events[events.length - 1].transactionHash,
        account: this.account,
      });
    }

    // The user does not yet have a DSProxy. Create them one, if they have enabled shouldCreateProxy.
    if (events.length == 0 && shouldCreateProxy) {
      this.logger.debug({
        at: "DSProxyManager",
        message: "No DSProxy found for EOA. Deploying new DSProxy",
        account: this.account,
      });
      await this.gasEstimator.update();
      const { receipt, transactionConfig, transactionHash } = await runTransaction({
        web3: this.web3,
        transaction: (this.dsProxyFactory.methods["build()"]() as unknown) as TransactionType,
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account } as any,
        availableAccounts: this.availableAccounts, // give the run transaction access to additional EOAs, if they are set.
      });
      if (!(receipt as TransactionReceipt)?.events?.Created?.returnValues?.proxy)
        throw new Error("Proxy address not found in log");
      this.dsProxyAddress = (receipt as TransactionReceipt)?.events?.Created.returnValues.proxy as string;
      this.dsProxy = (new this.web3.eth.Contract(this.dsProxyAbi, this.dsProxyAddress) as unknown) as DSProxyWeb3;
      this.logger.info({
        at: "DSProxyManager",
        message: "DSProxy deployed for your EOA 🚀",
        dsProxyAddress: this.dsProxyAddress,
        tx: transactionHash,
        account: this.account,
        transactionConfig,
      });
    }
    return this.dsProxyAddress;
  }

  // Encode with `yourTruffleContractInstance.yourMethod(params1,param2).encodeABI()
  public async callFunctionOnExistingLibrary(libraryAddress: string, callData: string): Promise<TransactionReceipt> {
    assert(this.dsProxy, "DSProxy must first be initialized to use this method");
    assert(this.isAddress(libraryAddress), "Library address must be valid address");
    assert(typeof callData === "string", "Call data must be a string");
    this.logger.debug({
      at: "DSProxyManager",
      message: "Executing function on deployed library",
      libraryAddress,
      callData,
    });
    await this.gasEstimator.update();
    const { receipt, returnValue, transactionConfig, transactionHash } = await runTransaction({
      web3: this.web3,
      // Have to hard cast this due to minor issues with types and versions.
      transaction: (this.dsProxy.methods["execute(address,bytes)"](
        libraryAddress,
        callData
      ) as unknown) as TransactionType,
      transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account } as any,
      availableAccounts: this.availableAccounts,
    });

    this.logger.info({
      at: "DSProxyManager",
      message: "Executed function on deployed library 📸",
      libraryAddress,
      callData,
      tx: transactionHash,
      returnValue: returnValue.toString(),
      transactionConfig,
    });
    return receipt;
  }
  // Extract call code using the `.abi` syntax on a truffle object or the `getABI(contractType,contractVersion)` from common.
  public async callFunctionOnNewlyDeployedLibrary(callCode: string, callData: string): Promise<TransactionReceipt> {
    assert(this.dsProxy, "DSProxy must first be initialized to use this method");
    assert(typeof callCode === "string", "Call code must be a string");
    assert(typeof callData === "string", "Call data must be a string");
    this.logger.debug({
      at: "DSProxyManager",
      message: "Executing function on library that will be deployed in the same transaction",
      callData,
      callCode,
    });

    await this.gasEstimator.update();
    const { receipt, returnValue, transactionConfig, transactionHash } = await runTransaction({
      web3: this.web3,
      transaction: (this.dsProxy.methods["execute(bytes,bytes)"](callCode, callData) as unknown) as TransactionType,
      transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account } as any,
      availableAccounts: this.availableAccounts,
    });

    this.logger.info({
      at: "DSProxyManager",
      message: "Executed function on a freshly deployed library, created in the same tx 🤗",
      callData,
      tx: transactionHash,
      returnValue: returnValue.toString(),
      transactionConfig,
    });
    return receipt;
  }
}
