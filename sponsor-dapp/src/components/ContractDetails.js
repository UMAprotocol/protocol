import React, { Component } from "react";
import ContractFinancialsTable from "./ContractFinancialsTable.js";
import ContractParameters from "./ContractParameters.js";
import TokenizedDerivative from "../contracts/TokenizedDerivative.json";
import ManualPriceFeed from "../contracts/ManualPriceFeed.json";

// Used to track the status of price feed requests via Drizzle.
const PriceFeedRequestsStatus = {
  UNSENT: 1,
  WAITING_ON_CONTRACT: 2,
  SENT: 3
};

class ContractDetails extends Component {
  state = { loading: true };

  componentDidMount() {
    const { drizzle } = this.props;
    // Use the contractAddress as the contractKey, so that ContractDetails can be pulled up for separate
    // contracts without colliding.
    this.contractKey = this.props.contractAddress;
    const contractConfig = {
      contractName: this.contractKey,
      web3Contract: new drizzle.web3.eth.Contract(TokenizedDerivative.abi, this.props.contractAddress)
    };
    drizzle.addContract(contractConfig);

    const contractMethods = drizzle.contracts[this.contractKey].methods;
    this.derivativeStorageDataKey = contractMethods.derivativeStorage.cacheCall();
    this.totalSupplyDataKey = contractMethods.totalSupply.cacheCall();
    this.nameDataKey = contractMethods.name.cacheCall();
    this.estimatedTokenValueDataKey = contractMethods.calcTokenValue.cacheCall();
    this.estimatedNavDataKey = contractMethods.calcNAV.cacheCall();
    this.estimatedShortMarginBalanceDataKey = contractMethods.calcShortMarginBalance.cacheCall();
    this.priceFeedRequestsStatus = PriceFeedRequestsStatus.UNSENT;

    this.unsubscribeFn = drizzle.store.subscribe(() => {
      this.fetchAndWaitOnBlockchainData();
    });
  }

  fetchAndWaitOnBlockchainData() {
    const { drizzle, drizzleState } = this.props;

    const isContractInStore = this.contractKey in drizzleState.contracts;
    if (!isContractInStore) {
      return;
    }
    const contract = drizzleState.contracts[this.contractKey];

    const areAllMethodValuesAvailable =
      this.derivativeStorageDataKey in contract.derivativeStorage &&
      this.totalSupplyDataKey in contract.totalSupply &&
      this.nameDataKey in contract.name &&
      this.estimatedTokenValueDataKey in contract.calcTokenValue &&
      this.estimatedNavDataKey in contract.calcNAV &&
      this.estimatedShortMarginBalanceDataKey in contract.calcShortMarginBalance;
    if (!areAllMethodValuesAvailable) {
      return;
    }

    const derivativeStorage = contract.derivativeStorage[this.derivativeStorageDataKey].value;

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
        this.idDataKey = drizzle.contracts[priceFeedAddress].methods.latestPrice.cacheCall(
          derivativeStorage.fixedParameters.product,
          {}
        );
        return;
      case PriceFeedRequestsStatus.SENT:
      default:
      // Now we can continue on to checking whether idDataKey has retrieved a value.
    }

    const isLatestPriceAvailable = this.idDataKey in drizzleState.contracts[priceFeedAddress].latestPrice;
    if (!isLatestPriceAvailable) {
      return;
    }

    // All the data is now available.
    this.setState({ loading: false });
  }

  componentWillUnmount() {
    this.unsubscribeFn();
  }

  render() {
    if (this.state.loading) {
      return <div>Looking up contract details...</div>;
    }
    const { drizzle, drizzleState } = this.props;
    const web3 = drizzle.web3;

    const contract = drizzleState.contracts[this.contractKey];
    const derivativeStorage = contract.derivativeStorage[this.derivativeStorageDataKey].value;
    const totalSupply = contract.totalSupply[this.totalSupplyDataKey].value;
    const contractName = contract.name[this.nameDataKey].value;
    const estimatedTokenValue = web3.utils.toBN(contract.calcTokenValue[this.estimatedTokenValueDataKey].value);
    const estimatedNav = web3.utils.toBN(contract.calcNAV[this.estimatedNavDataKey].value);
    const estimatedShortMarginBalance = web3.utils.toBN(
      contract.calcShortMarginBalance[this.estimatedShortMarginBalanceDataKey].value
    );
    const priceFeedAddress = derivativeStorage.externalAddresses.priceFeed;
    const latestPrice = drizzleState.contracts[priceFeedAddress].latestPrice[this.idDataKey].value;

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
      yourTokens: "UNKNOWN"
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
      yourTokens: "UNKNOWN"
    };
    // The TokenizedDerivative smart contract uses this value to indicate using ETH as the margin currency.
    const sentinelMarginCurrency = "0x0000000000000000000000000000000000000000";
    // The TokenizedDerivative smart contract uses this value `~uint(0)` as a sentinel to indicate no expiry.
    const sentinelExpiryTime = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    const contractParameters = {
      contractAddress: this.props.contractAddress,
      creatorAddress: "UNKNOWN",
      creationTime: "UNKNOWN",
      expiryTime:
        derivativeStorage.endTime === sentinelExpiryTime
          ? "None"
          : ContractDetails.formatDate(derivativeStorage.endTime, web3),
      priceFeedAddress: derivativeStorage.externalAddresses.priceFeed,
      marginCurrency:
        derivativeStorage.externalAddresses.marginCurrency === sentinelMarginCurrency
          ? "ETH"
          : derivativeStorage.externalAddresses.marginCurrency,
      returnCalculator: derivativeStorage.externalAddresses.returnCalculator
    };

    return (
      <div>
        {contractName} ({derivativeStorage.fixedParameters.symbol})
        <ContractParameters parameters={contractParameters} />
        <ContractFinancialsTable
          lastRemargin={lastRemarginContractFinancials}
          estimatedCurrent={estimatedCurrentContractFinancials}
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
