import React from "react";

const ContractParameters = ({ parameters }) => (
  <div>
    <div>Details</div>
    Address: {parameters.contractAddress}
    <div>Creator: {parameters.creatorAddress}</div>
    <div>Created: {parameters.creationTime}</div>
    <div>Expiry: {parameters.expiryTime}</div>
    <div>Price Feed: {parameters.priceFeedAddress}</div>
    <div>Denomination: {parameters.marginCurrency}</div>
    <div>Return Calculator: {parameters.returnCalculator}</div>
  </div>
);

export default ContractParameters;
