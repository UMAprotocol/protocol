const Path = require("path");
const assert = require("assert");
const highland = require("highland");

const { DappMining } = require("../../libs/affiliates");
const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { mocks } = require("../../libs/datasets");
const { SharedAttributions, Balances } = require("../../libs/models");
const { EmpAttributions } = require("../../libs/processors");
const { Queries } = mocks;
const { encodeAttribution, EncodeCallData } = require("../../libs/contracts");

const web3 = getWeb3();
const { fromWei, toWei } = web3.utils;
const empAbi = getAbi("ExpiringMultiParty");
const datasetPath = Path.join(__dirname, "../datasets/dapp-mining-set1");
const config = require("../datasets/dapp-mining-set1/config.json");

const encodeCallData = EncodeCallData(empAbi);
async function makeTx(blockNumber, collateral, tokens, user, tag) {
  return {
    blockNumber,
    name: "create",
    from_address: user,
    args: [collateral, tokens],
    input: encodeAttribution(encodeCallData("create", [collateral.toString()], [tokens.toString()]), tag)
  };
}

describe("DappMining", function() {
  let dappmining, utils;
  before(function() {
    const queries = Queries(datasetPath);
    dappmining = DappMining({ queries, empAbi, web3 });
    utils = dappmining.utils;
  });
  describe("Dappmining Unit Tests", function() {
    it("calculates percent", function() {
      let result = utils.calculatePercent(100, toWei(".01"));
      assert.equal(result, "1");
      result = utils.calculatePercent(100, toWei("1"));
      assert.equal(result, "100");
    });
    it("sums attributions", function() {
      const attributions = SharedAttributions();
      let sum;
      sum = utils.sumAttributions(attributions);
      assert(sum);
      attributions.attribute("a", "a", "1");
      attributions.attribute("a", "b", "2");
      attributions.attribute("b", "b", "3");
      sum = utils.sumAttributions(attributions, 10, sum);
      assert.equal(sum.getAttribution("a", "a"), "10");
      assert.equal(sum.getAttribution("a", "b"), "20");
      assert.equal(sum.getAttribution("b", "b"), "30");
    });
    it("sums balances", function() {
      const balances = Balances();
      let sum;
      sum = utils.sumBalances(balances);
      assert(sum);
      balances.add("a", "1");
      balances.add("b", "2");
      balances.add("c", "3");
      sum = utils.sumBalances(balances, 10, sum);
      assert.equal(sum.get("a"), "10");
      assert.equal(sum.get("b"), "20");
      assert.equal(sum.get("c"), "30");
    });
    it("calculates block reward", function() {
      const balances = Balances();
      let attributions = SharedAttributions();
      const whitelist = ["Dev1", "Dev2"];
      balances.add("a", "10");
      balances.add("b", "20");
      balances.add("c", "30");
      balances.add("d", "40");
      attributions.attribute("a", "Dev1", "5");
      attributions.attribute("a", "Dev2", "5");
      attributions.attribute("b", "Dev1", "10");
      attributions.attribute("b", "Dev2", "10");
      attributions.attribute("c", "Dev1", "15");
      attributions.attribute("c", "Dev2", "15");
      attributions.attribute("d", "Dev1", "20");
      attributions.attribute("d", "Dev2", "20");
      let result = utils.calculateBlockReward({ attributions, balances, whitelist });
      assert.equal(fromWei(result["Dev1"]), "0.5");
      assert.equal(fromWei(result["Dev2"]), "0.5");
      attributions = SharedAttributions();
      attributions.attribute("a", "Dev1", "1");
      attributions.attribute("a", "Dev2", "9");
      attributions.attribute("b", "Dev1", "1");
      attributions.attribute("b", "Dev2", "19");
      attributions.attribute("c", "Dev1", "1");
      attributions.attribute("c", "Dev2", "29");
      attributions.attribute("d", "Dev1", "1");
      attributions.attribute("d", "Dev2", "39");
      result = utils.calculateBlockReward({ attributions, balances, whitelist });
      assert.equal(fromWei(result["Dev1"]), "0.039999999999999999"); // 4%
      assert.equal(fromWei(result["Dev2"]), "0.959999999999999999"); // 96%
    });
    it("procesess simple attribution stream", async function() {
      const user = "usera";
      const dev = "0xaBBee9fC7a882499162323EEB7BF6614193312e3";
      const transactions = [await makeTx(0, 100, 100, user, dev)];
      const defaultAddress = "default";
      const stream = highland(transactions);
      const result = await stream
        .through(
          utils.ProcessAttributionStream({
            startBlock: 0,
            endBlock: 2,
            attributions: EmpAttributions(empAbi, defaultAddress)
          })
        )
        .toPromise(Promise);
      assert.equal(result.getAttribution(user, dev), "200");
    });
    it("procesess complex attribution stream", async function() {
      const transactions = [
        await makeTx(0, 0, 100, "usera", "0x00000000000000000000000000000000000000A1"),
        await makeTx(0, 0, 100, "usera", "0x00000000000000000000000000000000000000A3"),

        await makeTx(1, 0, 100, "userb", "0x00000000000000000000000000000000000000A2"),
        await makeTx(1, 0, 100, "userb", "0x00000000000000000000000000000000000000A1"),

        await makeTx(2, 0, 75, "userc", "0x00000000000000000000000000000000000000A3"),
        await makeTx(2, 0, 75, "userc", "0x00000000000000000000000000000000000000A2")
      ];
      const defaultAddress = "default";
      const stream = highland(transactions);
      const result = await stream
        .through(
          utils.ProcessAttributionStream({
            startBlock: 0,
            endBlock: 3,
            attributions: EmpAttributions(empAbi, defaultAddress)
          })
        )
        .toPromise(Promise);
      assert.equal(result.getAttribution("usera", "0x00000000000000000000000000000000000000A1"), "300");
      assert.equal(result.getAttribution("userb", "0x00000000000000000000000000000000000000A1"), "200");

      assert.equal(result.getAttribution("userb", "0x00000000000000000000000000000000000000A2"), "200");
      assert.equal(result.getAttribution("userc", "0x00000000000000000000000000000000000000A2"), "75");

      assert.equal(result.getAttribution("usera", "0x00000000000000000000000000000000000000A3"), "300");
      assert.equal(result.getAttribution("userc", "0x00000000000000000000000000000000000000A3"), "75");
    });
    it("procesess simple event stream", async function() {
      const events = [
        {
          name: "PositionCreated",
          args: ["usera", 100, 100],
          blockNumber: 0
        }
      ];
      const result = await highland(events)
        .through(
          utils.ProcessEventStream({
            startBlock: 0,
            endBlock: 1
          })
        )
        .toPromise(Promise);
      assert.equal(result.get("usera"), "100");
    });
    it("procesess complex event stream", async function() {
      const events = [
        {
          name: "PositionCreated",
          args: ["usera", 100, 100],
          blockNumber: 0
        },
        {
          name: "PositionCreated",
          args: ["userb", 100, 100],
          blockNumber: 1
        },
        {
          name: "PositionCreated",
          args: ["userc", 100, 100],
          blockNumber: 2
        }
      ];
      const result = await highland(events)
        .through(
          utils.ProcessEventStream({
            startBlock: 0,
            endBlock: 3
          })
        )
        .toPromise(Promise);
      assert.equal(result.get("usera"), "300");
      assert.equal(result.get("userb"), "200");
      assert.equal(result.get("userc"), "100");
    });
    it("gets rewards with simple examples", async function() {
      const balances = Balances();
      let attributions = SharedAttributions();
      const whitelist = ["Dev1", "Dev2"];
      const totalRewards = "100";
      balances.add("a", "10");
      balances.add("b", "20");
      balances.add("c", "30");
      balances.add("d", "40");
      attributions.attribute("a", "Dev1", "5");
      attributions.attribute("a", "Dev2", "5");
      attributions.attribute("b", "Dev1", "10");
      attributions.attribute("b", "Dev2", "10");
      attributions.attribute("c", "Dev1", "15");
      attributions.attribute("c", "Dev2", "15");
      attributions.attribute("d", "Dev1", "20");
      attributions.attribute("d", "Dev2", "20");
      let result = await utils.processRewardData({ attributions, balances, whitelist, totalRewards });
      assert.equal(result["Dev1"], "50");
      assert.equal(result["Dev2"], "50");
    });
  });
  describe("dataset1", function() {
    it("should run with dataset", async function() {
      this.timeout(600000);
      const result = await dappmining.getRewards(config);
      assert(result.startBlock);
      assert(result.endBlock);
      assert(Object.values(result.rewards).length, 2);
    });
  });
});
