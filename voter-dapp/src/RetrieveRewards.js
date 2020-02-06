import React, { useMemo, useState } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import Button from "@material-ui/core/Button";
import Typography from "@material-ui/core/Typography";

import { useTableStyles } from "./Styles.js";
import { MAX_UINT_VAL, MAX_SAFE_JS_INT, BATCH_MAX_RETRIEVALS } from "./common/Constants.js";

function getOrCreateObj(containingObj, field) {
  if (!containingObj[field]) {
    containingObj[field] = {};
  }

  return containingObj[field];
}

function useRetrieveRewardsTxn(retrievedRewardsEvents, revealedVoteEvents, priceResolvedEvents, votingAccount) {
  const { drizzle, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;

  const { send, status } = useCacheSend("Voting", "retrieveRewards");

  if (retrievedRewardsEvents === undefined || revealedVoteEvents === undefined || priceResolvedEvents === undefined) {
    // Requests haven't been completed.
    return { ready: false, status };
  } else {
    // Put events into a simple mapping from identifier|time -> state
    const state = {};

    // Function to get the voteState object for an identifier and time.
    const getVoteState = (identifierIn, timeIn) => {
      const identifier = web3.utils.hexToUtf8(identifierIn);
      const time = timeIn.toString();

      return getOrCreateObj(state, `${identifier}|${time}`);
    };

    // Each of the following loops adds the relevant portions of the event state to the corresponding voteState data
    // structure.
    for (const event of retrievedRewardsEvents) {
      const voteState = getVoteState(event.returnValues.identifier, event.returnValues.time);

      voteState.retrievedRewards = true;
    }

    for (const event of priceResolvedEvents) {
      const voteState = getVoteState(event.returnValues.identifier, event.returnValues.time);

      voteState.priceResolutionRound = event.returnValues.resolutionRoundId.toString();
    }

    // Since this loop is the last one, we can use the state to determine if this identifer, time, roundId combo
    // is eligible for a reward claim. We track the oldestUnclaimedRound to determine which round the transaction
    // should query (since only one can be chosen).
    let oldestUnclaimedRound = MAX_SAFE_JS_INT;
    for (const event of revealedVoteEvents) {
      const voteState = getVoteState(event.returnValues.identifier, event.returnValues.time);
      const revealRound = event.returnValues.roundId.toString();

      if (!voteState.retrievedRewards && voteState.priceResolutionRound === revealRound) {
        // Reveal happened in the same round as the price resolution: definitely a retrievable reward.
        oldestUnclaimedRound = Math.min(oldestUnclaimedRound, revealRound);
        voteState.didReveal = true;
      }
    }

    if (oldestUnclaimedRound === MAX_SAFE_JS_INT) {
      // No unclaimed rounds were found.
      return { ready: true, status };
    }

    // Extract identifiers and times from the round we picked.
    const toRetrieve = [];
    const maxBatchRetrievals = BATCH_MAX_RETRIEVALS;
    for (const [key, voteState] of Object.entries(state)) {
      if (
        !voteState.retrievedRewards &&
        voteState.priceResolutionRound === oldestUnclaimedRound.toString() &&
        voteState.didReveal
      ) {
        // If this is an eligible reward for the oldest round, extract the information and push it into the retrieval array.
        const [identifier, time] = key.split("|");
        toRetrieve.push({ identifier: web3.utils.utf8ToHex(identifier), time: time });
      }

      // Only so many reward claims can fit in a single transaction, so break if we go over that limit.
      if (toRetrieve.length === maxBatchRetrievals) {
        break;
      }
    }

    // Create the txn send function and return it.
    const retrieveRewards = () => {
      send(votingAccount, oldestUnclaimedRound.toString(), toRetrieve);
    };

    return { ready: true, send: retrieveRewards, status };
  }
}

function RetrieveRewards({ votingAccount }) {
  const { useCacheCall, useCacheEvents } = drizzleReactHooks.useDrizzle();
  const classes = useTableStyles();

  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");

  // This variable tracks whether the user only wants to query a limited lookback or all history for unclaimed rewards.
  const [queryAllRounds, setQueryAllRounds] = useState(false);

  // Determines the list of roundIds to query for. Will return undefined if the user wants to search the entire history.
  const roundIds = useMemo(() => {
    if (queryAllRounds) {
      // Signal that all rounds should be searched by setting the query parameter to undefined.
      return undefined;
    } else if (currentRoundId === undefined) {
      // Should always return nothing, which is desired before we know the round id.
      return MAX_UINT_VAL;
    } else {
      // This section will produce an array of roundIds that should be queried for unclaimed rewards.
      const defaultLookback = 10; // Default lookback is 10 rounds.

      // Window length should be the lookback or currentRoundId (so the numbers don't go below 0), whichever is smaller.
      const windowLength = Math.min(currentRoundId, defaultLookback);
      const lastCompletedRound = currentRoundId - 1;

      // If the lastCompletedRound is 20, this creates the following array:
      // [20, 19, 18, 17, 16, 15, 14, 13, 12, 11]
      return Array.from({ length: windowLength }, (v, i) => lastCompletedRound - i);
    }
  }, [currentRoundId, queryAllRounds]);

  // Query all reward retrievals for this user, reveals for this user, and price resolutions for the roundIds selected above.
  const retrievedRewardsEvents = useCacheEvents(
    "Voting",
    "RewardsRetrieved",
    useMemo(() => {
      return { filter: { voter: votingAccount, roundId: roundIds }, fromBlock: 0 };
    }, [roundIds, votingAccount])
  );

  const priceResolvedEvents = useCacheEvents(
    "Voting",
    "PriceResolved",
    useMemo(() => {
      return { filter: { resolutionRoundId: roundIds }, fromBlock: 0 };
    }, [roundIds])
  );

  const revealedVoteEvents = useCacheEvents(
    "Voting",
    "VoteRevealed",
    useMemo(() => {
      return { filter: { voter: votingAccount, roundId: roundIds }, fromBlock: 0 };
    }, [roundIds, votingAccount])
  );

  // Construct the claim rewards transaction.
  const rewardsTxn = useRetrieveRewardsTxn(
    retrievedRewardsEvents,
    revealedVoteEvents,
    priceResolvedEvents,
    votingAccount
  );

  let body = "";
  const hasPendingTxns = rewardsTxn.status === "pending";
  if (!rewardsTxn.ready) {
    body = "Loading";
  } else if (rewardsTxn.send) {
    body = (
      <Button onClick={rewardsTxn.send} variant="contained" color="primary" disabled={hasPendingTxns}>
        Claim Your Rewards
      </Button>
    );
  } else if (!queryAllRounds) {
    body = (
      <>
        <div>No unclaimed rewards found in the last 10 rounds.</div>
        <Button onClick={() => setQueryAllRounds(true)} variant="contained" color="primary" disabled={hasPendingTxns}>
          Search all past rounds for unclaimed rewards
        </Button>
      </>
    );
  } else {
    body = "No unclaimed rewards found, yet.";
  }

  return (
    <div className={classes.root}>
      <Typography variant="h6" component="h6">
        Retrieve Voting Rewards
      </Typography>
      {body}
    </div>
  );
}

export default RetrieveRewards;
