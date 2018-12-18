import React from "react";
import PropTypes from "prop-types";
import { withStyles } from "@material-ui/core/styles";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";

const BigNumber = require("bignumber.js");

const styles = {
  root: {
    width: "100%",
    overflowX: "auto"
  },
  table: {
    minWidth: 700
  }
};

class SimpleTable extends React.Component {
  state = {
    data: []
  };

  computeNewTokenValue(previousTokenValue, initialPrice, newPrice, timeDiff, feesPerSecond, web3) {
    var oneEth = BigNumber(web3.utils.toWei("1", "ether"));
    // var newTokenValueEth = oneEth.plus(BigNumber(1)).toString();
    var priceReturn = BigNumber(web3.utils.toWei(newPrice.toString(), "ether"))
      .div(BigNumber(initialPrice.toString()))
      .minus(oneEth)
      .times(BigNumber(2))
      .plus(oneEth);
    var computedFees = BigNumber(feesPerSecond.toString()).times(BigNumber(timeDiff.toString()));
    var totalReturn = priceReturn.minus(computedFees);
    var newTokenValue = BigNumber(previousTokenValue.toString())
      .times(totalReturn)
      .div(oneEth);
    var newTokenValueEth = newTokenValue.div(oneEth).toString();
    return newTokenValueEth;
  }

  async constructTable() {
    const { tokenizedDerivative, oracle, web3 } = this.props;

    var data = [];

    var lastRemarginTime = (await tokenizedDerivative.lastRemarginTime()).toString();
    var remarginPrice = (await oracle.unverifiedPrice(lastRemarginTime))[1];
    var remarginPriceInEth = web3.utils.fromWei(remarginPrice.toString(), "ether");
    var lastRemarginDate = new Date(Number(lastRemarginTime) * 1000);

    var mostRecentPriceTime = await oracle.latestUnverifiedPrice();
    var mostRecentPrice = mostRecentPriceTime[1].toString();
    var mostRecentPriceInEth = web3.utils.fromWei(mostRecentPrice, "ether");

    var mostRecentPriceDate = new Date(Number(mostRecentPriceTime[0].toString()) * 1000);

    var dateFormatOptions = {
      hour12: false,
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    };
    data.push({
      name: "Time",
      last_update: lastRemarginDate.toLocaleString(undefined, dateFormatOptions),
      current_value: mostRecentPriceDate.toLocaleString(undefined, dateFormatOptions),
      id: 0
    });

    var lastTokenPrice = await tokenizedDerivative.tokenPrice();
    var lastTokenPriceInEth = web3.utils.fromWei(lastTokenPrice.toString(), "ether");

    var feesPerSecond = await tokenizedDerivative.fixedFeePerSecond();

    var newTokenValue = this.computeNewTokenValue(
      lastTokenPrice,
      remarginPrice,
      mostRecentPrice,
      Number(mostRecentPriceTime[0].toString()) - Number(lastRemarginTime),
      feesPerSecond,
      web3
    );

    data.push({
      name: "BTC/ETH Price",
      last_update: remarginPriceInEth.toString().substring(0, 7),
      current_value: mostRecentPriceInEth.toString().substring(0, 7),
      id: 1
    });
    data.push({
      name: "Token Value",
      last_update: lastTokenPriceInEth.toString().substring(0, 8) + " ETH",
      current_value: newTokenValue.substring(0, 8) + " ETH",
      id: 2
    });

    console.log(process.env);

    if (process.env.REACT_APP_MODE === "internal") {
      var lastNav = BigNumber((await tokenizedDerivative.nav()).toString());

      var totalSupply = await tokenizedDerivative.totalSupply();
      var oneEth = BigNumber(web3.utils.toWei("1", "ether"));
      var currentNav = BigNumber(newTokenValue)
        .times(oneEth)
        .times(BigNumber(totalSupply.toString()))
        .div(oneEth);
      data.push({
        name: "NAV",
        last_update:
          lastNav
            .div(oneEth)
            .toString()
            .substring(0, 8) + " ETH",
        current_value:
          currentNav
            .div(oneEth)
            .toString()
            .substring(0, 8) + " ETH",
        id: 3
      });

      var providerStruct = await tokenizedDerivative.provider();
      var marginPercentage = BigNumber(providerStruct[3].toString());
      var lastMarginReq = lastNav.times(marginPercentage).div(oneEth);
      var currentMarginReq = currentNav.times(marginPercentage).div(oneEth);

      data.push({
        name: "Margin Required",
        last_update:
          lastMarginReq
            .div(oneEth)
            .toString()
            .substring(0, 8) + " ETH",
        current_value:
          currentMarginReq
            .div(oneEth)
            .toString()
            .substring(0, 8) + " ETH",
        id: 4
      });

      var lastProviderBalance = BigNumber(providerStruct[1].toString());
      var navChange = currentNav.minus(lastNav);
      var currentProviderBalance = lastProviderBalance.minus(navChange);

      data.push({
        name: "Provider Margin",
        last_update:
          lastProviderBalance
            .div(oneEth)
            .toString()
            .substring(0, 8) + " ETH",
        current_value:
          currentProviderBalance
            .div(oneEth)
            .toString()
            .substring(0, 8) + " ETH",
        id: 5
      });
    }

    return data;
  }

  constructor(props) {
    super(props);

    this.state.data = [];
    this.constructTable().then(data => {
      this.setState({ data: data });
    });
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    if (!prevProps.deployedRegistry && this.props.deployedRegistry) {
      this.constructTable().then(data => {
        this.setState({ data: data });
      });
    }
  }

  compnentDidMount() {
    if (this.props.deployedRegistry) {
      this.constructTable().then(data => {
        this.setState({ data: data });
      });
    }
  }

  render() {
    const { classes } = this.props;
    return (
      <Paper align="center" className={classes.root}>
        <Table align="center" className={classes.root}>
          <TableHead>
            <TableRow>
              <TableCell padding="dense" />
              <TableCell padding="dense">Latest Update</TableCell>
              <TableCell padding="dense">Current Values</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {this.state.data.map(n => {
              return (
                <TableRow key={n.id}>
                  <TableCell padding="dense">{n.name}</TableCell>
                  <TableCell padding="dense">{n.last_update}</TableCell>
                  <TableCell padding="dense">{n.current_value}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    );
  }
}

SimpleTable.propTypes = {
  classes: PropTypes.object.isRequired
};

export default withStyles(styles)(SimpleTable);
