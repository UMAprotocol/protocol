// TODO: We should group together graphql related modules but I'm using this location
// for now because this is the only use case.

const { GraphQLClient } = require("graphql-request");

/**
 * Return created graphql client or create a new one.
 * @return `createdClient` singleton graphql client.
 */
let uniswapClient;
function getUniswapClient() {
  if (!uniswapClient) {
    uniswapClient = new GraphQLClient("https://api.thegraph.com/subgraphs/name/ianlapham/unsiwap3");
  }
  return uniswapClient;
}

/**
 * @notice Return query to get pair data for uniswap pair @ `pairAddress` up to `block`-3 height. Default block height
 * is latest block available in subgraph. This should not be assumed to be the latest mined block for the network,
 * which might be higher than the latest block available in the subgraph.
 * @dev We subtract from the `block` height conservatively because we have observed a delay between the latest network block # (i.e. web3.eth.getBlockNumber),
 * and the latest block number available in the Uniswap subgraph.
 * @param {String} pairAddress Address of uniswap pair
 * @param {[Integer]} block Highest block number to query data from.
 * @return query string
 */
function PAIR_DATA(pairAddress, block) {
  const blockNumberLag = 3;
  const queryString = block
    ? `
            query pairs {
                pairs(block: {number: ${block - blockNumberLag}}, where: {id: "${pairAddress}"}) {
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

const queries = {
  PAIR_DATA
};

module.exports = {
  getUniswapClient,
  queries
};
