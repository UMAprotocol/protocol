import React, { Component } from "react";
import ContractFinancialsTable from "./ContractFinancialsTable.js";
import ContractParameters from "./ContractParameters.js";
import TokenizedDerivative from "../contracts/TokenizedDerivative.json";

class ContractDetails extends Component {
  state = { derivativeStorageDataKey: null, totalSupplyDataKey: null, nameDataKey: null, contractKey: null };

  componentDidMount() {
    // Use the contractAddress as the contractKey, so that ContractDetails can be pulled up for separate
    // contracts without colliding.
    const contractKey = this.props.contractAddress;
    const contractConfig = {
      contractName: this.props.contractAddress,
      web3Contract: new this.props.drizzle.web3.eth.Contract(TokenizedDerivative.abi, this.props.contractAddress)
    };
    this.props.drizzle.addContract(contractConfig);

    const contractMethods = this.props.drizzle.contracts[contractKey].methods;
    const derivativeStorageDataKey = contractMethods.derivativeStorage.cacheCall();
    const totalSupplyDataKey = contractMethods.totalSupply.cacheCall();
    const nameDataKey = contractMethods.name.cacheCall();

    // Keep contractKey and dataKey's related to looked up values in this component's state so that `render()` can access them.
    this.setState({
      derivativeStorageDataKey,
      totalSupplyDataKey,
      nameDataKey,
      contractKey: this.props.contractAddress
    });
  }

  render() {
    const isContractInStore = this.state.contractKey in this.props.drizzleState.contracts;
    if (!isContractInStore) {
      return <div>Looking up contract...</div>;
    }
    const contract = this.props.drizzleState.contracts[this.state.contractKey];

    const isDerivativeStorageAvailable = this.state.derivativeStorageDataKey in contract.derivativeStorage;
    const isTotalSupplyAvailable = this.state.totalSupplyDataKey in contract.totalSupply;
    const isNameAvailable = this.state.nameDataKey in contract.name;
    if (!isDerivativeStorageAvailable || !isTotalSupplyAvailable || !isNameAvailable) {
      return <div>Looking up contract details...</div>;
    }

    const derivativeStorage = contract.derivativeStorage[this.state.derivativeStorageDataKey].value;
    const totalSupply = contract.totalSupply[this.state.totalSupplyDataKey].value;
    const contractName = contract.name[this.state.nameDataKey].value;

    const web3 = this.props.drizzle.web3;

    // TODO(ptare): Retrieve these values from the blockchain via Drizzle.
    const lastRemarginContractFinancials = {
      assetPrice: web3.utils.fromWei(derivativeStorage.currentTokenState.underlyingPrice),
      tokenPrice: web3.utils.fromWei(derivativeStorage.currentTokenState.tokenPrice) + "/token",
      // NOTE: this method of getting totalHoldings explicitly disregards any margin currency sent to the contract not
      // through Deposit.
      totalHoldings: web3.utils.fromWei(derivativeStorage.longBalance + derivativeStorage.shortBalance),
      longMargin: web3.utils.fromWei(derivativeStorage.longBalance),
      shortMargin: web3.utils.fromWei(derivativeStorage.shortBalance),
      tokenSupply: totalSupply,
      yourTokens: "UNKNOWN"
    };
    const estimatedCurrentContractFinancials = {
      assetPrice: "$35 (+2)",
      tokenPrice: "221 Dai/token (+4)",
      totalHoldings: "0",
      longMargin: "0",
      shortMargin: "0",
      // These values don't change on remargins.
      tokenSupply: totalSupply,
      yourTokens: "UNKNOWN"
    };
    // The TokenizedDerivative smart contract uses this value `~uint(0)` as a sentinel to indicate no expiry.
    const sentinelMarginCurrency = "0x0000000000000000000000000000000000000000";
    const contractParameters = {
      contractAddress: this.props.contractAddress,
      creatorAddress: "UNKNOWN",
      creationTime: "UNKNOWN",
      expiryTime: ContractDetails.formatDate(derivativeStorage.endTime, web3),
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
    const sentinelExpiryTime = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    if (timestampInSeconds === sentinelExpiryTime) {
      return "None";
    } else {
      return new Date(web3.utils.toBN(timestampInSeconds).mul(web3.utils.toBN(1000))).toString();
    }
  }
}

export default ContractDetails;
