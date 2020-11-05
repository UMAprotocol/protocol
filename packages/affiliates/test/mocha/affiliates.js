const { DeployerRewards } = require("../../libs/affiliates");
const moment = require("moment");
const { assert } = require("chai");
const empAbi = require("../../../core/build/contracts/ExpiringMultiParty");
const empCreatorAbi = require("../../../core/build/contracts/ExpiringMultiPartyCreator");
const highland = require("highland");
const datasetName = "set1";
const params = require(`../datasets/${datasetName}`);
const {
  empCreator,
  empContracts,
  collateralTokens,
  collateralTokenDecimals,
  syntheticTokenDecimals,
  startingTimestamp,
  endingTimestamp
} = params;
const devRewardsToDistribute = "50000";
// mocks
function Queries() {
  return {
    streamLogsByContract(address) {
      return highland(require(`../datasets/${datasetName}/logs/${address}`));
    },
    getLogsByContract(address) {
      return require(`../datasets/${datasetName}/logs/${address}`);
    },
    streamBlocks() {
      return highland(require(`../datasets/${datasetName}/blocks`));
    },
    getBlocks(start, end) {
      return require(`../datasets/${datasetName}/blocks`).filter(block => {
        const blockTime = moment(block.timestamp.value).valueOf();
        return blockTime >= start && blockTime <= end;
      });
    }
  };
}
function Coingecko() {
  return {
    getHistoricContractPrices(address) {
      return require(`../datasets/${datasetName}/coingecko/${address}`);
    }
  };
}

function HistoricSynthPrices() {
  return {
    getHistoricSynthPrices(address) {
      return require(`../datasets/${datasetName}/synth-prices/${address}`);
    }
  };
}

describe("DeployerRewards", function() {
  let affiliates;
  before(function() {
    const queries = Queries();
    const coingecko = Coingecko();
    const historicSynthPrices = HistoricSynthPrices();
    affiliates = DeployerRewards({
      queries,
      empAbi: empAbi.abi,
      empCreatorAbi: empCreatorAbi.abi,
      coingecko,
      historicSynthPrices
    });
  });
  it("getBalanceHistory", async function() {
    this.timeout(10000);
    const result = await affiliates.utils.getBalanceHistory(empContracts[0], startingTimestamp, endingTimestamp);
    assert.ok(result);
    assert.ok(result.history.length());
  });
  it("getAllBalanceHistory", async function() {
    this.timeout(10000);
    const result = await affiliates.utils.getAllBalanceHistories(empContracts, startingTimestamp, endingTimestamp);
    assert.equal(result.length, empContracts.length);
    result.forEach(([address, history]) => {
      assert.ok(address);
      assert.ok(history);
      assert.ok(history.history.length());
    });
  });
  it("getCollateralPriceHistory", async function() {
    this.timeout(10000);
    const [, address] = collateralTokens;
    const result = await affiliates.utils.getCollateralPriceHistory(address, "usd", startingTimestamp, endingTimestamp);
    assert.ok(result.prices.length);
  });
  it("getSyntheticPriceHistory", async function() {
    this.timeout(10000);
    const [, address] = empContracts;
    const result = await affiliates.utils.getSyntheticPriceHistory(address, startingTimestamp, endingTimestamp);
    assert.ok(result.prices.length);
  });
  it("getBlocks", async function() {
    this.timeout(30000);
    const result = await affiliates.utils.getBlocks(startingTimestamp, startingTimestamp + 60 * 1000 * 5);
    assert.ok(result.length);
    const [first] = result;
    assert(first.timestamp > 0);
    assert(first.number > 0);
  });
  it("getEmpDeployerHistory", async function() {
    this.timeout(10000);
    const result = await affiliates.utils.getEmpDeployerHistory(empCreator, startingTimestamp);
    assert(result.length);
  });
  it("calculateRewards", async function() {
    this.timeout(100000);

    const startingTimestamp = moment("2020-10-01 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf(); // utc timestamp
    const endingTimestamp = moment("2020-10-08 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf();

    const result = await affiliates.getRewards({
      totalRewards: devRewardsToDistribute,
      startTime: startingTimestamp,
      endTime: endingTimestamp,
      empWhitelist: empContracts,
      empCreatorAddress: empCreator,
      collateralTokens: collateralTokens,
      collateralTokenDecimals: collateralTokenDecimals,
      syntheticTokenDecimals: syntheticTokenDecimals
    });

    assert.equal(Object.keys(result).length, 2); // There should be 2 deplorers for the 3 EMPs.
    assert.equal(
      Object.values(result).reduce((total, value) => {
        return Number(total) + Number(value);
      }, 0),
      Number(devRewardsToDistribute)
    ); // the total rewards distributed should equal the number specified
  });
});
