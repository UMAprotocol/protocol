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
      commitedVotes {
        voter {
          address
        }
      }
      revealedVotes {
        numTokens
        price
        voter {
          address
        }
      }
      claimedPercentage
      rewardsClaimed {
        numTokens
        claimer {
          address
        }
      }
      request {
        price
      }
    }
  }
`;
