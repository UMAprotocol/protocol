import React, { Component } from "react";
import ContractFinancialsTable from "./ContractFinancialsTable.js";
import ContractParameters from "./ContractParameters.js";
import ContractInteraction from "./ContractInteraction.js";
import TokenizedDerivative from "../contracts/TokenizedDerivative.json";
import IERC20 from "../contracts/IERC20.json";
import TokenPreapproval from "./TokenPreapproval.js";
import ManualPriceFeed from "../contracts/ManualPriceFeed.json";
import { ContractStateEnum, hasEthMarginCurrency, stateToString } from "../utils/TokenizedDerivativeUtils.js";
import { currencyAddressToName } from "../utils/ParameterLookupUtils.js";
import { formatDate } from "../utils/FormattingUtils.js";
import { withStyles } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";
import DrizzleHelper from "../utils/DrizzleHelper.js";
import ReactGA from "react-ga";
import LeveragedReturnCalculator from "../contracts/LeveragedReturnCalculator";

const styles = theme => ({
  root: {
    minWidth: 900,
    margin: "0px 26px 26px 26px"
  },
  titleSection: {
    display: "flex",
    width: "100%"
  },
  title: {
    flexGrow: 1
  }
});

// Corresponds to `~uint(0)` in Solidity.
const UINT_MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

class ContractDetails extends Component {
  state = {
    loadingTokenizedDerivativeData: true,
    loadingPriceFeedData: true,
    loadingMarginCurrencyData: true,
    loadingLeverage: true,
    isInteractionEnabled: true,
    initiatedTransactionId: null,
    formInputs: { depositAmount: "", withdrawAmount: "", createAmount: "", redeemAmount: "" }
  };

  componentDidMount() {
    const { drizzle, contractAddress } = this.props;
    if (process.env.NODE_ENV === "production") {
      ReactGA.modalview("/contractdetails");
    }

    this.drizzleHelper = new DrizzleHelper(drizzle);

    Promise.all([
      this.getContract(),
      this.fetchPriceFeedData(),
      this.fetchMarginCurrencyAllowance(),
      this.fetchLeverage()
    ]).catch(error => {
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
        { address, methodName: "getCurrentRequiredMargin", args: [] },
        { address, methodName: "calcTokenValue", args: [] },
        { address, methodName: "calcNAV", args: [] },
        { address, methodName: "calcShortMarginBalance", args: [] },
        { address, methodName: "calcExcessMargin", args: [] },
        { address, methodName: "getUpdatedUnderlyingPrice", args: [] },
        { address, methodName: "balanceOf", args: [account] },
        { address, methodName: "allowance", args: [account, address] },
        { address, methodName: "canBeSettled", args: [] }
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
            case "getCurrentRequiredMargin":
              state.getCurrentRequiredMarginDataKey = key;
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
            case "calcExcessMargin":
              state.estimatedExcessMarginDataKey = key;
              break;
            case "getUpdatedUnderlyingPrice":
              state.getUpdatedUnderlyingPriceDataKey = key;
              break;
            case "balanceOf":
              state.tokenBalanceDataKey = key;
              break;
            case "allowance":
              state.derivativeTokenAllowanceDataKey = key;
              break;
            case "canBeSettled":
              state.canBeSettledKey = key;
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

  async fetchLeverage() {
    const { contractAddress: address } = this.props;
    await this.drizzleHelper.addContract(address, TokenizedDerivative.abi);

    const { result: derivativeStorage } = await this.drizzleHelper.cacheCall(address, "derivativeStorage", []);

    // Get the return calculator associated with the contract.
    const returnCalculatorAddress = derivativeStorage.externalAddresses.returnCalculator;
    const returnCalculator = await this.drizzleHelper.addContract(
      returnCalculatorAddress,
      LeveragedReturnCalculator.abi
    );

    // Get the leverage.
    const { key } = await this.drizzleHelper.cacheCall(returnCalculator.address, "leverage", []);

    this.setState({ loadingLeverage: false, leverageDataKey: key });
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

  getMarginCurrencyAmountForTokens() {
    if (!this.state.formInputs.createAmount) {
      return null;
    }
    const contractState = this.props.drizzleState.contracts[this.state.contractKey];
    const web3 = this.props.drizzle.web3;
    const estimatedTokenValue = web3.utils.toBN(
      contractState.calcTokenValue[this.state.estimatedTokenValueDataKey].value
    );
    const numTokensInWei = web3.utils.toBN(web3.utils.toWei(this.state.formInputs.createAmount));

    // Mirror the computation done by TokenizedDerivative when determining how much margin currency is required,
    // specifically, rounding up instead of truncating.
    const preDivisionMarginCurrency = estimatedTokenValue.mul(numTokensInWei);
    const fp_multiplier = web3.utils.toBN(web3.utils.toWei("1", "ether"));
    const ceilAddition = preDivisionMarginCurrency.mod(fp_multiplier).isZero() ? 0 : 1;
    const marginCurrencyAmount = preDivisionMarginCurrency.div(fp_multiplier).addn(ceilAddition);
    return marginCurrencyAmount;
  }

  remarginContract = () => {
    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.remargin.cacheSend({
      from: this.props.drizzleState.accounts[0]
    });
    this.addPendingTransaction(initiatedTransactionId);
  };

  settleContract = () => {
    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.settle.cacheSend({
      from: this.props.drizzleState.accounts[0]
    });
    this.addPendingTransaction(initiatedTransactionId);
  };

  withdrawMargin = () => {
    if (!this.state.formInputs.withdrawAmount) {
      return;
    }

    const initiatedTransactionId = this.props.drizzle.contracts[this.state.contractKey].methods.withdraw.cacheSend(
      this.props.drizzle.web3.utils.toWei(this.state.formInputs.withdrawAmount),
      {
        from: this.props.drizzleState.accounts[0]
      }
    );
    this.addPendingTransaction(initiatedTransactionId);
  };

  depositMargin = () => {
    if (!this.state.formInputs.depositAmount) {
      return;
    }

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
    if (!this.state.formInputs.createAmount) {
      return;
    }

    const web3 = this.props.drizzle.web3;
    const marginCurrencyAmount = this.getMarginCurrencyAmountForTokens();

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
    if (!this.state.formInputs.redeemAmount) {
      return;
    }

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

  // Gets how the current user is allowed to interact with the contract, i.e., which buttons are presented to them.
  getInteractions() {
    const { drizzle, drizzleState } = this.props;
    const web3 = drizzle.web3;

    const contract = drizzleState.contracts[this.state.contractKey];
    const derivativeStorage = contract.derivativeStorage[this.state.derivativeStorageDataKey].value;
    const contractState = derivativeStorage.state;

    const isTokenSponsor = derivativeStorage.externalAddresses.sponsor === drizzleState.accounts[0];
    if (!isTokenSponsor && contractState !== ContractStateEnum.SETTLED) {
      // Token holders cannot interact with a contract unless the contract is settled.
      return "";
    }

    // In order to interact with contract methods, the user must have first approved at least this much in derivative
    // token and margin currency transfers. This value is chosen to be half of the value we will attempt to approve,
    // so even as the approval gets used up, the user never needs to reapprove.
    const minAllowance = web3.utils.toBN(UINT_MAX).divRound(web3.utils.toBN("2"));
    const isDerivativeTokenAuthorized = web3.utils
      .toBN(contract.allowance[this.state.derivativeTokenAllowanceDataKey].value)
      .gte(minAllowance);
    // We can treat token holders as always having authorized the margin currency, since they never need to send
    // margin currency to the contract.
    const isMarginCurrencyAuthorized =
      !isTokenSponsor ||
      (hasEthMarginCurrency(derivativeStorage) ||
        web3.utils
          .toBN(
            drizzleState.contracts[this.state.marginCurrencyKey].allowance[this.state.marginCurrencyAllowanceDataKey]
              .value
          )
          .gte(minAllowance));

    // We either present the user with the buttons to pre-authorize the contract, or if they've already preauthorized,
    // with the buttons to deposit, remargin, etc.
    if (!isDerivativeTokenAuthorized || !isMarginCurrencyAuthorized) {
      return (
        <TokenPreapproval
          drizzle={this.props.drizzle}
          contractAddress={this.props.contractAddress}
          params={this.props.params}
          isInteractionEnabled={this.state.isInteractionEnabled}
          isDerivativeTokenAuthorized={isDerivativeTokenAuthorized}
          isMarginCurrencyAuthorized={isMarginCurrencyAuthorized}
          approveDerivativeTokensFn={this.approveDerivativeTokens}
          approveMarginCurrencyFn={this.approveMarginCurrency}
        />
      );
    } else {
      return (
        <ContractInteraction
          drizzle={this.props.drizzle}
          params={this.props.params}
          contractAddress={this.props.contractAddress}
          remarginFn={this.remarginContract}
          depositFn={this.depositMargin}
          withdrawFn={this.withdrawMargin}
          createFn={this.createTokens}
          redeemFn={this.redeemTokens}
          settleFn={this.settleContract}
          formInputs={this.state.formInputs}
          estimatedCreateCurrency={this.getMarginCurrencyAmountForTokens()}
          handleChangeFn={this.handleFormChange}
          isInteractionEnabled={this.state.isInteractionEnabled}
          isTokenSponsor={isTokenSponsor}
        />
      );
    }
  }

  render() {
    if (
      this.state.loadingTokenizedDerivativeData ||
      this.state.loadingPriceFeedData ||
      this.state.loadingMarginCurrencyData ||
      this.state.loadingLeverage
    ) {
      return <Typography variant="body2">Looking up contract details...</Typography>;
    }
    const { drizzle, drizzleState, params } = this.props;
    const web3 = drizzle.web3;

    const contract = drizzleState.contracts[this.state.contractKey];
    const derivativeStorage = contract.derivativeStorage[this.state.derivativeStorageDataKey].value;
    const contractName = contract.name[this.state.nameDataKey].value;

    let contractState = stateToString(derivativeStorage.state);
    const marginCurrencyDisplayName = currencyAddressToName(params, derivativeStorage.externalAddresses.marginCurrency);
    const contractParameters = {
      contractAddress: this.props.contractAddress,
      creatorAddress: derivativeStorage.externalAddresses.sponsor,
      creationTime: formatDate(derivativeStorage.fixedParameters.creationTime, web3),
      // The TokenizedDerivative smart contract uses this value `~uint(0)` as a sentinel to indicate no expiry.
      expiryTime: derivativeStorage.endTime === UINT_MAX ? "None" : formatDate(derivativeStorage.endTime, web3),
      priceFeedAddress:
        web3.utils.hexToAscii(derivativeStorage.fixedParameters.product) +
        ` (${derivativeStorage.externalAddresses.priceFeed})`,
      marginCurrency: marginCurrencyDisplayName
        ? `${marginCurrencyDisplayName} (${derivativeStorage.externalAddresses.marginCurrency})`
        : derivativeStorage.externalAddresses.marginCurrency,
      returnCalculator: derivativeStorage.externalAddresses.returnCalculator
    };

    return (
      <div className={this.props.classes.root}>
        <div className={this.props.classes.titleSection}>
          <Typography component="h1" variant="h4" className={this.props.classes.title}>
            {contractName} ({derivativeStorage.fixedParameters.symbol})
          </Typography>
          <Typography component="h2" variant="h5">
            Contract status: {contractState}
          </Typography>
        </div>
        <ContractParameters parameters={contractParameters} />
        <ContractFinancialsTable drizzle={drizzle} contractAddress={this.props.contractAddress} params={params} />
        {this.getInteractions()}
      </div>
    );
  }
}

export default withStyles(styles)(ContractDetails);
