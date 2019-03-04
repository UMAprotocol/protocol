import React from "react";
import { withStyles } from "@material-ui/core/styles";

const styles = theme => ({
  root: {
    marginTop: 10,
    marginBottom: 10
  },
  title: {
    color: "blue"
  }
});

const ContractParameters = ({ parameters, classes }) => (
  <div className={classes.root}>
    <div className={classes.title}>Details</div>
    Address: {parameters.contractAddress}
    <div>Creator: {parameters.creatorAddress}</div>
    <div>Created: {parameters.creationTime}</div>
    <div>Expiry: {parameters.expiryTime}</div>
    <div>Price Feed: {parameters.priceFeedAddress}</div>
    <div>Denomination: {parameters.marginCurrency}</div>
    <div>Return Calculator: {parameters.returnCalculator}</div>
  </div>
);

export default withStyles(styles)(ContractParameters);
