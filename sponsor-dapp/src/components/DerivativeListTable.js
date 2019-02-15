import React from "react";
import Button from "@material-ui/core/Button";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";

const DerivativeListTable = ({ derivatives, buttonPushFn }) => (
  <Paper align="center">
    <Table align="center">
      <TableHead>
        <TableRow>
          <TableCell padding="dense">Address</TableCell>
          <TableCell padding="dense">Token Name</TableCell>
          <TableCell padding="dense">Symbol</TableCell>
          <TableCell padding="dense">Status</TableCell>
          <TableCell padding="dense">Asset</TableCell>
          <TableCell padding="dense">Created</TableCell>
          <TableCell padding="dense">Role</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {derivatives.map(n => {
          return (
            <TableRow key={n.id}>
              <TableCell padding="dense">
                <Button onClick={e => buttonPushFn(n.address, e)}>Open details for {n.address}</Button>
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
  </Paper>
);

export default DerivativeListTable;
