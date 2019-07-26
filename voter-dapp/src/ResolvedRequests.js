import React, { useMemo } from "react";
import { drizzleReactHooks } from "drizzle-react";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Typography from "@material-ui/core/Typography";

import { formatDate } from "./common/FormattingUtils.js";
import { MAX_UINT_VAL } from "./common/Constants.js";

function ResolvedRequests() {
  const { drizzle, useCacheCall, useCacheEvents } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;

  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const resolvedEvents =
    useCacheEvents(
      "Voting",
      "PriceResolved",
      useMemo(() => {
        const indexRoundId = currentRoundId == null ? MAX_UINT_VAL : currentRoundId - 1;
        return { filter: { resolutionRoundId: indexRoundId } };
      }, [currentRoundId])
    ) || [];

  const revealedVoteEvents =
    useCacheEvents(
      "Voting",
      "VoteRevealed",
      useMemo(() => {
        const indexRoundId = currentRoundId == null ? MAX_UINT_VAL : currentRoundId - 1;
        return {
          filter: { resolutionRoundId: indexRoundId, voter: account }
        };
      }, [currentRoundId, account])
    ) || [];

  return (
    <div>
      <Typography variant="h6" component="h6">
        Resolved Requests
      </Typography>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Price Feed</TableCell>
            <TableCell>Timestamp</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Your Vote</TableCell>
            <TableCell>Correct Vote</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {resolvedEvents.map((event, index) => {
            const resolutionData = event.returnValues;

            const revealEvent = revealedVoteEvents.find(
              event =>
                event.returnValues.identifier === resolutionData.identifier &&
                event.returnValues.time === resolutionData.time
            );

            const userVote = revealEvent ? drizzle.web3.utils.fromWei(revealEvent.returnValues.price) : "No Vote";

            return (
              <TableRow key={index}>
                <TableCell>{web3.utils.hexToUtf8(resolutionData.identifier)}</TableCell>
                <TableCell>{formatDate(resolutionData.time, web3)}</TableCell>
                <TableCell>Resolved</TableCell>
                <TableCell>{userVote}</TableCell>
                <TableCell>{web3.utils.fromWei(resolutionData.price)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default ResolvedRequests;
