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
          <TableCell padding="dense">Type</TableCell>
          <TableCell padding="dense">Address</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {derivatives.map(n => {
          return (
            <TableRow key={n.id}>
              <TableCell padding="dense">{n.type}</TableCell>
              <TableCell padding="dense">
                <Button onClick={e => buttonPushFn(n.address, e)}>Open details for {n.address}</Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </Paper>
);

export default DerivativeListTable;
