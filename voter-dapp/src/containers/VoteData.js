import { createContainer } from "unstated-next";
import { useState, useEffect } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";

import { useQuery } from "@apollo/client";
import { PRICE_REQUEST_VOTING_DATA } from "../apollo/queries";

// Retrieve vote data per price request from graphQL API.
function useVoteData() {
  const { drizzle } = drizzleReactHooks.useDrizzle();
  const VotingContract = drizzle.contracts.Voting;
  const { web3 } = drizzle;
  const { toBN, fromWei, toWei, toChecksumAddress } = web3.utils;
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
  const getVoteStats = async () => {
    if (error) {
      console.error("Failed to get data:", error);
    }
    if (!loading && data) {
      const newVoteData = {};

      // TODO: round inflationRate is not available yet on the subgraph, but we will query this from the subgraph instead of
      // making an on-chain call when it is added. For now, grab round inflation rates in parallel since these are contract calls.
      const roundInflationRates = {};
      await Promise.all(
        data.priceRequestRounds.map(async dataForRequest => {
          roundInflationRates[dataForRequest.roundId] = (
            await VotingContract.methods.rounds(dataForRequest.roundId).call()
          ).inflationRate;
        })
      );

      // Load data into `newVoteData` synchronously
      data.priceRequestRounds.forEach(dataForRequest => {
        const newRoundKey = getRequestKey(dataForRequest.time, dataForRequest.identifier.id, dataForRequest.roundId);

        // Commit vote data:
        let uniqueVotersCommitted = {};
        dataForRequest.commitedVotes.forEach(e => {
          uniqueVotersCommitted[toChecksumAddress(e.voter.address)] = true;
        });

        // Revealed vote data:
        let totalVotesRevealed = toBN("0");
        let correctVotesRevealed = toBN("0");
        let pctOfVotesRevealed = toBN("0");
        let pctOfCorrectRevealedVotes = toBN("0");
        let uniqueVotersRevealed = {};

        // If the total supply has not been snapshotted yet, then there will not be revealed
        // vote data because the round has not entered the Reveal phase yet
        if (dataForRequest.totalSupplyAtSnapshot) {
          dataForRequest.revealedVotes.forEach(e => {
            totalVotesRevealed = totalVotesRevealed.add(toBN(e.numTokens));
            if (e.price === dataForRequest.request.price) {
              correctVotesRevealed = correctVotesRevealed.add(toBN(e.numTokens));
            }
            uniqueVotersRevealed[toChecksumAddress(e.voter.address)] = true;
          });
          pctOfVotesRevealed = totalVotesRevealed
            .mul(toBN(toWei("1")))
            .div(toBN(toWei(dataForRequest.totalSupplyAtSnapshot)));
          pctOfCorrectRevealedVotes = correctVotesRevealed.mul(toBN(toWei("1"))).div(totalVotesRevealed);
        }

        // Rewards claimed data:
        let rewardsClaimed = toBN("0");
        let rewardsClaimedPct = toBN("0");
        let uniqueClaimers = {};

        // If the total supply was not snapshotted yet, then rewards could not have been claimed yet.
        if (dataForRequest.totalSupplyAtSnapshot) {
          dataForRequest.rewardsClaimed.forEach(e => {
            rewardsClaimed = rewardsClaimed.add(toBN(e.numTokens));
            uniqueClaimers[toChecksumAddress(e.claimer.address)] = true;
          });

          const roundInflationRate = roundInflationRates[dataForRequest.roundId];
          const roundInflationPct = toBN(roundInflationRate.rawValue.toString());
          const roundInflationRewardsAvailable = roundInflationPct
            .mul(toBN(toWei(dataForRequest.totalSupplyAtSnapshot)))
            .div(toBN(toWei("1")));
          if (!roundInflationRewardsAvailable.isZero()) {
            rewardsClaimedPct = rewardsClaimed.mul(toBN(toWei("1"))).div(roundInflationRewardsAvailable);
          }
        }

        // Insert round data into new object.
        newVoteData[newRoundKey] = {
          totalSupplyAtSnapshot: dataForRequest.totalSupplyAtSnapshot,
          uniqueCommits: Object.keys(uniqueVotersCommitted).length,
          revealedVotes: fromWei(totalVotesRevealed.toString()),
          revealedVotesPct: fromWei(pctOfVotesRevealed.mul(toBN("100")).toString()),
          uniqueReveals: Object.keys(uniqueVotersRevealed).length,
          uniqueRevealsPctOfCommits:
            100 * (Object.keys(uniqueVotersRevealed).length / Object.keys(uniqueVotersCommitted).length),
          correctVotes: fromWei(correctVotesRevealed.toString()),
          correctlyRevealedVotesPct: fromWei(pctOfCorrectRevealedVotes.mul(toBN("100")).toString()),
          rewardsClaimed: fromWei(rewardsClaimed.toString()),
          rewardsClaimedPct: fromWei(rewardsClaimedPct.mul(toBN("100")).toString()),
          uniqueClaimers: Object.keys(uniqueClaimers).length,
          uniqueClaimersPctOfReveals:
            100 * (Object.keys(uniqueClaimers).length / Object.keys(uniqueVotersRevealed).length)
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
