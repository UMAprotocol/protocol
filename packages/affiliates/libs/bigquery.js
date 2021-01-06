const assert = require("assert");
const lodash = require("lodash");

// Big query class meant for interacting with the ethereum table.
module.exports = ({ client } = {}) => {
  assert(client, "requires bigquery client");

  // types of queries we are interested in
  const queries = {
    // this is an expensive call (50gb at time of writing), but is necessary to get all logs without knowing
    // the deployment time of a contract.
    allLogsByContract(contract, selection = ["*"]) {
      assert(contract, "requires contract");
      selection = lodash.castArray(selection);
      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.logs
        WHERE
          LOWER(address)=LOWER('${contract}')
        ORDER BY block_timestamp ASC;
      `;
    },
    // logs aka events by contract and time
    logsByContract(contract, start, end = Date.now(), selection = ["*"]) {
      assert(contract, "requires contract");
      assert(start >= 0, "requires start");
      // require an array of values
      selection = lodash.castArray(selection);
      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.logs
        WHERE
          block_timestamp >= TIMESTAMP_MILLIS(${start})
          AND block_timestamp < TIMESTAMP_MILLIS(${end})
          AND LOWER(address)=LOWER('${contract}')
        ORDER BY block_timestamp ASC;
      `;
    },
    tracesByContract(contract, start, end = Date.now(), selection = ["*"]) {
      assert(contract, "requires contract");
      assert(start >= 0, "requires start");
      selection = lodash.castArray(selection);

      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.traces
        WHERE
          block_timestamp >= TIMESTAMP_MILLIS(${start})
          AND block_timestamp < TIMESTAMP_MILLIS(${end})
          AND LOWER(to_address)=LOWER('${contract}')
        ORDER BY block_timestamp ASC;
      `;
    },
    // transactions by contract
    transactionsByContract(contract, start, end = Date.now(), selection = ["*"]) {
      assert(contract, "requires contract");
      assert(start >= 0, "requires start");
      selection = lodash.castArray(selection);

      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.transactions
        WHERE
          block_timestamp >= TIMESTAMP_MILLIS(${start})
          AND block_timestamp < TIMESTAMP_MILLIS(${end})
          AND LOWER(to_address)=LOWER('${contract}')
        ORDER BY block_timestamp ASC;
      `;
    },
    // search transactions for many contracts
    transactionsByContracts(contracts = [], start, end = Date.now(), selection = ["*"]) {
      contracts = lodash.castArray(contracts).map(x => x.toLowerCase());
      assert(contracts, "requires contracts");
      assert(contracts.length, "requires at least one contract");
      assert(start >= 0, "requires start");
      selection = lodash.castArray(selection);

      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.transactions
        WHERE
          block_timestamp >= TIMESTAMP_MILLIS(${start})
          AND block_timestamp < TIMESTAMP_MILLIS(${end})
          AND LOWER(to_address) IN ('${contracts.join("', '")}')
        ORDER BY block_timestamp ASC;
      `;
    },
    blocks(start, end, selection = ["*"]) {
      assert(start >= 0, "requires start");
      selection = lodash.castArray(selection);
      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.blocks
        WHERE
          timestamp >= TIMESTAMP_MILLIS(${start})
          AND timestamp < TIMESTAMP_MILLIS(${end})
        ORDER BY timestamp ASC;
      `;
    },
    getBlocksAscending(start, limit = 1, selection = ["*"]) {
      assert(start >= 0, "requires start");
      selection = lodash.castArray(selection);
      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.blocks
        WHERE
          timestamp >= TIMESTAMP_MILLIS(${start})
        ORDER BY timestamp ASC
        LIMIT ${limit};
      `;
    },
    getBlocksDescending(start, limit = 1, selection = ["*"]) {
      assert(start >= 0, "requires start");
      selection = lodash.castArray(selection);
      return `
        SELECT ${selection.join(", ")}
        FROM
          bigquery-public-data.crypto_ethereum.blocks
        WHERE
          timestamp <= TIMESTAMP_MILLIS(${start})
        ORDER BY timestamp DESC
        LIMIT ${limit};
      `;
    }
  };

  function streamAllLogsByContract(...args) {
    const query = queries.allLogsByContract(...args);
    return client.createQueryStream({ query });
  }
  function streamLogsByContract(...args) {
    const query = queries.logsByContract(...args);
    return client.createQueryStream({ query });
  }
  function streamTracesByContract(...args) {
    const query = queries.tracesByContract(...args);
    return client.createQueryStream({ query });
  }
  function streamTransactionsByContracts(...args) {
    const query = queries.transactionsByContracts(...args);
    return client.createQueryStream({ query });
  }
  function streamTransactionsByContract(...args) {
    const query = queries.transactionsByContract(...args);
    return client.createQueryStream({ query });
  }
  function streamBlocks(...args) {
    const query = queries.blocks(...args);
    return client.createQueryStream({ query });
  }
  async function getAllLogsByContract(...args) {
    const query = queries.allLogsByContract(...args);
    const [job] = await client.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    return rows;
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
  async function getBlocks(...args) {
    const query = queries.blocks(...args);
    const [job] = await client.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    return rows;
  }
  function getBlockStream(...args) {
    const query = queries.blocks(...args);
    return client.createQueryStream({ query });
  }
  async function getBlocksAscending(...args) {
    const query = queries.getBlocksAscending(...args);
    const [job] = await client.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    return rows;
  }
  async function getBlocksDescending(...args) {
    const query = queries.getBlocksDescending(...args);
    const [job] = await client.createQueryJob({ query });
    const [rows] = await job.getQueryResults();
    return rows;
  }
  return {
    // main api, use streams or "get" to return data as array
    streamLogsByContract,
    streamAllLogsByContract,
    streamTransactionsByContract,
    streamTransactionsByContracts,
    streamBlocks,
    getLogsByContract,
    getAllLogsByContract,
    getTransactionsByContract,
    getBlocks,
    getBlockStream,
    getBlocksAscending,
    getBlocksDescending,
    streamTracesByContract,
    // exposed for testing or as utilities
    utils: {
      queries,
      client
    }
  };
};
