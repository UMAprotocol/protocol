import React, { useMemo, useState } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import Button from "@material-ui/core/Button";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Typography from "@material-ui/core/Typography";

import { useTableStyles } from "./Styles.js";
import { formatDate, translateAdminVote, isAdminRequest, MAX_UINT_VAL } from "@umaprotocol/common";

function ResolvedRequests({ votingAccount }) {
  const { drizzle, useCacheCall, useCacheEvents } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const { toBN, fromWei, hexToUtf8 } = web3.utils;
  const classes = useTableStyles();

  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");

  const [showAllResolvedRequests, setShowAllResolvedRequests] = useState(false);

  const resolvedEvents =
    useCacheEvents(
      "Voting",
      "PriceResolved",
      useMemo(() => {
        const indexRoundId = currentRoundId == null ? MAX_UINT_VAL : currentRoundId - 1;
        // If all resolved requests are being shown, don't filter by round id.
        return { filter: { roundId: showAllResolvedRequests ? undefined : indexRoundId }, fromBlock: 0 };
      }, [currentRoundId, showAllResolvedRequests])
    ) || [];

  const revealedVoteEvents =
    useCacheEvents(
      "Voting",
      "VoteRevealed",
      useMemo(() => {
        const indexRoundId = currentRoundId == null ? MAX_UINT_VAL : currentRoundId - 1;
        // If all resolved requests are being shown, don't filter by round id.
        return {
          filter: { roundId: showAllResolvedRequests ? undefined : indexRoundId, voter: votingAccount },
          fromBlock: 0
        };
      }, [currentRoundId, votingAccount, showAllResolvedRequests])
    ) || [];

  // Handler for when the user clicks the button to toggle showing all resolved requests.
  const clickShowAll = useMemo(
    () => () => {
      setShowAllResolvedRequests(!showAllResolvedRequests);
    },
    [showAllResolvedRequests]
  );

  // TODO: add a resolved timestamp to the table so the sorting makes more sense to the user.
  // Sort the resolved requests such that they are organized from most recent to least recent round.
  const resolvedEventsSorted = resolvedEvents.sort((a, b) => {
    const aRoundId = toBN(a.returnValues.roundId);
    const bRoundId = toBN(b.returnValues.roundId);
    return bRoundId.cmp(aRoundId);
  });

  return (
    <div className={classes.root}>
      <Typography variant="h6" component="h6">
        Resolved Requests
      </Typography>
      <Table style={{ marginBottom: "10px" }}>
        <TableHead className={classes.tableHeader}>
          <TableRow>
            <TableCell className={classes.tableHeaderCell}>Price Feed</TableCell>
            <TableCell className={classes.tableHeaderCell}>Timestamp</TableCell>
            <TableCell className={classes.tableHeaderCell}>Status</TableCell>
            <TableCell className={classes.tableHeaderCell}>Your Vote</TableCell>
            <TableCell className={classes.tableHeaderCell}>Correct Vote</TableCell>
          </TableRow>
        </TableHead>
        <TableBody className={classes.tableBody}>
          {resolvedEventsSorted.map((event, index) => {
            const resolutionData = event.returnValues;

            const revealEvent = revealedVoteEvents.find(
              event =>
                event.returnValues.identifier === resolutionData.identifier &&
                event.returnValues.time === resolutionData.time
            );

            const userVote = revealEvent ? fromWei(revealEvent.returnValues.price) : "No Vote";
            const correctVote = fromWei(resolutionData.price);

            const isAdminVote = isAdminRequest(hexToUtf8(resolutionData.identifier));

            return (
              <TableRow key={index}>
                <TableCell>{hexToUtf8(resolutionData.identifier)}</TableCell>
                <TableCell>{formatDate(resolutionData.time, web3)}</TableCell>
                <TableCell>Resolved</TableCell>
                <TableCell>{isAdminVote ? translateAdminVote(userVote) : userVote}</TableCell>
                <TableCell>{isAdminVote ? translateAdminVote(correctVote) : correctVote}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Button onClick={clickShowAll} variant="contained" color="primary">
        Show {showAllResolvedRequests ? "only recently" : "all"} resolved requests
      </Button>
    </div>
  );
}

export default ResolvedRequests;
