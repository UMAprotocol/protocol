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
  DialogContent,
  DialogContentText,
  List,
  ListItem,
  ListItemText
} from "@material-ui/core";

import { useTableStyles } from "./Styles.js";
import {
  formatDate,
  translateAdminVote,
  getAdminRequestId,
  decodeTransaction,
  isAdminRequest,
  MAX_UINT_VAL,
  IDENTIFIER_BLACKLIST,
  getPrecisionForIdentifier,
  formatFixed
} from "@uma/common";

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
  const [openExplainAdminDialog, setOpenExplainAdminDialog] = useState(false);
  const [voteStatsDialogData, setVoteStatDialogData] = useState(null);
  const [explainAdminDialogData, setExplainAdminDialogData] = useState(null);
  const [showSpamRequests, setShowSpamRequests] = useState(false);
  const [hasSpamRequests, setHasSpamRequests] = useState(false);
  const [resolvedEvents, setResolvedEvents] = useState([]);

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

  /**
   * Decoding Admin Proposals
   */
  const handleClickExplain = index => {
    setOpenExplainAdminDialog(true);
    setExplainAdminDialogData(index);
  };
  const adminProposals = useCacheCall(["Governor"], call => {
    return resolvedEvents.map(request => ({
      id: isAdminRequest(hexToUtf8(request.returnValues.identifier))
        ? getAdminRequestId(hexToUtf8(request.returnValues.identifier))
        : null
    }));
  });
  const newProposalEvents = useCacheEvents(
    "Governor",
    "NewProposal",
    useMemo(() => ({ fromBlock: 0 }))
  );
  const decodeRequestIndex = index => {
    const proposal = adminProposals[index];

    if (newProposalEvents) {
      const proposalEventWithId = newProposalEvents.find(p => p.returnValues.id.toString() === proposal.id.toString());
      if (proposalEventWithId) {
        const transactions = proposalEventWithId.returnValues.transactions;
        let output =
          hexToUtf8(resolvedEvents[index].returnValues.identifier) + " (" + transactions.length + " transaction(s))";
        for (let i = 0; i < transactions.length; i++) {
          const transaction = transactions[i];
          output += "\n\nTransaction #" + i + ":\n" + decodeTransaction(transaction);
        }
        return output;
      }
    }
  };

  /**
   * Displaying vote statistics via graphQL API
   */
  const handleClickStats = voteStats => {
    setOpenVoteStatsDialog(true);
    setVoteStatDialogData(voteStats);
  };

  const handleCloseDialogs = () => {
    setOpenVoteStatsDialog(false);
    setOpenExplainAdminDialog(false);
  };

  // Only display non-blacklisted price requests (uniquely identifier by identifier name and timestamp)
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
  useEffect(() => {
    setHasSpamRequests(false);

    if (allResolvedEvents) {
      const nonBlacklistedRequests = allResolvedEvents.filter(ev => {
        if (!IDENTIFIER_BLACKLIST[hexToUtf8(ev.returnValues.identifier)]) return true;
        else {
          if (!IDENTIFIER_BLACKLIST[hexToUtf8(ev.returnValues.identifier)].includes(ev.returnValues.time)) {
            return true;
          } else return false;
        }
      });
      // If there is at least 1 spam request, set this flag which we'll use to determine whether to show the spam filter switch to users.
      if (nonBlacklistedRequests.length < allResolvedEvents.length) {
        nonBlacklistedRequests(true);
      }

      if (showSpamRequests) {
        setResolvedEvents(allResolvedEvents);
      } else {
        setResolvedEvents(nonBlacklistedRequests);
      }
    }
  }, [allResolvedEvents, IDENTIFIER_BLACKLIST, showSpamRequests]);

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
      <Dialog onClose={handleCloseDialogs} open={openExplainAdminDialog}>
        <DialogTitle>Admin Proposal</DialogTitle>
        {explainAdminDialogData && (
          <DialogContent>
            <DialogContentText style={{ whiteSpace: "pre-wrap" }}>
              {decodeRequestIndex(explainAdminDialogData)}
            </DialogContentText>
          </DialogContent>
        )}
      </Dialog>
      <Dialog onClose={handleCloseDialogs} open={openVoteStatsDialog}>
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
      {/* Only render this spam filter switch if some resolved spam requests have been filtered out */}
      {hasSpamRequests && (
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

            const identifierPrecision = getPrecisionForIdentifier(hexToUtf8(resolutionData.identifier));

            const userVote = revealEvent ? formatFixed(revealEvent.returnValues.price, identifierPrecision) : "No Vote";
            const correctVote = formatFixed(resolutionData.price, identifierPrecision);

            const isAdminVote = isAdminRequest(hexToUtf8(resolutionData.identifier));

            const voteStats = getVoteStats(resolutionData);

            return (
              <TableRow key={index}>
                <TableCell>
                  {hexToUtf8(resolutionData.identifier)}
                  {isAdminVote && (
                    <Button
                      variant="contained"
                      style={{ marginLeft: "10px" }}
                      color="primary"
                      onClick={() => handleClickExplain(index)}
                    >
                      Explain
                    </Button>
                  )}
                </TableCell>
                <TableCell>{formatDate(resolutionData.time, web3)}</TableCell>
                <TableCell>Resolved</TableCell>
                <TableCell>{isAdminVote && userVote !== "No Vote" ? translateAdminVote(userVote) : userVote}</TableCell>
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
