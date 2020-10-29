const { EmpBalancesHistory } = require("./processors");
const { Prices } = require("./models");
const { DecodeLog } = require("./contracts");
const highland = require("highland");
const moment = require("moment");
const Promise = require("bluebird");
const assert = require("assert");
const { parseFixed } = require("@uma/common");

const DeployerRewards = ({ queries, empCreatorAbi, empAbi, coingecko }) => {
  assert(coingecko, "requires coingecko api");
  assert(queries, "requires queries class");
  assert(empCreatorAbi, "requires creator abi");
  assert(empAbi, "requires empAbi");
  async function getBalanceHistory(address, start, end) {
    // stream is a bit more optimal than waiting for entire query to return as array
    const stream = await queries.streamLogsByContract(address, start, end);
    const decode = DecodeLog(empAbi);
    const balancesHistory = EmpBalancesHistory();
    await highland(stream)
      .map(log => {
        return decode(log, {
          blockNumber: log.block_number,
          blockTimestamp: moment(log.block_timestamp.value).valueOf()
        });
      })
      .doto(log => balancesHistory.handleEvent(log.blockNumber, log))
      .last()
      .toPromise(Promise);

    return balancesHistory;
  }
  async function getAllBalanceHistories(addresses = [], start, end) {
    return Promise.reduce(
      addresses,
      async (result, address) => {
        result.push([address, await getBalanceHistory(address, start, end)]);
        return result;
      },
      []
    );
  }
  async function getPriceHistory(address, currency = "usd", start, end) {
    const result = await coingecko.chart(address, currency, start, end);
    return Prices(result.prices);
  }
  async function getBlocks(start, end) {
    const blocks = await queries.getBlocks(start, end, ["timestamp", "number"]);
    return blocks.map(block => {
      return {
        ...block,
        timestamp: moment(block.timestamp.value).valueOf()
      };
    });
  }

  // returns array of tuples [emp address, deployer address]
  async function getEmpDeployerHistory(address, start, end) {
    // this query is relatively small
    const logs = await queries.getLogsByContract(address, start, end);
    const decode = DecodeLog(empCreatorAbi);
    return logs.map(decode).reduce((result, log) => {
      result.push([log.args.expiringMultiPartyAddress, log.args.deployerAddress]);
      return result;
    }, []);
  }

  // update this function to calculate a price.
  // may want to instead get price based on collateral and collaterlization ratio
  // returns a BigInt
  function calculateValue(tokens, closestPrice, decimals = 18) {
    return BigInt(tokens) * BigInt(parseFixed(closestPrice.toFixed(decimals), decimals).toString());
  }

  // pure function to seperate out queries from calculations
  // this is adapted from scrips/example-contract-deployer-attributation.js
  function calculateRewards({
    empWhitelist = [],
    snapshotSteps = 64,
    totalRewards,
    tokenPrices,
    blocks,
    balanceHistories,
    empDeployers,
    tokenDecimals
  }) {
    assert(tokenPrices, "requires token prices");
    assert(blocks, "requires blocks");
    assert(balanceHistories, "requires balanceHistories");
    assert(empDeployers, "requires empDeployers");

    balanceHistories = new Map(balanceHistories);
    empDeployers = new Map(empDeployers);
    const rewardsPerBlock = BigInt(totalRewards) / BigInt(blocks.length);
    const payoutPerSnapshot = rewardsPerBlock * BigInt(snapshotSteps);

    const valuePerSnapshot = blocks.reduce((result, block, index) => {
      if (index % snapshotSteps !== 0) return result;
      const { timestamp } = block;

      const valueByEmp = empWhitelist.reduce((result, empAddress, empIndex) => {
        try {
          const { tokens } = balanceHistories.get(empAddress).history.lookup(block.number);
          const decimals = tokenDecimals[empIndex];
          assert(decimals, "requires token decimals lookup");
          const [, closestPrice] = tokenPrices[empIndex].closest(timestamp);
          const totalTokens = Object.values(tokens).reduce((a, b) => a + BigInt(b), 0n);
          // console.log({closestPrice,totalTokens},BigInt(parseFixed(closestPrice.toFixed(18),18)))
          // need to conver total tokens to consistent decimals across all tokens
          result.push([empAddress, calculateValue(totalTokens, closestPrice, decimals)]);
          return result;
        } catch (err) {
          // this error is ok, it means we have block history before the emp had
          // any events. this essentially means value locked at emp is 0 at this block.
          result.push([empAddress, 0]);
          return result;
        }
      }, []);

      result.push(valueByEmp);
      return result;
    }, []);

    // per snapshot
    return valuePerSnapshot.reduce((result, valueByEmp) => {
      const totalValueLocked = valueByEmp.reduce((result, [, value]) => {
        return result + BigInt(value);
      }, 0n);
      valueByEmp.forEach(([emp, value]) => {
        // console.log({value,totalValueLocked})
        const deployer = empDeployers.get(emp);
        // this math needs work
        const contribution = totalValueLocked > 0n ? (BigInt(value) * (2n * 10n ** 18n)) / totalValueLocked : 0n;
        const rewards = contribution * payoutPerSnapshot;
        if (result[deployer] == null) result[deployer] = 0n;
        result[deployer] = result[deployer] + rewards;
      });
      return result;
    }, {});
  }

  async function getRewards({
    startTime,
    endTime,
    tokensToPrice = [],
    empWhitelist = [],
    empCreatorAddress,
    snapshotSteps = 64,
    totalRewards,
    tokenDecimals = []
  }) {
    const tokenPrices = await Promise.map(
      tokensToPrice,
      async address => await getPriceHistory(address, startTime, endTime)
    );
    const blocks = await getBlocks(startTime, endTime);
    const balanceHistories = await getAllBalanceHistories(empWhitelist, startTime, endTime);
    const empDeployers = await getEmpDeployerHistory(empCreatorAddress, startTime, endTime);

    return calculateRewards({
      startTime,
      endTime,
      tokensToPrice,
      empWhitelist,
      empCreatorAddress,
      snapshotSteps,
      totalRewards,
      tokenDecimals,
      tokenPrices,
      blocks,
      balanceHistories,
      empDeployers
    });
  }

  return {
    getRewards,
    utils: {
      getBalanceHistory,
      getAllBalanceHistories,
      getPriceHistory,
      getBlocks,
      getEmpDeployerHistory,
      calculateRewards,
      calculateValue
    }
  };
};

module.exports = {
  // Calculate rewards for deployers
  DeployerRewards
  // We may have future reward types, such as tagged rewards
};
