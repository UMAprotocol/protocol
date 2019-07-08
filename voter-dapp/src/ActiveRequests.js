import React from "react";
import { drizzleReactHooks } from "drizzle-react";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";

import { formatDate } from "./common/FormattingUtils.js";

function ActiveRequests() {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const pendingRequests = useCacheCall("Voting", "getPendingRequests");
  if (!pendingRequests) {
    return <div>Looking up requests</div>;
  }
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Price Feed</TableCell>
          <TableCell>Timestamp</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {pendingRequests.map((pendingRequest, index) => {
          return (
            <TableRow key={index}>
              <TableCell>{drizzle.web3.utils.hexToUtf8(pendingRequest.identifier)}</TableCell>
              <TableCell>{formatDate(pendingRequest.time, drizzle.web3)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default ActiveRequests;
