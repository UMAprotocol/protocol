import React from "react";
import { drizzleReactHooks } from "drizzle-react";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";

import { formatDate } from "./common/FormattingUtils.js";
import { VotePhasesEnum } from "./common/Enums.js";

function ActiveRequests() {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;

  const pendingRequests = useCacheCall("Voting", "getPendingRequests");
  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");
  const votePhase = useCacheCall("Voting", "getVotePhase");
  const account = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  })).account;
  const initialFetchComplete = pendingRequests && currentRoundId && votePhase && account;

  const voteStatuses = useCacheCall(["Voting"], call => {
    if (!initialFetchComplete) {
      return null;
    }
    return pendingRequests.map(request => ({
      committedValue: call(
        "Voting",
        "getMessage",
        account,
        web3.utils.soliditySha3(request.identifier, request.time, currentRoundId)
      ),
      hasRevealed:
        votePhase.toString() === VotePhasesEnum.REVEAL
          ? call("Voting", "hasRevealedVote", request.identifier, request.time)
          : false
    }));
  });
  const subsequentFetchComplete =
    voteStatuses &&
    // Each of the subfetches has to complete. In drizzle, `undefined` means incomplete, while `null` means complete
    // but the fetched value was null, e.g., no `comittedValue` existed.
    voteStatuses.every(voteStatus => voteStatus.committedValue !== undefined && voteStatus.hasRevealed !== undefined);

  if (!initialFetchComplete || !subsequentFetchComplete) {
    return <div>Looking up requests</div>;
  }

  const statusStrings = voteStatuses.map(voteStatus => {
    if (votePhase.toString() === VotePhasesEnum.COMMIT) {
      return "Commit";
    }
    // In the REVEAL phase.
    if (voteStatus.hasRevealed) {
      return "Revealed";
    }
    // In the REVEAL phase, but the vote hasn't been revealed (yet).
    if (voteStatus.committedValue) {
      return "Reveal";
    } else {
      return "Cannot be revealed";
    }
  });
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>Price Feed</TableCell>
          <TableCell>Timestamp</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {pendingRequests.map((pendingRequest, index) => {
          return (
            <TableRow key={index}>
              <TableCell>{drizzle.web3.utils.hexToUtf8(pendingRequest.identifier)}</TableCell>
              <TableCell>{formatDate(pendingRequest.time, drizzle.web3)}</TableCell>
              <TableCell>{statusStrings[index]}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default ActiveRequests;
