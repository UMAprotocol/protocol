import React, { Component } from "react";
import ContractFinancialsTable from "./ContractFinancialsTable.js";
import ContractParameters from "./ContractParameters.js";
import ContractInteraction from "./ContractInteraction.js";
import TokenizedDerivative from "../contracts/TokenizedDerivative.json";
import IERC20 from "../contracts/IERC20.json";
import TokenPreapproval from "./TokenPreapproval.js";
import ManualPriceFeed from "../contracts/ManualPriceFeed.json";
import { stateToString } from "../utils/TokenizedDerivativeUtils.js";

// Used to track the status of follow up requests via Drizzle.
// We are still trying to discover a good idiom for making follow up requests with Drizzle.
const FollowUpRequestsStatus = {
  UNSENT: 1,
  WAITING_ON_CONTRACT: 2,
  SENT: 3
};
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
    const { drizzle, drizzleState } = this.props;
    // Use the contractAddress as the contractKey, so that ContractDetails can be pulled up for separate
    // contracts without colliding.
    const contractKey = this.props.contractAddress;
    const contractConfig = {
      contractName: contractKey,
      web3Contract: new drizzle.web3.eth.Contract(TokenizedDerivative.abi, this.props.contractAddress)
    };
    drizzle.addContract(contractConfig);

    const contractMethods = drizzle.contracts[contractKey].methods;

    this.priceFeedRequestsStatus = FollowUpRequestsStatus.UNSENT;
    this.marginCurrencyRequestsStatus = FollowUpRequestsStatus.UNSENT;
    this.setState({
      contractKey: contractKey,
      derivativeStorageDataKey: contractMethods.derivativeStorage.cacheCall(),
      totalSupplyDataKey: contractMethods.totalSupply.cacheCall(),
      nameDataKey: contractMethods.name.cacheCall(),
      estimatedTokenValueDataKey: contractMethods.calcTokenValue.cacheCall(),
      estimatedNavDataKey: contractMethods.calcNAV.cacheCall(),
      estimatedShortMarginBalanceDataKey: contractMethods.calcShortMarginBalance.cacheCall(),
      tokenBalanceDataKey: contractMethods.balanceOf.cacheCall(drizzleState.accounts[0], {}),
      derivativeTokenAllowanceDataKey: contractMethods.allowance.cacheCall(
        drizzleState.accounts[0],
        this.props.contractAddress,
        {}
      )
    });

    this.unsubscribeTokenizedDerivativeCheck = drizzle.store.subscribe(() => {
      this.waitOnTokenizedDerivativeFetch();
    });
    this.unsubscribePriceFeedFetch = drizzle.store.subscribe(() => {
      this.fetchPriceFeedData();
    });
    this.unsubscribeMarginCurrencyCheck = drizzle.store.subscribe(() => {
      this.fetchMarginCurrencyAllowance();
    });
    this.unsubscribeTxCheck = drizzle.store.subscribe(() => {
      this.checkPendingTransaction();
    });
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
  // Waits on the initial data fetch from TokenizedDerivative being available.
  waitOnTokenizedDerivativeFetch() {
    const { drizzleState } = this.props;

    const isContractInStore = this.state.contractKey in drizzleState.contracts;
    if (!isContractInStore) {
      return;
    }
    const contract = drizzleState.contracts[this.state.contractKey];

    const areAllMethodValuesAvailable =
      this.state.derivativeStorageDataKey in contract.derivativeStorage &&
      this.state.totalSupplyDataKey in contract.totalSupply &&
      this.state.nameDataKey in contract.name &&
      this.state.estimatedTokenValueDataKey in contract.calcTokenValue &&
      this.state.estimatedNavDataKey in contract.calcNAV &&
      this.state.estimatedShortMarginBalanceDataKey in contract.calcShortMarginBalance &&
      this.state.tokenBalanceDataKey in contract.balanceOf &&
      this.state.derivativeTokenAllowanceDataKey in contract.allowance;
    if (!areAllMethodValuesAvailable) {
      return;
    }
    this.setState({ loadingTokenizedDerivativeData: false });
    this.unsubscribeTokenizedDerivativeCheck();
  }

  // Requires `derivativeStorage` to have been fetched, and then fetches the margin currency allowance.
  fetchMarginCurrencyAllowance() {
    const { drizzle, drizzleState } = this.props;

    const isContractInStore = this.state.contractKey in drizzleState.contracts;
    if (!isContractInStore) {
      return;
    }
    const contract = drizzleState.contracts[this.state.contractKey];

    if (!(this.state.derivativeStorageDataKey in contract.derivativeStorage)) {
      return;
    }
    const derivativeStorage = contract.derivativeStorage[this.state.derivativeStorageDataKey].value;

    if (this.hasEthMarginCurrency(derivativeStorage)) {
      // Nothing to authorize, we're done.
      this.setState({ loadingMarginCurrencyData: false });
      this.unsubscribeMarginCurrencyCheck();
    }

    const marginCurrencyAddress = derivativeStorage.externalAddresses.marginCurrency;
    // Use the address as the key to be able to pull up info for different margin currencies
    const marginCurrencyKey = marginCurrencyAddress;
    switch (this.marginCurrencyRequestsStatus) {
      case FollowUpRequestsStatus.UNSENT:
        this.marginCurrencyRequestsStatus = FollowUpRequestsStatus.WAITING_ON_CONTRACT;
        const marginCurrencyContractConfig = {
          contractName: marginCurrencyKey,
          web3Contract: new drizzle.web3.eth.Contract(IERC20.abi, marginCurrencyAddress)
        };
        drizzle.addContract(marginCurrencyContractConfig);
        return;
      case FollowUpRequestsStatus.WAITING_ON_CONTRACT:
        if (!(marginCurrencyKey in drizzle.contracts)) {
          return;
        }
        this.marginCurrencyRequestsStatus = FollowUpRequestsStatus.SENT;
        this.setState({
          marginCurrencyAllowanceDataKey: drizzle.contracts[marginCurrencyKey].methods.allowance.cacheCall(
            drizzleState.accounts[0],
            this.props.contractAddress,
            {}
          )
        });
        return;
      case FollowUpRequestsStatus.SENT:
      default:
      // Now we can continue on to checking whether marginCurrencyKey has retrieved a value.
    }

    const isMarginCurrencyAllowanceAvailable =
      this.state.marginCurrencyAllowanceDataKey in drizzleState.contracts[marginCurrencyKey].allowance;
    if (!isMarginCurrencyAllowanceAvailable) {
      return;
    }

    // All the data is now available.
    this.setState({ loadingMarginCurrencyData: false, marginCurrencyKey: marginCurrencyKey });
    this.unsubscribeMarginCurrencyCheck();
  }

  // Requires `derivativeStorage` to have been fetched, and then fetches price feed data.
  fetchPriceFeedData() {
    const { drizzle, drizzleState } = this.props;

    const isContractInStore = this.state.contractKey in drizzleState.contracts;
    if (!isContractInStore) {
      return;
    }
    const contract = drizzleState.contracts[this.state.contractKey];

    const areAllMethodValuesAvailable =
      this.state.derivativeStorageDataKey in contract.derivativeStorage &&
      this.state.totalSupplyDataKey in contract.totalSupply &&
      this.state.nameDataKey in contract.name &&
      this.state.estimatedTokenValueDataKey in contract.calcTokenValue &&
      this.state.estimatedNavDataKey in contract.calcNAV &&
      this.state.estimatedShortMarginBalanceDataKey in contract.calcShortMarginBalance &&
      this.state.tokenBalanceDataKey in contract.balanceOf &&
      this.state.derivativeTokenAllowanceDataKey in contract.allowance;
    if (!areAllMethodValuesAvailable) {
      return;
    }

    const derivativeStorage = contract.derivativeStorage[this.state.derivativeStorageDataKey].value;

    const priceFeedAddress = derivativeStorage.externalAddresses.priceFeed;
    switch (this.priceFeedRequestsStatus) {
      case FollowUpRequestsStatus.UNSENT:
        this.priceFeedRequestsStatus = FollowUpRequestsStatus.WAITING_ON_CONTRACT;
        const priceFeedContractConfig = {
          contractName: priceFeedAddress,
          web3Contract: new drizzle.web3.eth.Contract(ManualPriceFeed.abi, priceFeedAddress)
        };
        drizzle.addContract(priceFeedContractConfig);
        return;
      case FollowUpRequestsStatus.WAITING_ON_CONTRACT:
        if (!(priceFeedAddress in drizzle.contracts)) {
          return;
        }
        this.priceFeedRequestsStatus = FollowUpRequestsStatus.SENT;
        this.setState({
          idDataKey: drizzle.contracts[priceFeedAddress].methods.latestPrice.cacheCall(
            derivativeStorage.fixedParameters.product,
            {}
          )
        });
        return;
      case FollowUpRequestsStatus.SENT:
      default:
      // Now we can continue on to checking whether idDataKey has retrieved a value.
    }

    const isLatestPriceAvailable = this.state.idDataKey in drizzleState.contracts[priceFeedAddress].latestPrice;
    if (!isLatestPriceAvailable) {
      return;
    }

    // All the data is now available.
    this.setState({ loadingPriceFeedData: false });
    this.unsubscribePriceFeedFetch();
  }

  componentWillUnmount() {
    this.unsubscribePriceFeedFetch();
    this.unsubscribeMarginCurrencyCheck();
    this.unsubscribeTokenizedDerivativeCheck();
    this.unsubscribeTxCheck();
  }

  handleFormChange = (name, event) => {
    const value = event.target.value;
    this.setState(state => {
      return { ...state, formInputs: { ...state.formInputs, [name]: value } };
    });
  };

  remarginContract = () => {
    // TODO(ptare): Figure out how to listen to the state of this transaction, and disable the 'Remargin' button while
    // a remargin is pending.
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
    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.deposit.cacheSend({
      from: this.props.drizzleState.accounts[0],
      value: this.getEthToAttachIfNeeded(this.props.drizzle.web3.utils.toWei(this.state.formInputs.depositAmount))
    });
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
      web3.utils.toWei(this.state.formInputs.createAmount),
      {
        from: this.props.drizzleState.accounts[0],
        value: this.getEthToAttachIfNeeded(marginCurrencyAmount)
      }
    );
    this.addPendingTransaction(initiatedTransactionId);
  };

  redeemTokens = () => {
    // TODO(mrice32): The contract's `redeemTokens` method doesn't currently take an argument, so this call doesn't
    // work until the contract is updated.
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
    if (this.hasEthMarginCurrency(derivativeStorage)) {
      return marginCurrencyAmount;
    } else {
      return "0";
    }
  }

  hasEthMarginCurrency(derivativeStorage) {
    // The TokenizedDerivative smart contract uses this value to indicate using ETH as the margin currency.
    const sentinelMarginCurrency = "0x0000000000000000000000000000000000000000";
    return derivativeStorage.externalAddresses.marginCurrency === sentinelMarginCurrency;
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
    const derivativeStorage = this.props.drizzleState.contracts[this.state.contractKey].derivativeStorage[
      this.state.derivativeStorageDataKey
    ].value;
    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.approve.cacheSend(
      derivativeStorage.externalAddresses.marginCurrency,
      UINT_MAX,
      {
        from: this.props.drizzleState.accounts[0]
      }
    );
    this.addPendingTransaction(initiatedTransactionId);
  };

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
    const totalSupply = web3.utils.fromWei(contract.totalSupply[this.state.totalSupplyDataKey].value);
    const contractName = contract.name[this.state.nameDataKey].value;
    const estimatedTokenValue = web3.utils.toBN(contract.calcTokenValue[this.state.estimatedTokenValueDataKey].value);
    const estimatedNav = web3.utils.toBN(contract.calcNAV[this.state.estimatedNavDataKey].value);
    const estimatedShortMarginBalance = web3.utils.toBN(
      contract.calcShortMarginBalance[this.state.estimatedShortMarginBalanceDataKey].value
    );
    const tokenBalance = web3.utils.fromWei(contract.balanceOf[this.state.tokenBalanceDataKey].value);
    const priceFeedAddress = derivativeStorage.externalAddresses.priceFeed;
    const latestPrice = drizzleState.contracts[priceFeedAddress].latestPrice[this.state.idDataKey].value;

    let contractState = stateToString(derivativeStorage.state);

    const lastRemarginContractFinancials = {
      time: ContractDetails.formatDate(derivativeStorage.currentTokenState.time, web3),
      assetPrice: web3.utils.fromWei(derivativeStorage.currentTokenState.underlyingPrice),
      tokenPrice: web3.utils.fromWei(derivativeStorage.currentTokenState.tokenPrice) + "/token",
      // NOTE: this method of getting totalHoldings explicitly disregards any margin currency sent to the contract not
      // through Deposit.
      totalHoldings: web3.utils.fromWei(
        web3.utils.toBN(derivativeStorage.longBalance).add(web3.utils.toBN(derivativeStorage.shortBalance))
      ),
      longMargin: web3.utils.fromWei(derivativeStorage.longBalance),
      shortMargin: web3.utils.fromWei(derivativeStorage.shortBalance),
      tokenSupply: totalSupply,
      yourTokens: tokenBalance
    };
    const estimatedCurrentContractFinancials = {
      time: ContractDetails.formatDate(latestPrice.publishTime, web3),
      assetPrice: web3.utils.fromWei(latestPrice.price),
      tokenPrice: web3.utils.fromWei(estimatedTokenValue) + "/token",
      totalHoldings: web3.utils.fromWei(estimatedNav.add(estimatedShortMarginBalance)),
      longMargin: web3.utils.fromWei(estimatedNav),
      shortMargin: web3.utils.fromWei(estimatedShortMarginBalance),
      // These values don't change on remargins.
      tokenSupply: totalSupply,
      yourTokens: tokenBalance
    };
    const contractParameters = {
      contractAddress: this.props.contractAddress,
      creatorAddress: derivativeStorage.externalAddresses.sponsor,
      creationTime: "UNKNOWN",
      // The TokenizedDerivative smart contract uses this value `~uint(0)` as a sentinel to indicate no expiry.
      expiryTime:
        derivativeStorage.endTime === UINT_MAX ? "None" : ContractDetails.formatDate(derivativeStorage.endTime, web3),
      priceFeedAddress: derivativeStorage.externalAddresses.priceFeed,
      marginCurrency: this.hasEthMarginCurrency(derivativeStorage)
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
      this.hasEthMarginCurrency(derivativeStorage) ||
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

  static formatDate(timestampInSeconds, web3) {
    return new Date(
      parseInt(
        web3.utils
          .toBN(timestampInSeconds)
          .muln(1000)
          .toString(),
        10
      )
    ).toString();
  }
}

export default ContractDetails;
