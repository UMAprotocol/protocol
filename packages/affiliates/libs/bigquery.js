const moment = require("moment");
const assert = require("assert");
const lodash = require("lodash");

// Big query class meant for interacting with the ethereum table.
module.exports = ({ client } = {}) => {
  assert(client, "requires bigquery client");

  // types of queries we are interested in
  const queries = {
    // logs aka events by contract
    logsByContract(contract, start, end = Date.now(), selection = ["*"]) {
      assert(contract, "requires contract");
      assert(start, "requires start");
      start = moment(start).format("YYYY-MM-DD hh:mm:ss");
      end = moment(end).format("YYYY-MM-DD hh:mm:ss");
      // require an array of values
      selection = lodash.castArray(selection);
      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.logs
        WHERE
          block_timestamp > TIMESTAMP('${start}')
          AND block_timestamp < TIMESTAMP('${end}')
          AND LOWER(address)=LOWER('${contract}')
        ORDER BY block_timestamp ASC;
      `;
    },
    // transactions by contract
    transactionsByContract(contract, start, end = Date.now(), selection = ["*"]) {
      assert(contract, "requires contract");
      assert(start, "requires start");
      start = moment(start).format("YYYY-MM-DD hh:mm:ss");
      end = moment(end).format("YYYY-MM-DD hh:mm:ss");
      selection = lodash.castArray(selection);

      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.transactions
        WHERE
          block_timestamp > TIMESTAMP('${start}')
          AND block_timestamp < TIMESTAMP('${end}')
          AND LOWER(to_address)=LOWER('${contract}')
        ORDER BY block_timestamp ASC;
      `;
    }
  };

  async function streamLogsByContract(...args) {
    const query = queries.logsByContract(...args);
    return client.createQueryStream({ query });
  }
  async function streamTransactionsByContract(...args) {
    const query = queries.transactionsByContract(...args);
    return client.createQueryStream({ query });
  }
  async function getLogsByContract(...args) {
    const query = queries.logsByContract(...args);
    const [job] = await client.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    return rows;
  }
  async function getTransactionsByContract(...args) {
    const query = queries.transactionsByContract(...args);
    const [job] = await client.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    return rows;
  }

  return {
    // main api, use streams or "get" to return data as array
    streamLogsByContract,
    streamTransactionsByContract,
    getLogsByContract,
    getTransactionsByContract,
    // exposed for testing or as utilities
    queries,
    client
  };
};
