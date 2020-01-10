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

const MAX_SAFE_INT = 2147483647;


function getOrCreateObj(containingObj, field) {
  if (!containingObj[fieldName]) {
    containingObj[fieldName] = {};
  }

  return containingObj[fieldName];
}

function useRetrieveRewardsTxn(retrievedRewardsEvents, priceResolvedEvents, revealedVoteEvents, votingAccount) {
  const { useCacheSend } = drizzleReactHooks.useDrizzle();

  const { send, status } = useCacheSend("Voting", "retrieveRewards");

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

    // Put events into objects.
    const state = {};


    const getVoteState = (event, roundIdFieldName) => {
      const roundId = event.returnValues[roundFieldName].toString();
      const identifier = web3.utils.hexToUtf8(event.returnValues.identifier);
      const time = event.returnValues.time.toString();
      
      const roundState = getOrCreateObj(state, roundId);
      return getOrCreateObj(roundState, `${identifier}|${time}`);
    }

    for (const event of retrievedRewardsEvents) {
      const voteState = getVoteState(event, "roundId");

      voteState.retrievedRewards = true;
    }

    for (const event of priceResolvedEvents) {
      const voteState = getVoteState(event, "resolutionRoundId");

      voteState.priceResolved = true;
    }

    let oldestUnclaimedRound = MAX_SAFE_INT;
    for (const event of revealedVoteEvents) {
      const voteState = getVoteState(event, "roundId");

      voteState.revealed = true;

      if (!voteState.retrievedRewards && voteState.priceResolved) {
        oldestUnclaimedRound = Math.min(oldestUnclaimedRound, event.returnValues.roundId.toString());
      }
    }

    if (oldestUnclaimedRound === MAX_SAFE_INT) {
      // No unclaimed rounds were found.
      return null;
    }

    // Extract identifiers and times from the round we picked.
    const toRetrieve = [];

    // TODO: we arbitrarily set the max number of retrievals to 10 until we have better data on how many we can fit
    // into a signle txn.
    const maxRetrievals = 10;
    for (const [key, voteState] of Object.entries(state[oldestUnclaimedRound])) {
      if (!voteState.retrievedRewards && voteState.priceResolved && voteState.revealed) {
        const [identifier, time] = key.split("|");
        toRetrieve.push({ identifier: web3.utils.utf8ToHex(identifier), time: time });
      }

      if (toRetrieve.length === maxRetrievals) {
        break;
      }
    }

    // Create the txn send function and return it.
    const retrieveRewards = () => {
      send(votingAccount, oldestUnclaimedRound, toRetrieve);
    }

    return { send: retrievedRewards, status: status };
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

  const rewardsTxn = useRetrieveRewardsTxn(retrievedRewardsEvents, priceResolvedEvents, revealedVoteEvents, votingAccount);

  // Handler for when the user clicks the button to toggle showing all resolved requests.
  const clickQueryAll = useMemo(
    () => () => {
      setQueryAllRounds(!queryAllRounds);
    },
    [queryAllRounds]
  );

  return (
    <div className={classes.root}>
      <Typography variant="h6" component="h6">
        Retrieve Voting Rewards
      </Typography>

      <Button onClick={clickQueryAll} variant="contained" color="primary">
        Search {queryAllRounds ? "only recent" : "all"} rounds for unclaimed rewards
      </Button>
    </div>
  );
}

export default RetrieveRewards;