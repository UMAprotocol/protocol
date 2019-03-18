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

  withTypography(text) {
    return (
      <div>
        <Typography variant="body2">{text}</Typography>
      </div>
    );
  }

  render() {
    const { parameters, classes } = this.props;
    return (
      <div>
        <Button className={classes.title} onClick={this.handleClick}>
          {this.state.open ? <ExpandLess /> : <ExpandMore />} Details
        </Button>
        <Collapse in={this.state.open} timeout="auto">
          {this.withTypography(`Address: ${parameters.contractAddress}`)}
          {this.withTypography(`Sponsor: ${parameters.creatorAddress}`)}
          {this.withTypography(`Created: ${parameters.creationTime}`)}
          {this.withTypography(`Expiry: ${parameters.expiryTime}`)}
          {this.withTypography(`Price Feed: ${parameters.priceFeedAddress}`)}
          {this.withTypography(`Margin currency: ${parameters.marginCurrency}`)}
          {this.withTypography(`Return Calculator: ${parameters.returnCalculator}`)}
        </Collapse>
      </div>
    );
  }
}

export default withStyles(styles)(ContractParameters);
