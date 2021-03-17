const assert = require("assert");
const highland = require("highland");
const moment = require("moment");

const { DecodeTransaction, DecodeLog } = require("../contracts");
const { EmpAttributions, EmpBalances } = require("../processors");
const { AttributionLookback, Balances } = require("../models");

// Module will calculate the Dapp Mining rewards for a single EMP
module.exports = ({ queries, empAbi, web3 }) => {
  assert(queries, "requires queries bigquery interface");
  assert(empAbi, "requires empAbi");
  assert(web3, "requires web3");

  const { toBN, fromWei } = web3.utils;

  function getEventStream(empAddress, start, end) {
    const stream = queries.streamLogsByContract(empAddress, start, end);
    const decode = DecodeLog(empAbi);
    return highland(stream).map(log => {
      return decode(log, {
        blockNumber: log.block_number,
        blockTimestamp: moment(log.block_timestamp.value).valueOf(),
        ...log
      });
    });
  }

  function getAttributionStream(empAddress, start, end) {
    // We get all attributions from the trace stream. This is very similar to transactions query but
    // transactions do not contain transactions called from other contracts! Trace does.
    const stream = queries.streamTracesByContract(empAddress, start, end);
    const decodeTx = DecodeTransaction(empAbi);

    return (
      highland(stream)
        // trace transactions may contain the contract creation event, we cant decode this so filter out
        // fyi non contract creation "trace_type" are called "call"
        .filter(tx => tx.trace_type !== "create" && tx.error == null)
        .map(tx => {
          return decodeTx(tx, {
            blockNumber: tx.block_number,
            blockTimestamp: moment(tx.block_timestamp.value).valueOf(),
            ...tx
          });
        })
        // this filters only emp contract "create" calls. We could technically look at more, but these
        // would be the only "attributed" calls as per the spec
        .filter(tx => tx.name == "create")
    );
  }

  // returns the proportion of rewards given to each developer for a specific point in time
  function calculateBlockReward(
    { attributions, balances, whitelist },
    // return all tags with a percent value for rewards
    rewards = {}
  ) {
    // for every user with a token balance
    balances.keys().forEach(userid => {
      // get users balance
      const balance = balances.get(userid);
      const attributionPercents = attributions.getAttributionPercents(userid, balance);
      // go through all whitelisted tags
      whitelist.forEach(tag => {
        if (rewards[tag] == null) rewards[tag] = toBN("0");
        // get that tags attribution percent for that user relative to all other affiliates
        const attributionPercent = attributionPercents[tag] || "0";
        // multiply the balance and the attribution percent to get final attribution weight
        // and add it to the rest of the weights. This will need to be divided by total balances eventually.
        rewards[tag] = rewards[tag].add(toBN(balance).mul(toBN(attributionPercent)));
      });
    });
    // normalize balances based on total in all balances. This is done last instead of in the above to
    // reduce precision loss which seems to happen the more divisions there are.
    const total = toBN(balances.getTotal());
    return Object.entries(rewards).reduce((result, [key, value]) => {
      result[key] = value.div(total).toString();
      return result;
    }, {});
  }

  // integer percent calculation where percent is passed in as wei
  function calculatePercent(amount, percent) {
    return fromWei(toBN(amount.toString()).mul(toBN(percent.toString())));
  }

  // calculates attribution weights for multiple blocks by simply taking last snapshot state and multiplying by
  // the number of blocks elapsed.
  function sumAttributions(attributions, blocksElapsed = 1, sum = AttributionLookback()) {
    blocksElapsed = toBN(blocksElapsed);
    attributions.forEach((userid, affiliate, amount, index) => {
      let currentSum;
      try {
        currentSum = sum.getByIndex(userid, index).amount;
      } catch (err) {
        currentSum = "0";
      }
      const weighted = toBN(amount)
        .mul(blocksElapsed)
        .add(toBN(currentSum));
      sum.setByIndex(userid, index, { affiliate, amount: weighted.toString() });
    });
    return sum;
  }
  // calculates balance weights for multiple blocks by taking last balance snapshot and multplying it by
  // the number of blocks elapsed until next change.
  function sumBalances(balances, blocksElapsed = 1, sum = Balances()) {
    blocksElapsed = toBN(blocksElapsed);
    balances.forEach((value, userid) => {
      const weighted = toBN(value).mul(blocksElapsed);
      sum.add(userid, weighted.toString());
    });
    return sum;
  }

  // Returns the closest block to equal to or above the start time
  async function getStartBlock(start) {
    const blocks = await queries.getBlocksAscending(start, 1, ["timestamp", "number"]);
    const [result] = blocks.map(block => {
      return {
        ...block,
        timestamp: moment(block.timestamp.value).valueOf()
      };
    });
    return result;
  }
  // Returns closest block equal to or before end time
  async function getEndBlock(end) {
    const blocks = await queries.getBlocksDescending(end, 1, ["timestamp", "number"]);
    const [result] = blocks.map(block => {
      return {
        ...block,
        timestamp: moment(block.timestamp.value).valueOf()
      };
    });
    return result;
  }

  // Broken out logic for consuming and processing attribution stream. This can now be tested
  // independently. It essentially takes a stream of attribution transactions, reduces it to a single
  // attribution sum, which weights all attributions across the block range specified. The final output
  // is used to weight the final reward calculation.
  function ProcessAttributionStream({ attributions, attributionsSum = AttributionLookback(), startBlock, endBlock }) {
    assert(attributionsSum, "requires attributions sum");
    assert(attributions, "requires attributions");
    assert(startBlock >= 0, "requires startBlock >= 0");
    assert(endBlock >= 0 && endBlock > startBlock, "requires endBlock >=0 and > startBlock");
    return stream => {
      return (
        stream
          // sums attributions every time there is a new attribution event.
          .reduce({ attributionsSum, lastBlock: startBlock }, ({ attributionsSum, lastBlock }, tx) => {
            if (tx.blockNumber > lastBlock) {
              // maintains the sum of all attribution states weighted by the blocks elapsed
              attributionsSum = sumAttributions(attributions.attributions, tx.blockNumber - lastBlock, attributionsSum);
              lastBlock = tx.blockNumber;
            }
            // maintains the current state of attributions for all developers and users
            attributions.handleTransaction(tx);
            return { attributionsSum, lastBlock };
          })
          .map(({ attributionsSum, lastBlock }) => {
            // calculates and finalizes weights to go up to the last block in the specified time
            return sumAttributions(attributions.attributions, endBlock - lastBlock, attributionsSum);
          })
      );
    };
  }
  // Broke out business logic for processing the event (log) stream. This both calculates instantaneous balance
  // for all users at every event, but also calculates a summation of the balances for all blocks within the
  // block range. The final result is used to weight the rewards.
  function ProcessEventStream({ startBlock, endBlock, balancesSum = Balances(), balances = EmpBalances() }) {
    assert(startBlock >= 0, "requires startBlock >= 0");
    assert(endBlock >= 0 && endBlock > startBlock, "requires endBlock >=0 and > startBlock");
    return stream => {
      return (
        stream
          .reduce({ lastBlock: startBlock, balancesSum }, ({ lastBlock, balancesSum }, event) => {
            if (event.blockNumber > lastBlock) {
              // maintains the weighed sum of all balances for every block
              balancesSum = sumBalances(balances.tokens, event.blockNumber - lastBlock, balancesSum);
              lastBlock = event.blockNumber;
            }
            // maintains the latest state of all balances for all users
            balances.handleEvent(event);
            return { lastBlock, balancesSum };
          })
          // finalizes the balances sum by weighting any unprocessed blocks to the end of the timeframe
          .map(({ lastBlock, balancesSum }) => {
            return sumBalances(balances.tokens, endBlock - lastBlock, balancesSum);
          })
      );
    };
  }

  // Helper function to process rewards. Use this for testing business logic with custom data.
  async function processRewardData({ attributions, balances, whitelist, totalRewards }) {
    assert(totalRewards, "requires total rewards");
    const percentages = calculateBlockReward({
      attributions,
      balances,
      whitelist
    });

    return Object.entries(percentages).reduce((result, [key, value]) => {
      if (value == 0) return result;
      result[key] = calculatePercent(totalRewards, value);
      return result;
    }, {});
  }

  // Main entrypoint to kick off reward calculations. Returns an object with rewards keyed by address and value.
  async function getRewards({ empAddress, defaultAddress, startTime, endTime, whitelist, totalRewards, firstEmpDate }) {
    assert(empAddress, "requires emp address for reward calculation");
    assert(defaultAddress, "requires defaultAddress for untagged rewards");
    assert(startTime >= 0, "requires startTime >= 0");
    assert(endTime > 0 && endTime > startTime, "requires endTime >= 0 && > startTime");
    assert(whitelist && whitelist.length, "requires an array of whitelisted payout addresses");
    assert(totalRewards > 0, "requires totalRewards above 0 to be shared across dapps");

    // use firstEmpDate as a history cutoff when querying for events. We can safely say no emps were deployed before Jan of 2020.
    firstEmpDate = firstEmpDate || moment("2020-01-01", "YYYY-MM-DD").valueOf();

    // Pull external data
    const attributionStream = getAttributionStream(empAddress, firstEmpDate, endTime);
    const eventStream = getEventStream(empAddress, firstEmpDate, endTime);
    const startBlock = await getStartBlock(startTime);
    const endBlock = await getEndBlock(endTime);

    // Wire up streaming logic
    const attributionPromise = attributionStream
      .through(
        ProcessAttributionStream({
          startBlock: startBlock.number,
          endBlock: endBlock.number,
          attributions: EmpAttributions(empAbi, defaultAddress, AttributionLookback())
        })
      )
      .toPromise(Promise);

    const eventPromise = eventStream
      .through(ProcessEventStream({ startBlock: startBlock.number, endBlock: endBlock.number }))
      .toPromise(Promise);

    const [attributions, balances] = await Promise.all([attributionPromise, eventPromise]);

    // split out some business logic from data aquisition so we can test this function seperately with test data
    const rewards = await processRewardData({
      attributions,
      balances,
      // add default address to whitelist if not already added
      whitelist: [...new Set([...whitelist, defaultAddress]).values()],
      totalRewards
    });

    return {
      startBlock,
      endBlock,
      rewards
    };
  }

  return {
    getRewards,
    utils: {
      getStartBlock,
      getEndBlock,
      calculatePercent,
      calculateBlockReward,
      ProcessAttributionStream,
      ProcessEventStream,
      sumAttributions,
      sumBalances,
      processRewardData
    }
  };
};
