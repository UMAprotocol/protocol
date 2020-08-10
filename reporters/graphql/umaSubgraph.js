const { GraphQLClient } = require("graphql-request");

/**
 * Return created graphql client or create a new one.
 * @return `createdClient` singleton graphql client.
 */
let subgraphClient;
function getUmaClient() {
  if (!subgraphClient) {
    subgraphClient = new GraphQLClient("https://api.thegraph.com/subgraphs/name/protofire/uma");
  }
  return subgraphClient;
}

/**
 * Queries all data for a particular EMP
 * @param {String} empAddress
 */
function EMP_STATS(empAddress) {
  return `
    query liquidations {
      financialContracts(where: {id: "${empAddress}"}) {
        positions(first: 1000, where: { collateral_gt: 0 }) {
          sponsor {
            id
          }
        }
        liquidations {
          events{
            block
            __typename
            liquidation {
              tokensLiquidated
              lockedCollateral
              sponsor {
                id
              }
              liquidationId
            }
          }
        }
        totalCollateralDeposited
        totalCollateralWithdrawn
        totalSyntheticTokensCreated
        totalSyntheticTokensBurned
      }
    }
  `;
}

const queries = {
  EMP_STATS
};

module.exports = {
  getUmaClient,
  queries
};
