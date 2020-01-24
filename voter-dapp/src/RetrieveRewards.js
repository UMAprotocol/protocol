import React, { useMemo, useState } from "react";
import { drizzleReactHooks } from "drizzle-react";
import Button from "@material-ui/core/Button";
import Typography from "@material-ui/core/Typography";

import { useTableStyles } from "./Styles.js";
import { MAX_UINT_VAL } from "./common/Constants.js";

const MAX_SAFE_INT = 2147483647;

function getOrCreateObj(containingObj, field) {
  if (!containingObj[field]) {
    containingObj[field] = {};
  }

  return containingObj[field];
}

function useRetrieveRewardsTxn(retrievedRewardsEvents, revealedVoteEvents, priceResolvedEvents, pendingRequests, votingAccount) {
  const { drizzle, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;

  const { send, status } = useCacheSend("Voting", "retrieveRewards");
  const priceRequests = useCacheCall("Voting", "getPendingRequests");

  if (retrievedRewardsEvents === undefined || revealedVoteEvents === undefined || priceResolvedEvents == undefined) {
    // Requests haven't been completed.
    return { ready: false };
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

    const getVoteState = (identifier, time) => {
      const identifier = web3.utils.hexToUtf8(identifier);
      const time = time.toString();

      return getOrCreateObj(state, `${identifier}|${time}`);
    };

    for (const event of retrievedRewardsEvents) {
      const voteState = getVoteState(event.returnValues.identifier, event.returnValues.time.toString());

      voteState.retrievedRewards = true;
    }

    for (const event of priceResolvedEvents) {
      const voteState = getVoteState(event.returnValues.identifier, event.returnValues.time.toString());

      voteState.priceResolutionRound = event.returnValues.resolutionRoundId.toString();
    }

    let oldestUnclaimedRound = MAX_SAFE_INT;
    for (const event of revealedVoteEvents) {
      const voteState = getVoteState(event.returnValues.identifier, event.returnValues.time.toString());
      const revealRound = event.returnValues.roundId.toString();

      if (!voteState.retrievedRewards && voteState.priceResolutionRound === revealRound) {
        // Reveal happened in the same round as the price resolution: definitely a retrievable reward.
        oldestUnclaimedRound = Math.min(oldestUnclaimedRound, event.returnValues.roundId.toString());
        voteState.didReveal = true;
      }
    }

    if (oldestUnclaimedRound === MAX_SAFE_INT) {
      // No unclaimed rounds were found.
      return { ready: true };
    }

    // Extract identifiers and times from the round we picked.
    const toRetrieve = [];
    const maxBatchRetrievals = 25;
    for (const [key, voteState] of Object.entries(state)) {
      if (!voteState.retrievedRewards && voteState.priceResolutionRound === oldestUnclaimedRound.toString() && voteState.didReveal) {
        const [identifier, time] = key.split("|");
        toRetrieve.push({ identifier: web3.utils.utf8ToHex(identifier), time: time });
      }

      if (toRetrieve.length === maxBatchRetrievals) {
        break;
      }
    }

    // Create the txn send function and return it.
    const retrieveRewards = () => {
      send(votingAccount, oldestUnclaimedRound.toString(), toRetrieve);
    };

    return { ready: true, send: retrieveRewards, status: status };
  }
}

function RetrieveRewards({ votingAccount }) {
  const { drizzle, useCacheCall, useCacheEvents } = drizzleReactHooks.useDrizzle();
  const classes = useTableStyles();

  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");
  const pendingRequests = useCacheCall("Voting", "getPendingRequests");

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
      return Array.from({ length: windowLength }, (v, i) => lastCompletedRound - i);
    }
  }, [currentRoundId, queryAllRounds]);

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
      return { filter: { voter: votingAccount, resolutionRoundId: roundIds }, fromBlock: 0 };
    }, [roundIds, votingAccount])
  );

  const revealedVoteEvents = useCacheEvents(
    "Voting",
    "VoteRevealed",
    useMemo(() => {
      return { filter: { voter: votingAccount, roundId: roundIds }, fromBlock: 0 };
    }, [roundIds, votingAccount])
  );

  const rewardsTxn = useRetrieveRewardsTxn(
    retrievedRewardsEvents,
    revealedVoteEvents,
    priceResolvedEvents,
    pendingRequests,
    votingAccount
  );

  let body = "";
  if (!rewardsTxn.ready) {
    body = "Loading";
  } else if (rewardsTxn.send) {
    body = (
      <Button onClick={rewardsTxn.send} variant="contained" color="primary">
        Claim Your Rewards
      </Button>
    );
  } else if (!queryAllRounds) {
    body = (
      <Button onClick={() => setQueryAllRounds(true)} variant="contained" color="primary">
        Search all past rounds for unclaimed rewards
      </Button>
    );
  } else {
    body = "You have no unclaimed rewards to claim.";
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
