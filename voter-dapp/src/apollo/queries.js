import { gql } from "@apollo/client";

export const PRICE_REQUEST_VOTING_DATA = gql`
  query priceRequestRounds {
    priceRequestRounds {
      identifier {
        id
      }
      roundId
      time
      totalSupplyAtSnapshot
      revealedVotes {
        numTokens
        price
      }
      claimedPercentage
      rewardsClaimed {
        numTokens
      }
      request {
        price
      }
    }
  }
`;
