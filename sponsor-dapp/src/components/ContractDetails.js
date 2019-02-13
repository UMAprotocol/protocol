import React, { Component } from 'react';
import ContractFinancialsTable from './ContractFinancialsTable.js';
import ContractParameters from './ContractParameters.js';

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

    const contractParameters = {
      contractAddress: '0x12345',
      creatorAddress: '0x67890',
      creationTime: '2018-12-10 T13:45:30',
      expiryTime: '2018-12-30 T17:00:00',
      priceFeedAddress: '0x54321',
      marginCurrency: 'Dai (0x09876)',
      returnCalculator: '2x (0x23456)'
    };

    return (
      <div>
        <ContractParameters parameters={contractParameters}>
        </ContractParameters>
        <ContractFinancialsTable lastRemargin={lastRemarginContractFinancials} estimatedCurrent={estimatedCurrentContractFinancials}>
        </ContractFinancialsTable>
      </div>
    );
  }
}

export default ContractDetails;
