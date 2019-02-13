import React, { Component } from "react";
import ContractFinancialsTable from "./ContractFinancialsTable.js";
import ContractParameters from "./ContractParameters.js";

class ContractDetails extends Component {
  render() {
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
      contractAddress: "0x12345",
      creatorAddress: "0x67890",
      creationTime: "2018-12-10 T13:45:30",
      expiryTime: "2018-12-30 T17:00:00",
      priceFeedAddress: "0x54321",
      marginCurrency: "Dai (0x09876)",
      returnCalculator: "2x (0x23456)"
    };

    return (
      <div>
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
