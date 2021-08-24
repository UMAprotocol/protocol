// This is a helper method to create a GASETH BQ query with time arguments.
function createQuery(earlierTimeBound, laterTimeBound) {
  const query = `
  DECLARE halfway int64;
  DECLARE block_count int64;
  DECLARE max_block int64;

  -- Querying for the amount of blocks in the preset time range. This will allow block_count to be compared against a given minimum block amount.
  SET (block_count, max_block) = (SELECT AS STRUCT (MAX(number) - MIN(number)), MAX(number) FROM \`bigquery-public-data.crypto_ethereum.blocks\` 
  WHERE timestamp BETWEEN TIMESTAMP('${earlierTimeBound}', 'UTC') AND TIMESTAMP('${laterTimeBound}', 'UTC'));

  CREATE TEMP TABLE cum_gas (
    gas_price int64,
    cum_sum int64
  );

  -- If the minimum threshold of blocks is met, query on a time range
  IF block_count >= 134400 THEN
  INSERT INTO cum_gas (
    SELECT
    receipt_effective_gas_price,
      SUM(gas_used) OVER (ORDER BY receipt_effective_gas_price) AS cum_sum
    FROM (
      SELECT
      receipt_effective_gas_price,
        SUM(receipt_gas_used) AS gas_used
      FROM
        \`bigquery-public-data.crypto_ethereum.transactions\`
      WHERE block_timestamp 
      BETWEEN TIMESTAMP('${earlierTimeBound}', 'UTC')
      AND TIMESTAMP('${laterTimeBound}', 'UTC')  
      GROUP BY
      receipt_effective_gas_price));
  ELSE -- If a minimum threshold of blocks is not met, query for the minimum amount of blocks
  INSERT INTO cum_gas (
    SELECT
    receipt_effective_gas_price,
      SUM(gas_used) OVER (ORDER BY receipt_effective_gas_price) AS cum_sum
    FROM (
      SELECT
      receipt_effective_gas_price,
        SUM(receipt_gas_used) AS gas_used
      FROM
        \`bigquery-public-data.crypto_ethereum.transactions\`
      WHERE block_number 
      BETWEEN (max_block - 134400)
      AND max_block
      GROUP BY
      receipt_effective_gas_price));
  END IF;

  SET halfway = (SELECT DIV(MAX(cum_sum),2) FROM cum_gas);

  SELECT cum_sum, gas_price FROM cum_gas WHERE cum_sum > halfway ORDER BY gas_price LIMIT 1;
  `;

  return query;
}

module.exports = { createQuery };
