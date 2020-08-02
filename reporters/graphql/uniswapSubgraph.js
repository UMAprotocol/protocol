const { GraphQLClient } = require("graphql-request");

/**
 * Return created graphql client or create a new one.
 * @return `createdClient` singleton graphql client.
 */
let subgraphClient;
function getUniswapClient() {
  if (!subgraphClient) {
    subgraphClient = new GraphQLClient("https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2");
  }
  return subgraphClient;
}

/**
 * @notice Return query to get pair data for uniswap pair @ `pairAddress` up to `block` height. Default block height
 * is latest block available in subgraph. This should not be assumed to be the latest mined block for the network,
 * which might be higher than the latest block available in the subgraph.
 * @param {String} pairAddress Address of uniswap pair
 * @param {[Integer]} block Highest block number to query data from.
 * @return query string
 */
function PAIR_DATA(pairAddress, block) {
  const queryString = block
    ? `
            query pairs {
                pairs(block: {number: ${block}}, where: {id: "${pairAddress}"}) {
                    txCount
                    volumeToken1
                    volumeToken0
                }
            }
        `
    : `
            query pairs {
                pairs(where: {id: "${pairAddress}"}) {
                    txCount
                    volumeToken1
                    volumeToken0
                }
            }
        `;
  return queryString;
}

/**
 * @notice Returns query to get timestamp and blocknumber of latest swap for a pair @ `pairAddress`.
 */
function LAST_TRADE_FOR_PAIR(pairAddress) {
  return `
    query pairs {
      swaps(orderBy: timestamp, orderDirection: desc, first: 1, where: {pair: "${pairAddress}"}) {
        transaction {
          blockNumber
          timestamp
        }
      }
    }
  `;
}

const queries = {
  PAIR_DATA,
  LAST_TRADE_FOR_PAIR
};

module.exports = {
  getUniswapClient,
  queries
};
