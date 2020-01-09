import React, { useMemo, useState } from "react";
import { drizzleReactHooks } from "drizzle-react";
import Button from "@material-ui/core/Button";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Typography from "@material-ui/core/Typography";

import { useTableStyles } from "./Styles.js";
import { formatDate } from "./common/FormattingUtils.js";
import { MAX_UINT_VAL } from "./common/Constants.js";

function useRetrieveRewardsTxn(retrievedRewardsEvents, priceResolvedEvents, revealedVoteEvents) {
  if (retrievedRewardsEvents === undefined || priceResolvedEvents === undefined || revealedVoteEvents === undefined) {
    // Requests haven't been completed.
    return null;
  } else {
    // Loop through and match up.

    // Short circuits
//     if (priceResolvedEvents.length === retrievedRewardsEvents.length) {
//       // If the voter has as many reward retrievals as there were resolved prices in these rounds, then we should be done.
//       return null;
//     }
// 
//     if (revealedVoteEvents.length === retrievedRewardsEvents.length) {
//       // If the voter has retrieved rewards for each reveal, they should be done retrieving for all of these rounds.
//       return null;
//     }

    // Place resolution events 


  }
}

function RetrieveRewards({ votingAccount }) {
  const { drizzle, useCacheCall, useCacheEvents } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const classes = useTableStyles();

  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");


  const [queryAllRounds, setQueryAllRounds] = useState(false);

  // 1a. Find last n rounds of reward retrieval.
  // 1b. Find last n rounds of price resolutions.
  // 1c. Find last n rounds of vote reveals.
  // 2. Find all price resolutions with a corresponding reveal (price, round, time, and identifier must match), but without a reward retrieval and group them by round.
  // 3. Find the oldest round and construct a button with a txn that requests rewards for all reveals in that round.
  // 4. Tell the user that they have n rounds that they have not fully claimed rewards for.

  const roundIds = useMemo(() => {
    if (queryAllRounds) {
      // Signal that all rounds should be searched by setting the query parameter to undefined.
      return undefined;
    } else if (currentRoundId === undefined) {
      // Should always return nothing, which is desired before we know the round id.
      return MAX_UINT_VAL;
    } else {
      // This section will produce an array of roundIds that should be queried for unclaimed rewards.
      const lookback = 10;

      // Window length should be the lookback or currentRoundId (so the numbers don't go below 0), whichever is smaller.
      const windowLength = Math.min(currentRoundId, lookback);
      const lastCompletedRound = currentRoundId - 1;

      // If the lastCompletedRound is 20, this creates the following array:
      // [20, 19, 18, 17, 16, 15, 14, 13, 12, 11]
      return Array.from({length: windowLength}, (v, i) => lastCompletedRound - i); 
    }
  }, [currentRoundId, queryAllRounds]);

  const retrievedRewardsEvents = useCacheEvents(
      "Voting",
      "RewardsRetrieved",
      useMemo(() => {
        return { filter: { voter: votingAccount, roundId: roundIds }, fromBlock: 0 };
      }, [roundIds, votingAccount])
    );

  const priceResolvedEvents =
    useCacheEvents(
      "Voting",
      "PriceResolved",
      useMemo(() => {
        return { filter: { resolutionRoundId: roundIds }, fromBlock: 0 };
      }, [roundIds])
    );

  const revealedVoteEvents =
    useCacheEvents(
      "Voting",
      "VoteRevealed",
      useMemo(() => {
        return { filter: { voter: votingAccount, roundId: roundIds }, fromBlock: 0 };
      }, [roundIds, votingAccount])
    );

  // Handler for when the user clicks the button to toggle showing all resolved requests.
  const clickShowAll = useMemo(
    () => () => {
      setShowAllResolvedRequests(!showAllResolvedRequests);
    },
    [showAllResolvedRequests]
  );

  let retrieveSend = useRetrieveRewardsTxn(retrievedRewardsEvents, priceResolvedEvents, revealedVoteEvents);

  // TODO: add a resolved timestamp to the table so the sorting makes more sense to the user.
  // Sort the resolved requests such that they are organized from most recent to least recent round.
  const resolvedEventsSorted = resolvedEvents.sort((a, b) => {
    const aRoundId = web3.utils.toBN(a.returnValues.resolutionRoundId);
    const bRoundId = web3.utils.toBN(b.returnValues.resolutionRoundId);
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
      <Button onClick={clickShowAll} variant="contained" color="primary">
        Show {showAllResolvedRequests ? "only recently" : "all"} resolved requests
      </Button>
    </div>
  );
}

export default RetrieveRewards;