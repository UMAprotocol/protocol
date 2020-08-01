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
 * Queries all liquidation related events (LiquidationCreated, LiquidationDisputed, LiquidationWithdrawn)
 * for a particular EMP
 * @param {String} empAddress
 */
function LIQUIDATION_EVENTS_FOR_EMP(empAddress) {
  return `
    query liquidations {
      financialContracts(where: {id: "${empAddress}"}) {
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
      }
    }
  `;
}

const queries = {
  LIQUIDATION_EVENTS_FOR_EMP
};

module.exports = {
  getUmaClient,
  queries
};
