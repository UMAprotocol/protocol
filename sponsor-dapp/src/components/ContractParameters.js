import React, { Component } from "react";
import Collapse from "@material-ui/core/Collapse";
import { withStyles } from "@material-ui/core/styles";
import ExpandLess from "@material-ui/icons/ExpandLess";
import ExpandMore from "@material-ui/icons/ExpandMore";

const styles = theme => ({
  detailsText: {
    height: 24,
    display: "inline-block",
    verticalAlign: "text-bottom"
  },
  title: {
    color: "blue"
  }
});

class ContractParameters extends Component {
  state = {
    open: false
  };

  handleClick = () => {
    this.setState(state => ({ open: !state.open }));
  };

  render() {
    const { parameters, classes } = this.props;
    return (
      <div>
        <div className={classes.title} onClick={this.handleClick}>
          {this.state.open ? <ExpandLess /> : <ExpandMore />}
          <span className={classes.detailsText}> Details </span>
        </div>
        <Collapse in={this.state.open} timeout="auto">
          Address: {parameters.contractAddress}
          <div>Creator: {parameters.creatorAddress}</div>
          <div>Created: {parameters.creationTime}</div>
          <div>Expiry: {parameters.expiryTime}</div>
          <div>Price Feed: {parameters.priceFeedAddress}</div>
          <div>Denomination: {parameters.marginCurrency}</div>
          <div>Return Calculator: {parameters.returnCalculator}</div>
        </Collapse>
      </div>
    );
  }
}

export default withStyles(styles)(ContractParameters);
