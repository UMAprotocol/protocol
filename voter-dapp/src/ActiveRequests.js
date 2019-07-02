import React from "react";
import { drizzleReactHooks } from "drizzle-react";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";

// TODO: Share this utility function with sponsor-dapp. React disallows imports outside of src/, so we'll need to find
// some clever workaround.
function formatDate(timestampInSeconds, web3) {
  return new Date(
    parseInt(
      web3.utils
        .toBN(timestampInSeconds)
        .muln(1000)
        .toString(),
      10
    )
  ).toString();
}

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
