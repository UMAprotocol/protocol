import React from "react";
import { withStyles } from "@material-ui/core/styles";
import Button from "@material-ui/core/Button";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";

const styles = theme => ({
  root: {
    width: "100%",
    overflowX: "auto",
    marginTop: "32px"
  },
  table: {
    minWidth: 700
  },
  tableHead: {
    fontSize: "18px"
  },
  button: {
    margin: theme.spacing.unit,
    fontFamily: "Courier"
  }
});

const DerivativeListTable = ({ derivatives, buttonPushFn, classes }) => (
  <Paper align="center" className={classes.root}>
    {derivatives.length === 0 ? (
      ""
    ) : (
      <Table align="center" className={classes.table}>
        <TableHead>
          <TableRow>
            <TableCell className={classes.tableHead} padding="dense">
              Address
            </TableCell>
            <TableCell className={classes.tableHead} padding="dense">
              Token Name
            </TableCell>
            <TableCell className={classes.tableHead} padding="dense">
              Symbol
            </TableCell>
            <TableCell className={classes.tableHead} padding="dense">
              Status
            </TableCell>
            <TableCell className={classes.tableHead} padding="dense">
              Asset
            </TableCell>
            <TableCell className={classes.tableHead} padding="dense">
              Created
            </TableCell>
            <TableCell className={classes.tableHead} padding="dense">
              Role
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {derivatives.map(n => {
            return (
              <TableRow key={n.id}>
                <TableCell padding="dense">
                  <Button
                    onClick={e => buttonPushFn(n.address, e)}
                    className={classes.button}
                    variant="outlined"
                    color="primary"
                  >
                    {n.address}
                  </Button>
                </TableCell>
                <TableCell padding="dense">{n.tokenName}</TableCell>
                <TableCell padding="dense">{n.symbol}</TableCell>
                <TableCell padding="dense">{n.status}</TableCell>
                <TableCell padding="dense">{n.asset}</TableCell>
                <TableCell padding="dense">{n.created}</TableCell>
                <TableCell padding="dense">{n.role}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    )}
  </Paper>
);

export default withStyles(styles)(DerivativeListTable);
