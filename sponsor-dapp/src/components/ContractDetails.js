import React, { Component } from "react";
import ContractFinancialsTable from "./ContractFinancialsTable.js";
import ContractParameters from "./ContractParameters.js";
import TokenizedDerivative from "../contracts/TokenizedDerivative.json";

class ContractDetails extends Component {
  state = { derivativeStorageDataKey: null, contractKey: null };

  componentWillMount() {
    // Use the contractAddress as the contractKey, so that ContractDetails can be pulled up for separate
    // contracts without colliding.
    const contractKey = this.props.contractAddress;
    const contractConfig = {
      contractName: this.props.contractAddress,
      web3Contract: new this.props.drizzle.web3.eth.Contract(TokenizedDerivative.abi, this.props.contractAddress)
    };
    this.props.drizzle.addContract(contractConfig);

    const derivativeStorageDataKey = this.props.drizzle.contracts[contractKey].methods.derivativeStorage.cacheCall();

    // Keep contractKey and derivativeStorageDataKey in this component's state so that `render()` can access them.
    this.setState({ derivativeStorageDataKey, contractKey: this.props.contractAddress });
  }

  render() {
    const isContractInStore = this.state.contractKey in this.props.drizzleState.contracts;
    if (!isContractInStore) {
      return <div>Looking up contract...</div>;
    }

    const isDerivativeStorageAvailable =
      this.state.derivativeStorageDataKey in
      this.props.drizzleState.contracts[this.state.contractKey].derivativeStorage;
    if (!isDerivativeStorageAvailable) {
      return <div>Looking up contract details...</div>;
    }

    const derivativeStorage = this.props.drizzleState.contracts[this.state.contractKey].derivativeStorage[
      this.state.derivativeStorageDataKey
    ].value;

    // TODO(ptare): Retrieve these values from the blockchain via Drizzle.
    const lastRemarginContractFinancials = {
      assetPrice: "$33",
      tokenPrice: "217 Dai/token",
      totalHoldings: "0",
      longMargin: "0",
      shortMargin: "0",
      tokenSupply: "0",
      yourTokens: "0"
    };
    const estimatedCurrentContractFinancials = {
      assetPrice: "$35 (+2)",
      tokenPrice: "221 Dai/token (+4)",
      totalHoldings: "0",
      longMargin: "0",
      shortMargin: "0",
      tokenSupply: "0",
      yourTokens: "0"
    };
    const contractParameters = {
      contractAddress: this.props.contractAddress,
      creatorAddress: "0x67890",
      creationTime: "2018-12-10 T13:45:30",
      expiryTime: "2018-12-30 T17:00:00",
      priceFeedAddress: "0x54321",
      marginCurrency: "Dai (0x09876)",
      returnCalculator: "2x (0x23456)"
    };

    return (
      <div>
        Name-goes-here ({derivativeStorage.fixedParameters.symbol})
        <ContractParameters parameters={contractParameters} />
        <ContractFinancialsTable
          lastRemargin={lastRemarginContractFinancials}
          estimatedCurrent={estimatedCurrentContractFinancials}
        />
      </div>
    );
  }
}

export default ContractDetails;
