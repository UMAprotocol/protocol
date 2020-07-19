import { createContainer } from "unstated-next";
import { useState, useEffect } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";

import { useQuery } from "@apollo/client";
import { PRICE_REQUEST_VOTING_DATA } from "../apollo/queries";

// Retrieve vote data per price request from graphQL API.
function useVoteData() {
  const { drizzle } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const { toBN, fromWei, toWei, hexToUtf8 } = web3.utils;
  const [roundVoteData, setRoundVoteData] = useState({});

  // Because apollo caches results of queries, we will poll/refresh this query periodically.
  // We set the poll interval to a very slow 5 seconds for now since the position states
  // are not expected to change much.
  // Source: https://www.apollographql.com/docs/react/data/queries/#polling
  const { loading, error, data } = useQuery(PRICE_REQUEST_VOTING_DATA, {
    pollInterval: 5000
  });

  const getRequestKey = (time, identifier, roundId) => {
    return identifier + "-" + time + "-" + roundId;
  };
  const getVoteStats = () => {
    if (error) {
      console.error("Failed to get data:", error);
    }
    if (!loading && data) {
      const newVoteData = {};

      data.priceRequestRounds.forEach(dataForRequest => {
        const newRoundKey = getRequestKey(dataForRequest.time, dataForRequest.identifier.id, dataForRequest.roundId);

        // Revealed vote data:
        let totalVotesRevealed = toBN("0");
        let correctVotesRevealed = toBN("0");
        let pctOfVotesRevealed = toBN("0");
        let pctOfCorrectRevealedVotes = toBN("0");

        // If the total supply has not been snapshotted yet, then there will not be revealed
        // vote data because the round has not entered the Reveal phase yet
        if (dataForRequest.totalSupplyAtSnapshot) {
          dataForRequest.revealedVotes.forEach(e => {
            totalVotesRevealed = totalVotesRevealed.add(toBN(e.numTokens));
            if (e.price === dataForRequest.request.price) {
              correctVotesRevealed = correctVotesRevealed.add(toBN(e.numTokens));
            }
          });
          pctOfVotesRevealed = totalVotesRevealed
            .mul(toBN(toWei("1")))
            .div(toBN(toWei(dataForRequest.totalSupplyAtSnapshot)));
          pctOfCorrectRevealedVotes = correctVotesRevealed.mul(toBN(toWei("1"))).div(totalVotesRevealed);
        }

        // Rewards claimed data:
        let rewardsClaimed = toBN("0");

        // If `claimedPercentage` is null, then the round did not resolve or has not resolved yet.
        if (dataForRequest.claimedPercentage) {
          dataForRequest.rewardsClaimed.forEach(e => {
            rewardsClaimed = rewardsClaimed.add(toBN(e.numTokens));
          });
        }

        // Insert round data into new object.
        newVoteData[newRoundKey] = {
          totalSupplyAtSnapshot: dataForRequest.totalSupplyAtSnapshot,
          revealedVotes: fromWei(totalVotesRevealed.toString()),
          revealedVotesPct: fromWei(pctOfVotesRevealed.mul(toBN("100")).toString()),
          correctVotes: fromWei(correctVotesRevealed.toString()),
          correctlyRevealedVotesPct: fromWei(pctOfCorrectRevealedVotes.mul(toBN("100")).toString()),
          rewardsClaimed: fromWei(rewardsClaimed.toString()),
          rewardsClaimedPct: dataForRequest.claimedPercentage
        };
      });

      setRoundVoteData(newVoteData);
    }
  };

  // Refresh the object every time the graphQL API response changes
  useEffect(() => {
    getVoteStats();
  }, [loading, error, data]);

  return { roundVoteData, getRequestKey };
}

const VoteData = createContainer(useVoteData);

export default VoteData;
