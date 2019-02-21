import React, { Component } from "react";
import ContractFinancialsTable from "./ContractFinancialsTable.js";
import ContractParameters from "./ContractParameters.js";
import ContractInteraction from "./ContractInteraction.js";
import TokenizedDerivative from "../contracts/TokenizedDerivative.json";
import ManualPriceFeed from "../contracts/ManualPriceFeed.json";

// Used to track the status of price feed requests via Drizzle.
const PriceFeedRequestsStatus = {
  UNSENT: 1,
  WAITING_ON_CONTRACT: 2,
  SENT: 3
};

class ContractDetails extends Component {
  state = { loading: true, formInputs: { depositAmount: "", withdrawAmount: "", createAmount: "", redeemAmount: "" } };

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

    this.priceFeedRequestsStatus = PriceFeedRequestsStatus.UNSENT;
    this.setState({
      contractKey: contractKey,
      derivativeStorageDataKey: contractMethods.derivativeStorage.cacheCall(),
      totalSupplyDataKey: contractMethods.totalSupply.cacheCall(),
      nameDataKey: contractMethods.name.cacheCall(),
      estimatedTokenValueDataKey: contractMethods.calcTokenValue.cacheCall(),
      estimatedNavDataKey: contractMethods.calcNAV.cacheCall(),
      estimatedShortMarginBalanceDataKey: contractMethods.calcShortMarginBalance.cacheCall(),
      tokenBalanceDataKey: contractMethods.balanceOf.cacheCall(drizzleState.accounts[0], {})
    });

    this.unsubscribeFn = drizzle.store.subscribe(() => {
      this.fetchAndWaitOnBlockchainData();
    });
  }

  fetchAndWaitOnBlockchainData() {
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
      this.state.tokenBalanceDataKey in contract.balanceOf;
    if (!areAllMethodValuesAvailable) {
      return;
    }

    const derivativeStorage = contract.derivativeStorage[this.state.derivativeStorageDataKey].value;

    const priceFeedAddress = derivativeStorage.externalAddresses.priceFeed;
    switch (this.priceFeedRequestsStatus) {
      case PriceFeedRequestsStatus.UNSENT:
        this.priceFeedRequestsStatus = PriceFeedRequestsStatus.WAITING_ON_CONTRACT;
        const contractConfig = {
          contractName: priceFeedAddress,
          web3Contract: new drizzle.web3.eth.Contract(
            ManualPriceFeed.abi,
            derivativeStorage.externalAddresses.priceFeed
          )
        };
        drizzle.addContract(contractConfig);
        return;
      case PriceFeedRequestsStatus.WAITING_ON_CONTRACT:
        if (!(priceFeedAddress in drizzle.contracts)) {
          return;
        }
        this.priceFeedRequestsStatus = PriceFeedRequestsStatus.SENT;
        this.setState({
          idDataKey: drizzle.contracts[priceFeedAddress].methods.latestPrice.cacheCall(
            derivativeStorage.fixedParameters.product,
            {}
          )
        });
        return;
      case PriceFeedRequestsStatus.SENT:
      default:
      // Now we can continue on to checking whether idDataKey has retrieved a value.
    }

    const isLatestPriceAvailable = this.state.idDataKey in drizzleState.contracts[priceFeedAddress].latestPrice;
    if (!isLatestPriceAvailable) {
      return;
    }

    // All the data is now available.
    this.setState({ loading: false });
    this.unsubscribeFn();
  }

  componentWillUnmount() {
    this.unsubscribeFn();
  }

  handleFormChange = (name, event) => {
    const newFormInputs = this.state.formInputs;
    newFormInputs[name] = event.target.value;
    this.setState({ formInputs: newFormInputs });
  };

  resetForm = () => {
    this.setState({ formInputs: { depositAmount: "", withdrawAmount: "", createAmount: "", redeemAmount: "" } });
  };

  remarginContract = () => {
    // TODO(ptare): Figure out how to listen to the state of this transaction, and disable the 'Remargin' button while
    // a remargin is pending.
    this.props.drizzle.contracts[this.state.contractKey].methods.remargin.cacheSend({
      from: this.props.drizzleState.accounts[0]
    });
    this.resetForm();
  };

  withdrawMargin = () => {
    this.props.drizzle.contracts[this.state.contractKey].methods.withdraw.cacheSend(
      this.props.drizzle.web3.utils.toWei(this.state.formInputs.withdrawAmount),
      {
        from: this.props.drizzleState.accounts[0]
      }
    );
    this.resetForm();
  };

  depositMargin = () => {
    this.props.drizzle.contracts[this.state.contractKey].methods.deposit.cacheSend({
      from: this.props.drizzleState.accounts[0],
      value: this.getEthToAttachIfNeeded(this.props.drizzle.web3.utils.toWei(this.state.formInputs.depositAmount))
    });
    this.resetForm();
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

    this.props.drizzle.contracts[this.state.contractKey].methods.createTokens.cacheSend(
      web3.utils.toWei(this.state.formInputs.createAmount),
      {
        from: this.props.drizzleState.accounts[0],
        value: this.getEthToAttachIfNeeded(marginCurrencyAmount)
      }
    );
    this.resetForm();
  };

  redeemTokens = () => {
    // TODO(mrice32): The contract's `redeemTokens` method doesn't currently take an argument, so this call doesn't
    // work until the contract is updated.
    this.props.drizzle.contracts[this.state.contractKey].methods.redeemTokens.cacheSend(
      this.props.drizzle.web3.utils.toWei(this.state.formInputs.redeemAmount),
      {
        from: this.props.drizzleState.accounts[0]
      }
    );
    this.resetForm();
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

  render() {
    if (this.state.loading) {
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

    // TODO(ptare): Extract to some common library.
    let contractState;
    switch (derivativeStorage.state) {
      case "0":
        contractState = "Live";
        break;
      case "1":
        contractState = "Disputed";
        break;
      case "2":
        contractState = "Expired";
        break;
      case "3":
        contractState = "Defaulted";
        break;
      case "4":
        contractState = "Emergency";
        break;
      case "5":
        contractState = "Settled";
        break;
      default:
      // Getting here means that the enums in the contract and here have drifted.
    }
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
    // The TokenizedDerivative smart contract uses this value `~uint(0)` as a sentinel to indicate no expiry.
    const sentinelExpiryTime = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const contractParameters = {
      contractAddress: this.props.contractAddress,
      creatorAddress: derivativeStorage.externalAddresses.sponsor,
      creationTime: "UNKNOWN",
      expiryTime:
        derivativeStorage.endTime === sentinelExpiryTime
          ? "None"
          : ContractDetails.formatDate(derivativeStorage.endTime, web3),
      priceFeedAddress: derivativeStorage.externalAddresses.priceFeed,
      marginCurrency: this.hasEthMarginCurrency(derivativeStorage)
        ? "ETH"
        : derivativeStorage.externalAddresses.marginCurrency,
      returnCalculator: derivativeStorage.externalAddresses.returnCalculator
    };

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
        <ContractInteraction
          remarginFn={this.remarginContract}
          depositFn={this.depositMargin}
          withdrawFn={this.withdrawMargin}
          createFn={this.createTokens}
          redeemFn={this.redeemTokens}
          formInputs={this.state.formInputs}
          handleChangeFn={this.handleFormChange}
        />
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
