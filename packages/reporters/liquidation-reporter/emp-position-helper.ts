const fetch = require("node-fetch");

export async function getAllEmpsPositions() {
  const subgraphUrl = "https://api.thegraph.com/subgraphs/name/umaprotocol/mainnet-contracts";
  const query = `
    query activePositions {
      financialContracts {
        id
        positions(first: 1000, where: { collateral_gt: 0 }) {
          collateral
          isEnded
          tokensOutstanding
          withdrawalRequestPassTimestamp
          withdrawalRequestAmount
          transferPositionRequestPassTimestamp
          sponsor {
            id
          }
        }
      }
    }
  `;
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  return (await response.json()).data.financialContracts;
}
