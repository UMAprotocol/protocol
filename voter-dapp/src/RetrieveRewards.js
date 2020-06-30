import React, { useMemo, useState } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import Button from "@material-ui/core/Button";
import Typography from "@material-ui/core/Typography";

import { useTableStyles } from "./Styles.js";
import { MAX_UINT_VAL, MAX_SAFE_JS_INT, BATCH_MAX_RETRIEVALS } from "./common/Constants.js";
import { PriceRequestStatusEnum } from "./common/Enums.js";

function getOrCreateObj(containingObj, field) {
  if (!containingObj[field]) {
    containingObj[field] = {};
  }

  return containingObj[field];
}

function useRetrieveRewardsTxn(retrievedRewardsEvents, revealedVoteEvents, priceRequests, votingAccount) {
  const { drizzle, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;

  const { send, status } = useCacheSend("Voting", "retrieveRewards");

  if (retrievedRewardsEvents === undefined || revealedVoteEvents === undefined || !priceRequests) {
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

    // Since this loop is the last one, we can use the state to determine if this identifer, time, roundId combo
    // is eligible for a reward claim. We track the oldestUnclaimedRound to determine which round the transaction
    // should query (since only one can be chosen).
    let oldestUnclaimedRound = MAX_SAFE_JS_INT;
    for (let i = 0; i < revealedVoteEvents.length; i++) {
      const event = revealedVoteEvents[i];
      const priceRequest = priceRequests[i];
      const voteState = getVoteState(event.returnValues.identifier, event.returnValues.time);
      const revealRound = event.returnValues.roundId.toString();
      const votedPrice = event.returnValues.price.toString();

      if (
        !voteState.retrievedRewards &&
        priceRequest.lastRound.toString() === revealRound &&
        votedPrice === priceRequest.resolvedPrice.toString()
      ) {
        // Reveal happened in the same round as the price resolution: definitely a retrievable reward.
        oldestUnclaimedRound = Math.min(oldestUnclaimedRound, revealRound);
        voteState.didReveal = true;
        voteState.priceResolutionRound = revealRound;
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
      if (voteState.priceResolutionRound === oldestUnclaimedRound.toString() && voteState.didReveal) {
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
  const { drizzle, useCacheCall, useCacheEvents } = drizzleReactHooks.useDrizzle();
  const classes = useTableStyles();

  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");
  const governorAddress = drizzle.contracts.Governor.address;

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
      const defaultLookback = 7; // Default lookback is 7 rounds (2 weeks).

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

  const revealedVoteEvents = useCacheEvents(
    "Voting",
    "VoteRevealed",
    useMemo(() => {
      return { filter: { voter: votingAccount, roundId: roundIds }, fromBlock: 0 };
    }, [roundIds, votingAccount])
  );

  // Get auxillary information about all price requests that were revealed.
  const priceRequests = useCacheCall(["Voting"], call => {
    if (!revealedVoteEvents) {
      return null;
    }

    const priceRequests = revealedVoteEvents.map(event => {
      return {
        identifier: event.returnValues.identifier,
        time: event.returnValues.time
      };
    });

    // Get each price request's status. This includes whether it has been resolved and the last round where it was
    // voted on.
    const statuses = call("Voting", "getPriceRequestStatuses", priceRequests);

    if (!statuses) {
      return null;
    }

    // Pulls down the price for every resolved request. If the request wasn't resolved, the resolved price isn't
    // queried and the field is left undefined.
    let done = true;
    for (let i = 0; i < priceRequests.length; i++) {
      const priceRequest = priceRequests[i];
      const status = statuses[i];
      priceRequest.lastRound = status.lastVotingRound;
      if (status.status === PriceRequestStatusEnum.RESOLVED) {
        // Note: this method needs to be called "from" the Governor contract since it's approved to "use" the DVM.
        // Otherwise, it will revert.
        priceRequest.resolvedPrice = call("Voting", "getPrice", priceRequest.identifier, priceRequest.time, {
          from: governorAddress
        });

        // Note: a resolved price should always be returned if the status is RESOLVED. No reverts are expected.
        if (!priceRequest.resolvedPrice) done = false;
      }
    }

    return done ? priceRequests : null;
  });

  // Construct the claim rewards transaction.
  const rewardsTxn = useRetrieveRewardsTxn(retrievedRewardsEvents, revealedVoteEvents, priceRequests, votingAccount);

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
