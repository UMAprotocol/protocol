import React, { Component } from 'react';
import ContractFinancialsTable from './ContractFinancialsTable.js';

class ContractDetails extends Component {
  render() {
    // TODO(ptare): Retrieve these values from the blockchain via Drizzle.
    const lastRemarginContractFinancials = {};
    lastRemarginContractFinancials.assetPrice = "$33";
    lastRemarginContractFinancials.tokenPrice = "217 Dai/token";
    lastRemarginContractFinancials.totalHoldings = "0";
    lastRemarginContractFinancials.totalHoldings = "0";
    lastRemarginContractFinancials.longMargin = "0";
    lastRemarginContractFinancials.shortMargin = "0";
    lastRemarginContractFinancials.tokenSupply = "0";
    lastRemarginContractFinancials.yourTokens = "0";
    const estimatedCurrentContractFinancials = {};
    estimatedCurrentContractFinancials.assetPrice = "$35 (+2)";
    estimatedCurrentContractFinancials.tokenPrice = "221 Dai/token (+4)";
    estimatedCurrentContractFinancials.totalHoldings = "0";
    estimatedCurrentContractFinancials.longMargin = "0";
    estimatedCurrentContractFinancials.shortMargin = "0";
    estimatedCurrentContractFinancials.tokenSupply = "0";
    estimatedCurrentContractFinancials.yourTokens = "0";

    return (
      <div className="ContractDetails">
        <ContractFinancialsTable lastRemargin={lastRemarginContractFinancials} estimatedCurrent={estimatedCurrentContractFinancials}>
        </ContractFinancialsTable>
      </div>
    );
  }
}

export default ContractDetails;
