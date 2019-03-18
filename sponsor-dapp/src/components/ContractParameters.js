import React, { Component } from "react";
import Typography from "@material-ui/core/Typography";
import Collapse from "@material-ui/core/Collapse";
import { withStyles } from "@material-ui/core/styles";
import ExpandLess from "@material-ui/icons/ExpandLess";
import ExpandMore from "@material-ui/icons/ExpandMore";
import Button from "@material-ui/core/Button";

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
        <Button className={classes.title} onClick={this.handleClick}>
          {this.state.open ? <ExpandLess /> : <ExpandMore />} Details
        </Button>
        <Collapse in={this.state.open} timeout="auto">
          <Typography variant="body2">
            Address: {parameters.contractAddress}
            <div>Sponsor: {parameters.creatorAddress}</div>
            <div>Created: {parameters.creationTime}</div>
            <div>Expiry: {parameters.expiryTime}</div>
            <div>Price Feed: {parameters.priceFeedAddress}</div>
            <div>Margin currency: {parameters.marginCurrency}</div>
            <div>Return Calculator: {parameters.returnCalculator}</div>
          </Typography>
        </Collapse>
      </div>
    );
  }
}

export default withStyles(styles)(ContractParameters);
