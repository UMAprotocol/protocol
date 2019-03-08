import React, { Component } from "react";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";
import { withStyles } from "@material-ui/core/styles";
import grey from '@material-ui/core/colors/grey';

import { formatDate, formatWei } from "../utils/FormattingUtils";
import DrizzleHelper from "../utils/DrizzleHelper";

const styles = theme => ({
  root: {
    margin: 18,
    overflowX: "auto"
  },
  shaded: {
    backgroundColor: grey[100]
  }
});

class ContractFinancialsTable extends Component {
  componentWillMount() {
    this.drizzleHelper = new DrizzleHelper(this.props.drizzle);
  }

  render() {
    const { drizzleHelper } = this;
    const { contractAddress, drizzle, classes } = this.props;
    const account = drizzle.store.getState().accounts[0];

    const derivativeStorage = drizzleHelper.getCache(contractAddress, "derivativeStorage", []);

    const pricefeedAddress = derivativeStorage.externalAddresses.priceFeed;
    const identifier = derivativeStorage.fixedParameters.product;
    const latestPrice = drizzleHelper.getCache(pricefeedAddress, "latestPrice", [identifier]);

    const totalSupply = drizzleHelper.getCache(contractAddress, "totalSupply", []);
    const balanceOf = drizzleHelper.getCache(contractAddress, "balanceOf", [account]);

    const estimatedTokenValue = drizzleHelper.getCache(contractAddress, "calcTokenValue", []);
    const estimatedNav = drizzleHelper.getCache(contractAddress, "calcNAV", []);
    const estimatedShort = drizzleHelper.getCache(contractAddress, "calcShortMarginBalance", []);

    const { web3 } = drizzle;
    const toBN = web3.utils.toBN;

    const previousTime = formatDate(derivativeStorage.currentTokenState.time, web3);
    const previousAssetPrice = formatWei(derivativeStorage.currentTokenState.underlyingPrice, web3);
    const previousTokenPrice = formatWei(derivativeStorage.currentTokenState.tokenPrice, web3) + "/token";
    const previousLongMargin = formatWei(derivativeStorage.longBalance, web3);
    const previousShortMargin = formatWei(derivativeStorage.shortBalance, web3);
    const previousTotalHoldings = formatWei(
      toBN(derivativeStorage.longBalance).add(toBN(derivativeStorage.shortBalance)),
      web3
    );

    const currentTime = formatDate(latestPrice.publishTime, web3);
    const currentAssetPrice = formatWei(latestPrice.price, web3);
    const currentTokenPrice = estimatedTokenValue ? formatWei(estimatedTokenValue, web3) + "/token" : "Unknown";
    const currentLongMargin = estimatedNav ? formatWei(estimatedNav, web3) : "Unknown";
    const currentShortMargin = estimatedShort ? formatWei(estimatedShort, web3) : "Unknown";
    const currentTotalHoldings =
      estimatedNav && estimatedShort ? formatWei(toBN(estimatedNav).add(toBN(estimatedShort)), web3) : "Unknown";

    const numTotalTokens = formatWei(totalSupply, web3);
    const tokenBalance = formatWei(balanceOf, web3);

    return (
      <Paper align="center" className={classes.root}>
        <Table className={classes.table}>
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>
                <div>Values at last remargin</div>
                <div>as of {previousTime}</div>
              </TableCell>
              <TableCell>
                <div>Estimated current values</div>
                <div>as of {currentTime}</div>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow key="assetPrice" className={classes.shaded}>
              <TableCell>Asset price:</TableCell>
              <TableCell>{previousAssetPrice}</TableCell>
              <TableCell>{currentAssetPrice}</TableCell>
            </TableRow>

            <TableRow key="tokenValue" className={classes.shaded}>
              <TableCell>Token value:</TableCell>
              <TableCell>{previousTokenPrice}</TableCell>
              <TableCell>{currentTokenPrice}</TableCell>
            </TableRow>

            <TableRow key="totalHoldings" className={classes.shaded}>
              <TableCell>Total holdings:</TableCell>
              <TableCell>{previousTotalHoldings}</TableCell>
              <TableCell>{currentTotalHoldings}</TableCell>
            </TableRow>

            <TableRow key="longMargin">
              <TableCell>- Long margin:</TableCell>
              <TableCell>{previousLongMargin}</TableCell>
              <TableCell>{currentLongMargin}</TableCell>
            </TableRow>

            <TableRow key="shortMargin">
              <TableCell>- Short margin:</TableCell>
              <TableCell>{previousShortMargin}</TableCell>
              <TableCell>{currentShortMargin}</TableCell>
            </TableRow>

            <TableRow key="tokenSupply" className={classes.shaded}>
              <TableCell>Token supply:</TableCell>
              <TableCell>{numTotalTokens}</TableCell>
              <TableCell>{numTotalTokens}</TableCell>
            </TableRow>

            <TableRow key="yourTokens">
              <TableCell>- Your tokens:</TableCell>
              <TableCell>{tokenBalance} tokens</TableCell>
              <TableCell>{tokenBalance} tokens</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>
    );
  }
}
export default withStyles(styles)(ContractFinancialsTable);
