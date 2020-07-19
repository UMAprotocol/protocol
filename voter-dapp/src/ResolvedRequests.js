import React, { useMemo, useState } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import Button from "@material-ui/core/Button";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Typography from "@material-ui/core/Typography";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import ListItemText from "@material-ui/core/ListItemText";

import { useQuery } from "@apollo/client";
import { PRICE_REQUEST_VOTING_DATA } from "./apollo/queries";

import { useTableStyles } from "./Styles.js";
import { formatDate, translateAdminVote, isAdminRequest, MAX_UINT_VAL } from "@umaprotocol/common";

function ResolvedRequests({ votingAccount }) {
  const { drizzle, useCacheCall, useCacheEvents } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const { toBN, fromWei, toWei, hexToUtf8 } = web3.utils;
  const classes = useTableStyles();

  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");

  const [showAllResolvedRequests, setShowAllResolvedRequests] = useState(false);
  const [openVoteStatsDialog, setOpenVoteStatsDialog] = useState(false);
  const [voteStatsDialogData, setVoteStatDialogData] = useState(null);

  // Retrieve vote data per price request from graphQL API.
  // Because apollo caches results of queries, we will poll/refresh this query periodically.
  // We set the poll interval to a very slow 5 seconds for now since the position states
  // are not expected to change much.
  // Source: https://www.apollographql.com/docs/react/data/queries/#polling
  const { loading: voteDataLoading, error: voteDataError, data: voteDataResult } = useQuery(PRICE_REQUEST_VOTING_DATA, {
    pollInterval: 5000
  });

  const getVoteStats = resolutionData => {
    if (voteDataError) {
      console.error("Failed to get data:", voteDataError);
    }
    if (!voteDataLoading && voteDataResult && resolutionData) {
      const dataForRequest = voteDataResult.priceRequestRounds.find(roundData => {
        return (
          roundData.time === resolutionData.time &&
          roundData.identifier.id === hexToUtf8(resolutionData.identifier) &&
          roundData.roundId === resolutionData.roundId
        );
      });
      if (dataForRequest) {
        // Revealed votes:
        let totalVotesRevealed = toBN("0");
        let correctVotesRevealed = toBN("0");
        dataForRequest.revealedVotes.forEach(e => {
          totalVotesRevealed = totalVotesRevealed.add(toBN(e.numTokens));
          if (e.price === dataForRequest.request.price) {
            correctVotesRevealed = correctVotesRevealed.add(toBN(e.numTokens));
          }
        });
        const pctOfVotesRevealed = totalVotesRevealed
          .mul(toBN(toWei("1")))
          .div(toBN(toWei(dataForRequest.totalSupplyAtSnapshot)));
        const pctOfCorrectRevealedVotes = correctVotesRevealed.mul(toBN(toWei("1"))).div(totalVotesRevealed);

        // Rewards claimed:
        let rewardsClaimed = toBN("0");
        dataForRequest.rewardsClaimed.forEach(e => {
          rewardsClaimed = rewardsClaimed.add(toBN(e.numTokens));
        });

        return {
          totalSupplyAtSnapshot: dataForRequest.totalSupplyAtSnapshot,
          revealedVotes: fromWei(totalVotesRevealed.toString()),
          revealedVotesPct: fromWei(pctOfVotesRevealed.mul(toBN("100")).toString()),
          correctVotes: fromWei(correctVotesRevealed.toString()),
          correctlyRevealedVotesPct: fromWei(pctOfCorrectRevealedVotes.mul(toBN("100")).toString()),
          rewardsClaimed: fromWei(rewardsClaimed.toString()),
          rewardsClaimedPct: dataForRequest.claimedPercentage
        };
      }
    }
  };

  const handleClickStats = voteStats => {
    setOpenVoteStatsDialog(true);
    setVoteStatDialogData(voteStats);
  };

  const handleCloseStats = () => {
    setOpenVoteStatsDialog(false);
  };

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

  const prettyFormatNumber = x => {
    return Number(x).toLocaleString({ minimumFractionDigits: 2 });
  };

  return (
    <div className={classes.root}>
      <Typography variant="h6" component="h6">
        Resolved Requests
      </Typography>
      <Dialog onClose={handleCloseStats} open={openVoteStatsDialog}>
        <DialogTitle>Voting Statistics</DialogTitle>
        {voteStatsDialogData && (
          <List>
            <ListItem>
              <ListItemText
                primary={"Total Supply Snapshot: " + prettyFormatNumber(voteStatsDialogData.totalSupplyAtSnapshot)}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary={"Revealed Votes: " + prettyFormatNumber(voteStatsDialogData.revealedVotes)}
                secondary={prettyFormatNumber(voteStatsDialogData.revealedVotesPct) + "% of Total Supply"}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary={"Correct Votes: " + prettyFormatNumber(voteStatsDialogData.correctVotes)}
                secondary={prettyFormatNumber(voteStatsDialogData.correctlyRevealedVotesPct) + "% of Revealed Votes"}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary={"Rewards Claimed: " + prettyFormatNumber(voteStatsDialogData.rewardsClaimed)}
                secondary={prettyFormatNumber(voteStatsDialogData.rewardsClaimedPct) + "% of Rewards Available"}
              />
            </ListItem>
          </List>
        )}
      </Dialog>
      <Table style={{ marginBottom: "10px" }}>
        <TableHead className={classes.tableHeader}>
          <TableRow>
            <TableCell className={classes.tableHeaderCell}>Price Feed</TableCell>
            <TableCell className={classes.tableHeaderCell}>Timestamp</TableCell>
            <TableCell className={classes.tableHeaderCell}>Status</TableCell>
            <TableCell className={classes.tableHeaderCell}>Your Vote</TableCell>
            <TableCell className={classes.tableHeaderCell}>Stats</TableCell>
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

            const voteStats = getVoteStats(resolutionData);

            return (
              <TableRow key={index}>
                <TableCell>{hexToUtf8(resolutionData.identifier)}</TableCell>
                <TableCell>{formatDate(resolutionData.time, web3)}</TableCell>
                <TableCell>Resolved</TableCell>
                <TableCell>{isAdminVote ? translateAdminVote(userVote) : userVote}</TableCell>
                <TableCell>
                  <Button color="primary" onClick={() => handleClickStats(voteStats)} variant="contained">
                    Display
                  </Button>
                </TableCell>
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
