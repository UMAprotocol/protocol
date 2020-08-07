import React, { useMemo, useState, useEffect } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import {
  FormGroup,
  FormControlLabel,
  Switch,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  Dialog,
  DialogTitle,
  List,
  ListItem,
  ListItemText
} from "@material-ui/core";

import { useTableStyles } from "./Styles.js";
import { formatDate, translateAdminVote, isAdminRequest, MAX_UINT_VAL, REQUEST_BLACKLIST } from "@umaprotocol/common";

import VoteData from "./containers/VoteData";

function ResolvedRequests({ votingAccount }) {
  const { drizzle, useCacheCall, useCacheEvents } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const { toBN, fromWei, hexToUtf8 } = web3.utils;
  const classes = useTableStyles();

  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");

  const { roundVoteData, getRequestKey } = VoteData.useContainer();

  const [showAllResolvedRequests, setShowAllResolvedRequests] = useState(false);
  const [openVoteStatsDialog, setOpenVoteStatsDialog] = useState(false);
  const [voteStatsDialogData, setVoteStatDialogData] = useState(null);

  const getVoteStats = resolutionData => {
    if (resolutionData) {
      const voteDataKey = getRequestKey(
        resolutionData.time,
        hexToUtf8(resolutionData.identifier),
        resolutionData.roundId
      );
      if (roundVoteData?.[voteDataKey]) {
        return roundVoteData[voteDataKey];
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

  const allResolvedEvents =
    useCacheEvents(
      "Voting",
      "PriceResolved",
      useMemo(() => {
        const indexRoundId = currentRoundId == null ? MAX_UINT_VAL : currentRoundId - 1;
        // If all resolved requests are being shown, don't filter by round id.
        return { filter: { roundId: showAllResolvedRequests ? undefined : indexRoundId }, fromBlock: 0 };
      }, [currentRoundId, showAllResolvedRequests])
    ) || [];

  // Only display non-blacklisted price requests (uniquely identifier by identifier name and timestamp)
  const [showSpamRequests, setShowSpamRequests] = useState(false);
  const [resolvedEvents, setResolvedEvents] = useState([]);
  useEffect(() => {
    if (allResolvedEvents) {
      const _resolvedEvents = allResolvedEvents.filter(ev => {
        if (showSpamRequests || !REQUEST_BLACKLIST[hexToUtf8(ev.returnValues.identifier)]) return true;
        else {
          if (!REQUEST_BLACKLIST[hexToUtf8(ev.returnValues.identifier)].includes(ev.returnValues.time)) return true;
          else return false;
        }
      });

      setResolvedEvents(_resolvedEvents);
    }
  }, [allResolvedEvents, REQUEST_BLACKLIST, showSpamRequests]);

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
    return Number(x).toLocaleString({ minimumFractionDigits: 4 });
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
                primary={"Unique Commit Addresses: " + prettyFormatNumber(voteStatsDialogData.uniqueCommits)}
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
                primary={"Unique Reveal Addresses: " + prettyFormatNumber(voteStatsDialogData.uniqueReveals)}
                secondary={
                  prettyFormatNumber(voteStatsDialogData.uniqueRevealsPctOfCommits) + "% of Unique Commit Addresses"
                }
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
                primary={"Rewards Available: " + prettyFormatNumber(voteStatsDialogData.roundInflationRewardsAvailable)}
                // I don't use `prettyFormatNumber` here because for some reason it rounds 0.0005 to 0.001
                secondary={`Round inflation rate: ${voteStatsDialogData.roundInflationRate}% of Total Supply Snapshot`}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary={"Rewards Claimed: " + prettyFormatNumber(voteStatsDialogData.rewardsClaimed)}
                secondary={prettyFormatNumber(voteStatsDialogData.rewardsClaimedPct) + "% of Rewards Available"}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary={"Unique Claimer Addresses: " + prettyFormatNumber(voteStatsDialogData.uniqueClaimers)}
                secondary={
                  prettyFormatNumber(voteStatsDialogData.uniqueClaimersPctOfReveals) + "% of Unique Reveal Addresses"
                }
              />
            </ListItem>
          </List>
        )}
      </Dialog>
      {Object.keys(REQUEST_BLACKLIST).length > 0 && (
        <FormGroup>
          <FormControlLabel
            control={
              <Switch size="small" checked={showSpamRequests} onChange={() => setShowSpamRequests(!showSpamRequests)} />
            }
            label="Show spam price requests"
          />
        </FormGroup>
      )}
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
