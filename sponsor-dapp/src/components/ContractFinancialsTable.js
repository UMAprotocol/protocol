import React from "react";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";
import { withStyles } from "@material-ui/core/styles";

const styles = theme => ({
  root: {
    margin: 18,
    overflowX: "auto",
  },
  shaded: {
    backgroundColor: "gray"
  }
});

const ContractFinancialsTable = ({ lastRemargin, estimatedCurrent, classes }) => (
  <Paper align="center" className={classes.root}>
    <Table className={classes.table}>
      <TableHead>
        <TableRow>
          <TableCell />
          <TableCell>
            <div>Values at last remargin</div>
            <div>as of {lastRemargin.time}</div>
          </TableCell>
          <TableCell>
            <div>Estimated current values</div>
            <div>as of {estimatedCurrent.time}</div>
          </TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow key="assetPrice" className={classes.shaded}>
          <TableCell>Asset price:</TableCell>
          <TableCell>{lastRemargin.assetPrice}</TableCell>
          <TableCell>{estimatedCurrent.assetPrice}</TableCell>
        </TableRow>

        <TableRow key="tokenValue" className={classes.shaded}>
          <TableCell>Token value:</TableCell>
          <TableCell>{lastRemargin.tokenPrice}</TableCell>
          <TableCell>{estimatedCurrent.tokenPrice}</TableCell>
        </TableRow>

        <TableRow key="totalHoldings" className={classes.shaded}>
          <TableCell>Total holdings:</TableCell>
          <TableCell>{lastRemargin.totalHoldings}</TableCell>
          <TableCell>{estimatedCurrent.totalHoldings}</TableCell>
        </TableRow>

        <TableRow key="longMargin">
          <TableCell>- Long margin:</TableCell>
          <TableCell>{lastRemargin.longMargin}</TableCell>
          <TableCell>{estimatedCurrent.longMargin}</TableCell>
        </TableRow>

        <TableRow key="shortMargin">
          <TableCell>- Short margin:</TableCell>
          <TableCell>{lastRemargin.shortMargin}</TableCell>
          <TableCell>{estimatedCurrent.shortMargin}</TableCell>
        </TableRow>

        <TableRow key="tokenSupply" className={classes.shaded}>
          <TableCell>Token supply:</TableCell>
          <TableCell>{lastRemargin.tokenSupply}</TableCell>
          <TableCell>{estimatedCurrent.tokenSupply}</TableCell>
        </TableRow>

        <TableRow key="yourTokens">
          <TableCell>- Your tokens:</TableCell>
          <TableCell>{lastRemargin.yourTokens} tokens</TableCell>
          <TableCell>{estimatedCurrent.yourTokens} tokens</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Paper>
);

export default withStyles(styles)(ContractFinancialsTable);
