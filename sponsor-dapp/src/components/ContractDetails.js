import React, { Component } from "react";
import ContractFinancialsTable from "./ContractFinancialsTable.js";
import ContractParameters from "./ContractParameters.js";
import ContractInteraction from "./ContractInteraction.js";
import TokenizedDerivative from "../contracts/TokenizedDerivative.json";
import IERC20 from "../contracts/IERC20.json";
import TokenPreapproval from "./TokenPreapproval.js";
import ManualPriceFeed from "../contracts/ManualPriceFeed.json";
import { hasEthMarginCurrency, stateToString } from "../utils/TokenizedDerivativeUtils.js";
import { formatDate } from "../utils/FormattingUtils.js";
import DrizzleHelper from "../utils/DrizzleHelper.js";

// Corresponds to `~uint(0)` in Solidity.
const UINT_MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

class ContractDetails extends Component {
  state = {
    loadingTokenizedDerivativeData: true,
    loadingPriceFeedData: true,
    loadingMarginCurrencyData: true,
    isInteractionEnabled: true,
    initiatedTransactionId: null,
    formInputs: { depositAmount: "", withdrawAmount: "", createAmount: "", redeemAmount: "" }
  };

  componentDidMount() {
    const { drizzle, contractAddress } = this.props;

    this.drizzleHelper = new DrizzleHelper(drizzle);

    Promise.all([this.getContract(), this.fetchPriceFeedData(), this.fetchMarginCurrencyAllowance()]).catch(error => {
      console.error(`Contract ${contractAddress} failed to fetch: ${error.message}`);
    });

    this.unsubscribeTxCheck = drizzle.store.subscribe(() => {
      this.checkPendingTransaction();
    });
  }

  async getContract() {
    const { contractAddress: address } = this.props;
    await this.drizzleHelper.addContract(address, TokenizedDerivative.abi);

    const account = this.props.drizzleState.accounts[0];

    return this.drizzleHelper
      .cacheCallAll([
        { address, methodName: "derivativeStorage", args: [] },
        { address, methodName: "totalSupply", args: [] },
        { address, methodName: "name", args: [] },
        { address, methodName: "calcTokenValue", args: [] },
        { address, methodName: "calcNAV", args: [] },
        { address, methodName: "calcShortMarginBalance", args: [] },
        { address, methodName: "balanceOf", args: [account] },
        { address, methodName: "allowance", args: [account, address] }
      ])
      .then(results => {
        // Update the state now that contract data has been loaded
        const state = {};
        results.forEach(({ methodName, key }) => {
          switch (methodName) {
            case "derivativeStorage":
              state.derivativeStorageDataKey = key;
              break;
            case "totalSupply":
              state.totalSupplyDataKey = key;
              break;
            case "name":
              state.nameDataKey = key;
              break;
            case "calcTokenValue":
              state.estimatedTokenValueDataKey = key;
              break;
            case "calcNAV":
              state.estimatedNavDataKey = key;
              break;
            case "calcShortMarginBalance":
              state.estimatedShortMarginBalanceDataKey = key;
              break;
            case "balanceOf":
              state.tokenBalanceDataKey = key;
              break;
            case "allowance":
              state.derivativeTokenAllowanceDataKey = key;
              break;
            default:
              throw new Error(`Cannot find corresponding key for method: ${methodName}`);
          }
        });

        state.contractKey = address;
        state.loadingTokenizedDerivativeData = false;
        this.setState(state);
      });
  }

  async fetchMarginCurrencyAllowance() {
    const { contractAddress: address } = this.props;
    await this.drizzleHelper.addContract(address, TokenizedDerivative.abi);

    const { result: derivativeStorage } = await this.drizzleHelper.cacheCall(address, "derivativeStorage", []);

    // If margin currency is eth, exit early because authorization is unnecessary.
    if (hasEthMarginCurrency(derivativeStorage)) {
      this.setState({ loadingMarginCurrencyData: false });
      return;
    }

    // Add margin currency contract.
    const marginCurrencyAddress = derivativeStorage.externalAddresses.marginCurrency;
    await this.drizzleHelper.addContract(marginCurrencyAddress, IERC20.abi);

    // Get the current user's allowance.
    const account = this.props.drizzleState.accounts[0];
    const { key: marginCurrencyAllowanceDataKey } = await this.drizzleHelper.cacheCall(
      marginCurrencyAddress,
      "allowance",
      [account, address]
    );

    // Set key for both the margin currency's address and the allowance call.
    this.setState({
      loadingMarginCurrencyData: false,
      marginCurrencyKey: marginCurrencyAddress,
      marginCurrencyAllowanceDataKey
    });
  }

  async fetchPriceFeedData() {
    const { contractAddress: address } = this.props;
    await this.drizzleHelper.addContract(address, TokenizedDerivative.abi);

    const { result: derivativeStorage } = await this.drizzleHelper.cacheCall(address, "derivativeStorage", []);

    // Get the price feed associated with the contract.
    const priceFeedAddress = derivativeStorage.externalAddresses.priceFeed;
    const priceFeed = await this.drizzleHelper.addContract(priceFeedAddress, ManualPriceFeed.abi);

    // Get the latest price.
    const { key } = await this.drizzleHelper.cacheCall(priceFeed.address, "latestPrice", [
      derivativeStorage.fixedParameters.product
    ]);

    this.setState({ loadingPriceFeedData: false, idDataKey: key });
  }

  addPendingTransaction(initiatedTransactionId) {
    this.setState({ initiatedTransactionId: initiatedTransactionId, isInteractionEnabled: false });
  }

  // Checks for the state of pending transactions, and is responsible for wiping out any form inputs and reenabling
  // interaction after a pending transaction completes. Assumes that there could only be one transaction at a time.
  checkPendingTransaction() {
    if (this.state.initiatedTransactionId == null) {
      // We don't have a transaction right now.
      return;
    }
    const { transactions, transactionStack } = this.props.drizzleState;

    const txHash = transactionStack[this.state.initiatedTransactionId];
    if (!txHash || !(txHash in transactions)) {
      // The transaction is waiting on user confirmation via Metamask.
      return;
    }
    if (transactions[txHash].status === "pending") {
      return;
    }
    // The transaction has completed, either in error or success. Renable the buttons.
    this.setState({
      initiatedTransactionId: null,
      isInteractionEnabled: true,
      formInputs: { depositAmount: "", withdrawAmount: "", createAmount: "", redeemAmount: "" }
    });
  }

  componentWillUnmount() {
    this.unsubscribeTxCheck();
  }

  handleFormChange = (name, event) => {
    const value = event.target.value;
    this.setState(state => {
      return { ...state, formInputs: { ...state.formInputs, [name]: value } };
    });
  };

  remarginContract = () => {
    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.remargin.cacheSend({
      from: this.props.drizzleState.accounts[0]
    });
    this.addPendingTransaction(initiatedTransactionId);
  };

  withdrawMargin = () => {
    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.withdraw.cacheSend(
      this.props.drizzle.web3.utils.toWei(this.state.formInputs.withdrawAmount),
      {
        from: this.props.drizzleState.accounts[0]
      }
    );
    this.addPendingTransaction(initiatedTransactionId);
  };

  depositMargin = () => {
    const { drizzle, drizzleState } = this.props;
    const initiatedTransactionId = drizzle.contracts[this.state.contractKey].methods.deposit.cacheSend(
      drizzle.web3.utils.toWei(this.state.formInputs.depositAmount),
      {
        from: drizzleState.accounts[0],
        value: this.getEthToAttachIfNeeded(drizzle.web3.utils.toWei(this.state.formInputs.depositAmount))
      }
    );
    this.addPendingTransaction(initiatedTransactionId);
  };

  createTokens = () => {
    const contractState = this.props.drizzleState.contracts[this.state.contractKey];
    const web3 = this.props.drizzle.web3;
    const estimatedTokenValue = web3.utils.toBN(
      contractState.calcTokenValue[this.state.estimatedTokenValueDataKey].value
    );
    const numTokensInWei = web3.utils.toBN(web3.utils.toWei(this.state.formInputs.createAmount));
    const marginCurrencyAmount = estimatedTokenValue
      .mul(numTokensInWei)
      .div(web3.utils.toBN(web3.utils.toWei("1", "ether")));

    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.createTokens.cacheSend(
      marginCurrencyAmount.toString(),
      web3.utils.toWei(this.state.formInputs.createAmount),
      {
        from: this.props.drizzleState.accounts[0],
        value: this.getEthToAttachIfNeeded(marginCurrencyAmount)
      }
    );
    this.addPendingTransaction(initiatedTransactionId);
  };

  redeemTokens = () => {
    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.redeemTokens.cacheSend(
      this.props.drizzle.web3.utils.toWei(this.state.formInputs.redeemAmount),
      {
        from: this.props.drizzleState.accounts[0]
      }
    );
    this.addPendingTransaction(initiatedTransactionId);
  };

  getEthToAttachIfNeeded(marginCurrencyAmount) {
    // If the contract's margin currency is ETH, we need to send `marginCurrencyAmount` along with some method calls.
    // If the contract uses an ERC20 margin currency, we send 0 ETH and rely on the contract being pre-approved to
    // pull margin currency.
    const derivativeStorage = this.props.drizzleState.contracts[this.state.contractKey].derivativeStorage[
      this.state.derivativeStorageDataKey
    ].value;
    if (hasEthMarginCurrency(derivativeStorage)) {
      return marginCurrencyAmount;
    } else {
      return "0";
    }
  }

  // Approves the TokenizedDerivative to spend a large number of its own tokens from the user.
  approveDerivativeTokens = () => {
    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.approve.cacheSend(
      this.props.contractAddress,
      UINT_MAX,
      {
        from: this.props.drizzleState.accounts[0]
      }
    );
    this.addPendingTransaction(initiatedTransactionId);
  };

  // Approves the TokenizedDerivative to spend a large number of margin currency tokens from the user.
  approveMarginCurrency = () => {
    const initiatedTransactionId = this.props.drizzle.contracts[this.state.marginCurrencyKey].methods.approve.cacheSend(
      this.props.contractAddress,
      UINT_MAX,
      {
        from: this.props.drizzleState.accounts[0]
      }
    );
    this.addPendingTransaction(initiatedTransactionId);
  };

  // Converts a string or BN instance from Wei to Ether, e.g., 1e19 -> 10.
  fromWei(num) {
    // Web3's `fromWei` function doesn't work on BN objects in minified mode (e.g.,
    // `web3.utils.isBN(web3.utils.fromBN("5"))` is false), so we use a workaround where we always pass in strings.
    // See https://github.com/ethereum/web3.js/issues/1777.
    return this.props.drizzle.web3.utils.fromWei(num.toString());
  }

  render() {
    if (
      this.state.loadingTokenizedDerivativeData ||
      this.state.loadingPriceFeedData ||
      this.state.loadingMarginCurrencyData
    ) {
      return <div>Looking up contract details...</div>;
    }
    const { drizzle, drizzleState } = this.props;
    const web3 = drizzle.web3;

    const contract = drizzleState.contracts[this.state.contractKey];
    const derivativeStorage = contract.derivativeStorage[this.state.derivativeStorageDataKey].value;
    const totalSupply = this.fromWei(contract.totalSupply[this.state.totalSupplyDataKey].value);
    const contractName = contract.name[this.state.nameDataKey].value;
    const estimatedTokenValue = web3.utils.toBN(contract.calcTokenValue[this.state.estimatedTokenValueDataKey].value);
    const estimatedNav = web3.utils.toBN(contract.calcNAV[this.state.estimatedNavDataKey].value);
    const estimatedShortMarginBalance = web3.utils.toBN(
      contract.calcShortMarginBalance[this.state.estimatedShortMarginBalanceDataKey].value
    );
    const tokenBalance = this.fromWei(contract.balanceOf[this.state.tokenBalanceDataKey].value);
    const priceFeedAddress = derivativeStorage.externalAddresses.priceFeed;
    const latestPrice = drizzleState.contracts[priceFeedAddress].latestPrice[this.state.idDataKey].value;

    let contractState = stateToString(derivativeStorage.state);
    const lastRemarginContractFinancials = {
      time: formatDate(derivativeStorage.currentTokenState.time, web3),
      assetPrice: this.fromWei(derivativeStorage.currentTokenState.underlyingPrice),
      tokenPrice: this.fromWei(derivativeStorage.currentTokenState.tokenPrice) + "/token",
      // NOTE: this method of getting totalHoldings explicitly disregards any margin currency sent to the contract not
      // through Deposit.
      totalHoldings: this.fromWei(
        web3.utils.toBN(derivativeStorage.longBalance).add(web3.utils.toBN(derivativeStorage.shortBalance))
      ),
      longMargin: this.fromWei(derivativeStorage.longBalance),
      shortMargin: this.fromWei(derivativeStorage.shortBalance),
      tokenSupply: totalSupply,
      yourTokens: tokenBalance
    };
    const estimatedCurrentContractFinancials = {
      time: formatDate(latestPrice.publishTime, web3),
      assetPrice: this.fromWei(latestPrice.price),
      tokenPrice: this.fromWei(estimatedTokenValue) + "/token",
      totalHoldings: this.fromWei(estimatedNav.add(estimatedShortMarginBalance)),
      longMargin: this.fromWei(estimatedNav),
      shortMargin: this.fromWei(estimatedShortMarginBalance),
      // These values don't change on remargins.
      tokenSupply: totalSupply,
      yourTokens: tokenBalance
    };
    const contractParameters = {
      contractAddress: this.props.contractAddress,
      creatorAddress: derivativeStorage.externalAddresses.sponsor,
      creationTime: "UNKNOWN",
      // The TokenizedDerivative smart contract uses this value `~uint(0)` as a sentinel to indicate no expiry.
      expiryTime: derivativeStorage.endTime === UINT_MAX ? "None" : formatDate(derivativeStorage.endTime, web3),
      priceFeedAddress: derivativeStorage.externalAddresses.priceFeed,
      marginCurrency: hasEthMarginCurrency(derivativeStorage)
        ? "ETH"
        : derivativeStorage.externalAddresses.marginCurrency,
      returnCalculator: derivativeStorage.externalAddresses.returnCalculator
    };

    // In order to interact with contract methods, the user must have first approved at least this much in derivative
    // token and margin currency transfers. This value is chosen to be half of the value we will attempt to approve,
    // so even as the approval gets used up, the user never needs to reapprove.
    const minAllowance = web3.utils.toBN(UINT_MAX).divRound(web3.utils.toBN("2"));
    let interactions;
    const isDerivativeTokenAuthorized = web3.utils
      .toBN(contract.allowance[this.state.derivativeTokenAllowanceDataKey].value)
      .gte(minAllowance);
    const isMarginCurrencyAuthorized =
      hasEthMarginCurrency(derivativeStorage) ||
      web3.utils
        .toBN(
          drizzleState.contracts[this.state.marginCurrencyKey].allowance[this.state.marginCurrencyAllowanceDataKey]
            .value
        )
        .gte(minAllowance);
    // We either present the user with the buttons to pre-authorize the contract, or if they've already preauthorized,
    // with the buttons to deposit, remargin, etc.
    if (!isDerivativeTokenAuthorized || !isMarginCurrencyAuthorized) {
      interactions = (
        <TokenPreapproval
          isInteractionEnabled={this.state.isInteractionEnabled}
          isDerivativeTokenAuthorized={isDerivativeTokenAuthorized}
          isMarginCurrencyAuthorized={isMarginCurrencyAuthorized}
          approveDerivativeTokensFn={this.approveDerivativeTokens}
          approveMarginCurrencyFn={this.approveMarginCurrency}
        />
      );
    } else {
      interactions = (
        <ContractInteraction
          remarginFn={this.remarginContract}
          depositFn={this.depositMargin}
          withdrawFn={this.withdrawMargin}
          createFn={this.createTokens}
          redeemFn={this.redeemTokens}
          formInputs={this.state.formInputs}
          handleChangeFn={this.handleFormChange}
          isInteractionEnabled={this.state.isInteractionEnabled}
        />
      );
    }

    return (
      <div>
        <div>
          {contractName} ({derivativeStorage.fixedParameters.symbol})
        </div>
        <div>Contract status: {contractState}</div>
        <ContractParameters parameters={contractParameters} />
        <ContractFinancialsTable
          lastRemargin={lastRemarginContractFinancials}
          estimatedCurrent={estimatedCurrentContractFinancials}
        />
        {interactions}
      </div>
    );
  }
}

export default ContractDetails;
