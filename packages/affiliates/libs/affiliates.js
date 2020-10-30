const { EmpBalancesHistory } = require("./processors");
const { Prices } = require("./models");
const { DecodeLog } = require("./contracts");
const highland = require("highland");
const moment = require("moment");
const Promise = require("bluebird");
const assert = require("assert");

const { getWeb3 } = require("@uma/common");
const web3 = getWeb3();
const { toWei, toBN, fromWei } = web3.utils;

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

  // TODO: update this function to use underlying contracts GCR and total token debt.
  function calculateValue(tokens, closestPrice, decimals) {
    return tokens.mul(toBN(toWei(closestPrice.toString()))).div(toBN(toWei(decimals.toString())));
  }

  // pure function to separate out queries from calculations
  // this is adapted from scrips/example-contract-deployer-attributation.js
  function calculateRewards({
    empWhitelist = [],
    snapshotSteps = 1,
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

    const rewardsPerBlock = toBN(toWei(totalRewards)).div(toBN(blocks.length));
    const payoutPerSnapshot = rewardsPerBlock.mul(toBN(snapshotSteps));
    const valuePerSnapshot = blocks.reduce((result, block, index) => {
      if (index % snapshotSteps !== 0) return result;
      const { timestamp } = block;
      const valueByEmp = empWhitelist.reduce((result, empAddress, empIndex) => {
        try {
          const { tokens } = balanceHistories.get(empAddress).history.lookup(block.number);
          const decimals = tokenDecimals[empIndex];
          assert(decimals, "requires token decimals lookup");
          const [, closestPrice] = tokenPrices[empIndex].closest(timestamp);
          const totalTokens = Object.values(tokens).reduce((result, value) => {
            return result.add(toBN(value));
          }, toBN("0"));
          result.push([empAddress, calculateValue(totalTokens, closestPrice, decimals)]);
          return result;
        } catch (err) {
          // this error is ok, it means we have block history before the emp had any events. Locked value is 0 at this block.
          result.push([empAddress, 0]);
          return result;
        }
      }, []);
      result.push(valueByEmp);
      return result;
    }, []);

    // Per snapshot calculate the associated amount that each deployer is entitled to.
    let finalDeployerPayouts = valuePerSnapshot.reduce((result, valueByEmp) => {
      const totalValueLocked = valueByEmp.reduce((result, [, value]) => {
        return result.add(toBN(value));
      }, toBN("0"));
      valueByEmp.forEach(([emp, value]) => {
        const deployer = empDeployers.get(emp);
        const contribution =
          totalValueLocked.toString() != "0"
            ? toBN(value) // eslint-disable-line indent
                .mul(toBN(toWei("1"))) // eslint-disable-line indent
                .div(totalValueLocked) // eslint-disable-line indent
            : toBN("0"); // eslint-disable-line indent
        const rewards = contribution.mul(payoutPerSnapshot).div(toBN(toWei("1")));
        if (result[deployer] == null) result[deployer] = toBN("0");
        result[deployer] = result[deployer].add(rewards);
      });

      return result;
    }, {});

    // Finally convert the final bignumber output to strings for export.
    for (let contractDeployer of Object.keys(finalDeployerPayouts)) {
      finalDeployerPayouts[contractDeployer] = fromWei(finalDeployerPayouts[contractDeployer]);
    }

    return finalDeployerPayouts;
  }

  async function getRewards({
    startTime,
    endTime,
    tokensToPrice = [],
    empWhitelist = [],
    empCreatorAddress,
    snapshotSteps = 1,
    totalRewards,
    tokenDecimals = []
  }) {
    const tokenPrices = await Promise.map(
      tokensToPrice,
      async address => await getPriceHistory(address, "usd", startTime, endTime)
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
