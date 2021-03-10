const Path = require("path");
const assert = require("assert");
const highland = require("highland");

const { DappMining } = require("../../libs/affiliates");
const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { mocks } = require("../../libs/datasets");
const { SharedAttributions, Balances, AttributionLookback } = require("../../libs/models");
const { EmpAttributions } = require("../../libs/processors");
const { Queries } = mocks;
const { encodeAttribution, EncodeCallData } = require("../../libs/contracts");

const web3 = getWeb3();
const { fromWei, toWei } = web3.utils;
const empAbi = getAbi("ExpiringMultiParty", "1.2.0");
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

describe("DappMining V1", function() {
  let dappmining, utils;
  before(function() {
    const queries = Queries(datasetPath);
    dappmining = DappMining["v1"]({ queries, empAbi, web3 });
    utils = dappmining.utils;
  });
  describe("Dappmining V1 Unit Tests", function() {
    it("calculates percent", function() {
      let result = utils.calculatePercent(100, toWei(".01"));
      assert.equal(result, "1");
      result = utils.calculatePercent(100, toWei("1"));
      assert.equal(result, "100");
    });
    it("sums attributions", function() {
      const attributions = SharedAttributions();
      let sum = utils.sumAttributions(attributions);
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
      let sum = utils.sumBalances(balances);
      assert(sum);
      balances.add("a", "1");
      balances.add("b", "2");
      balances.add("c", "3");
      sum = utils.sumBalances(balances, 10, sum);
      assert.equal(sum.get("a"), "10");
      assert.equal(sum.get("b"), "20");
      assert.equal(sum.get("c"), "30");
    });
    // This tests 2 scenarios with the calculateBlockRewardFunction
    it("calculates block reward", function() {
      const balances = Balances();
      let attributions = SharedAttributions();
      // Creating a whitelist with 2 tagged addresses
      const whitelist = ["Dev1", "Dev2"];
      // This generates the current balance for each user, a, b, c and d
      balances.add("a", "10");
      balances.add("b", "20");
      balances.add("c", "30");
      balances.add("d", "40");
      // This attributions the balances contribution to each developer. For example
      // user a's balance was "referred" by Dev1 and Dev2 in equal proportion.
      // All settings below split a users balance contribution equally between the 2 developers.
      attributions.attribute("a", "Dev1", "5");
      attributions.attribute("a", "Dev2", "5");
      attributions.attribute("b", "Dev1", "10");
      attributions.attribute("b", "Dev2", "10");
      attributions.attribute("c", "Dev1", "15");
      attributions.attribute("c", "Dev2", "15");
      attributions.attribute("d", "Dev1", "20");
      attributions.attribute("d", "Dev2", "20");
      // Calculate block reward takes the current snapshot of attributions and balances and produces
      // a percentage attribution for each whitelisted developer.
      let result = utils.calculateBlockReward({ attributions, balances, whitelist });
      // Becuase balances were equally contributed to, we should expect 50% attribution.
      assert.equal(fromWei(result["Dev1"]), "0.5");
      assert.equal(fromWei(result["Dev2"]), "0.5");
      // Instanciating a new attribution scheme
      attributions = SharedAttributions();
      // This time we weight dev 1 to have a lower attribution than dev2 to each users balance.
      // For a's balance, Dev 1 attributed 1/10 and dev2 attributed 9/10, etc.
      attributions.attribute("a", "Dev1", "1");
      attributions.attribute("a", "Dev2", "9");
      attributions.attribute("b", "Dev1", "1");
      attributions.attribute("b", "Dev2", "19");
      attributions.attribute("c", "Dev1", "1");
      attributions.attribute("c", "Dev2", "29");
      attributions.attribute("d", "Dev1", "1");
      attributions.attribute("d", "Dev2", "39");
      result = utils.calculateBlockReward({ attributions, balances, whitelist });
      // Because of the attribution distribution, dev1 should get roughly 4% of total
      // rewards, while dev2 gets 96. There is some rounding errors which is why its not exact.
      assert.equal(fromWei(result["Dev1"]), "0.039999999999999999"); // 4%
      assert.equal(fromWei(result["Dev2"]), "0.959999999999999999"); // 96%
    });
    it("procesess simple attribution stream", async function() {
      const user = "usera";
      const dev = "0xaBBee9fC7a882499162323EEB7BF6614193312e3";
      const transactions = [await makeTx(0, 100, 100, user, dev)];
      const defaultAddress = "default";
      // This acts like a stream of decoded transactions
      const stream = highland(transactions);
      const result = await stream
        .through(
          // This returns a summed attribution table, summed by the number of blocks elapsed
          utils.ProcessAttributionStream({
            startBlock: 0,
            endBlock: 2,
            attributions: EmpAttributions(empAbi, defaultAddress)
          })
        )
        .toPromise(Promise);
      // Blocks ran for 0 and 1, for a transaction at time 0 for 100 tokens. This should give
      // the developer 200 attribution, 100 at time 0 plus 100 and time 1. End block= 2 and that
      // is not included in calculation.
      assert.equal(result.getAttribution(user, dev), "200");
    });
    it("procesess complex attribution stream", async function() {
      // same test as above with more complex array of transactions
      const transactions = [
        // UserA has 2 attributions at time 0 by developer A1 and A3 for 100 tokens each
        await makeTx(0, 0, 100, "usera", "0x00000000000000000000000000000000000000A1"),
        await makeTx(0, 0, 100, "usera", "0x00000000000000000000000000000000000000A3"),

        // UserB has 2 attributions at time 1 by dev a2 and a1 for 100 tokens each
        await makeTx(1, 0, 100, "userb", "0x00000000000000000000000000000000000000A2"),
        await makeTx(1, 0, 100, "userb", "0x00000000000000000000000000000000000000A1"),

        // userc has 2 attributions at time 2 from dev a3 and a2 for only 75 tokens
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
      // Dev A1 for userA was in at time 0 for 100 for blocks 0, 1 and 2, so should be 300
      assert.equal(result.getAttribution("usera", "0x00000000000000000000000000000000000000A1"), "300");
      // A1 was also in for userb at time 1 for 100 for blocks 1 and 2 so should be 200
      assert.equal(result.getAttribution("userb", "0x00000000000000000000000000000000000000A1"), "200");

      assert.equal(result.getAttribution("userb", "0x00000000000000000000000000000000000000A2"), "200");
      assert.equal(result.getAttribution("userc", "0x00000000000000000000000000000000000000A2"), "75");

      assert.equal(result.getAttribution("usera", "0x00000000000000000000000000000000000000A3"), "300");
      assert.equal(result.getAttribution("userc", "0x00000000000000000000000000000000000000A3"), "75");
    });
    // This tests that token balances get update through the event stream
    it("procesess simple event stream", async function() {
      // These events represent a stream of contract events. In this case
      // we only carre about position created as that will add to users token balance.
      const events = [
        {
          name: "PositionCreated",
          args: ["usera", 100, 100],
          blockNumber: 0
        }
      ];
      const result = await highland(events)
        .through(
          // Similar to the attribution processor, this will weigh balances over N blocks.
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
          // User a deposited at time 0 100 tokens
          name: "PositionCreated",
          args: ["usera", 100, 100],
          blockNumber: 0
        },
        {
          // User b deposited at time 1 100 tokens
          name: "PositionCreated",
          args: ["userb", 100, 100],
          blockNumber: 1
        },
        {
          // User c deposits at time 2 100 tokens
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
      // The balances get weighed by number of blocks elapsed from deposit. A was earliest, then B then C.
      assert.equal(result.get("usera"), "300");
      assert.equal(result.get("userb"), "200");
      assert.equal(result.get("userc"), "100");
    });
    it("gets rewards with simple examples", async function() {
      // This sets up as close to a real calculation without using a real dataset.
      // All the state is setup before hand and then reward output is checked.
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
      // The case sets up an equally attributed dataset to each developer, so we expect 50% split.
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
describe("DappMining V2", function() {
  let dappmining, utils;
  before(function() {
    const queries = Queries(datasetPath);
    dappmining = DappMining["v2"]({ queries, empAbi, web3 });
    utils = dappmining.utils;
  });
  describe("Dappmining V2 Unit Tests", function() {
    it("sums attributions", function() {
      const attributions = AttributionLookback();
      let sum = utils.sumAttributions(attributions);
      assert(sum);
      attributions.attribute("a", "a", "1");
      attributions.attribute("a", "b", "2");
      attributions.attribute("b", "b", "3");
      // this means 10 blocks has passed. this will basically multiply all attributions by 10 within the look back array
      sum = utils.sumAttributions(attributions, 10, sum);

      let result = sum.getAttributions("a", "30");
      assert.equal(result["a"], "10");
      assert.equal(result["b"], "20");

      // this finds mints from b (youngest) which takes it fully (20) remainder (5) taken from oldest mint a
      result = sum.getAttributions("a", "25");
      assert.equal(result["a"], "5");
      assert.equal(result["b"], "20");

      result = sum.getAttributions("b", "30");
      assert.equal(result["b"], "30");

      result = sum.getAttributions("b", "10");
      assert.equal(result["b"], "10");
    });
    // This tests 2 scenarios with the calculateBlockRewardFunction
    it("calculates block reward", function() {
      const balances = Balances();
      let attributions = AttributionLookback();
      // Creating a whitelist with 2 tagged addresses
      const whitelist = ["Dev1", "Dev2"];
      // This generates the current balance for each user, a, b, c and d
      balances.add("a", "10");
      balances.add("b", "20");
      balances.add("c", "30");
      balances.add("d", "40");
      // This attributions the balances contribution to each developer. For example
      // user a's balance was "referred" by Dev1 and Dev2 in equal proportion.
      // All settings below split a users balance contribution equally between the 2 developers.
      attributions.attribute("a", "Dev1", "5");
      attributions.attribute("a", "Dev2", "5");
      attributions.attribute("b", "Dev1", "10");
      attributions.attribute("b", "Dev2", "10");
      attributions.attribute("c", "Dev1", "15");
      attributions.attribute("c", "Dev2", "15");
      attributions.attribute("d", "Dev1", "20");
      attributions.attribute("d", "Dev2", "20");
      // Calculate block reward takes the current snapshot of attributions and balances and produces
      // a percentage attribution for each whitelisted developer.
      let result = utils.calculateBlockReward({ attributions, balances, whitelist });
      // Becuase balances were equally contributed to, we should expect 50% attribution.
      assert.equal(fromWei(result["Dev1"]), "0.5");
      assert.equal(fromWei(result["Dev2"]), "0.5");
      // Instanciating a new attribution scheme
      attributions = AttributionLookback();
      // This time we weight dev 1 to have a lower attribution than dev2 to each users balance.
      // For a's balance, Dev 1 attributed 1/10 and dev2 attributed 9/10, etc.
      attributions.attribute("a", "Dev1", "1");
      attributions.attribute("a", "Dev2", "9");
      attributions.attribute("b", "Dev1", "1");
      attributions.attribute("b", "Dev2", "19");
      attributions.attribute("c", "Dev1", "1");
      attributions.attribute("c", "Dev2", "29");
      attributions.attribute("d", "Dev1", "1");
      attributions.attribute("d", "Dev2", "39");
      result = utils.calculateBlockReward({ attributions, balances, whitelist });
      // Because of the attribution distribution, dev1 should get roughly 4% of total
      // rewards, while dev2 gets 96. There is some rounding errors which is why its not exact.
      assert.equal(fromWei(result["Dev1"]), "0.039999999999999999"); // 4%
      assert.equal(fromWei(result["Dev2"]), "0.959999999999999999"); // 96%

      attributions = AttributionLookback();
      // Showing attributions where there were redeems between, as if moving liquidity from one dapp to another
      attributions.attribute("a", "Dev1", "10");
      attributions.attribute("a", "Dev2", "10");
      attributions.attribute("b", "Dev1", "20");
      attributions.attribute("b", "Dev2", "20");
      attributions.attribute("c", "Dev1", "30");
      attributions.attribute("c", "Dev2", "30");
      attributions.attribute("d", "Dev1", "40");
      attributions.attribute("d", "Dev2", "40");
      result = utils.calculateBlockReward({ attributions, balances, whitelist });
      // In this case all liquidity will go to the second dev, as it was the last attribution event that covers all users balances
      assert.equal(fromWei(result["Dev1"]), "0");
      assert.equal(fromWei(result["Dev2"]), "1");
    });
    it("procesess simple attribution stream", async function() {
      const user = "usera";
      const dev = "0xaBBee9fC7a882499162323EEB7BF6614193312e3";
      const transactions = [await makeTx(0, 100, 100, user, dev)];
      const defaultAddress = "default";
      // This acts like a stream of decoded transactions
      const stream = highland(transactions);
      const result = await stream
        .through(
          // This returns a summed attribution table, summed by the number of blocks elapsed
          utils.ProcessAttributionStream({
            startBlock: 0,
            endBlock: 2,
            attributions: EmpAttributions(empAbi, defaultAddress, AttributionLookback())
          })
        )
        .toPromise(Promise);
      // Blocks ran for 0 and 1, for a transaction at time 0 for 100 tokens. This should give
      // developer 100% of attribution.
      const percent = result.getAttributionPercents(user, "200");
      assert.equal(percent[dev], toWei("1"));
    });
    it("procesess complex attribution stream", async function() {
      // same test as above with more complex array of transactions
      const transactions = [
        // UserA has 2 attributions at time 0 by developer A1 and A3 for 100 tokens each
        await makeTx(0, 0, 100, "usera", "0x00000000000000000000000000000000000000A1"),
        await makeTx(0, 0, 100, "usera", "0x00000000000000000000000000000000000000A3"),

        // UserB has 2 attributions at time 1 by dev a2 and a1 for 100 tokens each
        await makeTx(1, 0, 100, "userb", "0x00000000000000000000000000000000000000A2"),
        await makeTx(1, 0, 100, "userb", "0x00000000000000000000000000000000000000A1"),

        // userc has 2 attributions at time 2 from dev a3 and a2 for only 75 tokens
        await makeTx(2, 0, 75, "userc", "0x00000000000000000000000000000000000000A3"),
        await makeTx(2, 0, 75, "userc", "0x00000000000000000000000000000000000000A2")
      ];
      const defaultAddress = "default";
      const stream = highland(transactions);
      const result = await stream
        .through(
          utils.ProcessAttributionStream({
            // this essentially will multiply balances by 3 blocks
            startBlock: 0,
            endBlock: 3,
            attributions: EmpAttributions(empAbi, defaultAddress, AttributionLookback())
          })
        )
        .toPromise(Promise);
      let attributions = result.getAttributions("usera", "600");
      assert.equal(attributions["0x00000000000000000000000000000000000000A1"], "300");
      assert.equal(attributions["0x00000000000000000000000000000000000000A2"], undefined);
      assert.equal(attributions["0x00000000000000000000000000000000000000A3"], "300");

      // this  request forces a partial attribution for a1 since its older
      attributions = result.getAttributions("usera", "400");
      assert.equal(attributions["0x00000000000000000000000000000000000000A1"], "100");
      assert.equal(attributions["0x00000000000000000000000000000000000000A2"], undefined);
      assert.equal(attributions["0x00000000000000000000000000000000000000A3"], "300");

      // user b only attributed at time 1, so 2 blocks passed, his balance would sum to 400
      attributions = result.getAttributions("userb", "400");
      assert.equal(attributions["0x00000000000000000000000000000000000000A1"], "200");
      assert.equal(attributions["0x00000000000000000000000000000000000000A2"], "200");
      assert.equal(attributions["0x00000000000000000000000000000000000000A3"], undefined);

      // user c only attributed at time 2, so 1 blocks passed, his balance would sum to 150
      attributions = result.getAttributions("userc", "150");
      assert.equal(attributions["0x00000000000000000000000000000000000000A1"], undefined);
      assert.equal(attributions["0x00000000000000000000000000000000000000A2"], "75");
      assert.equal(attributions["0x00000000000000000000000000000000000000A3"], "75");
    });
    // This tests that token balances get update through the event stream
    it("procesess simple event stream", async function() {
      // These events represent a stream of contract events. In this case
      // we only carre about position created as that will add to users token balance.
      const events = [
        {
          name: "PositionCreated",
          args: ["usera", 100, 100],
          blockNumber: 0
        }
      ];
      const result = await highland(events)
        .through(
          // Similar to the attribution processor, this will weigh balances over N blocks.
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
          // User a deposited at time 0 100 tokens
          name: "PositionCreated",
          args: ["usera", 100, 100],
          blockNumber: 0
        },
        {
          // User b deposited at time 1 100 tokens
          name: "PositionCreated",
          args: ["userb", 100, 100],
          blockNumber: 1
        },
        {
          // User c deposits at time 2 100 tokens
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
      // The balances get weighed by number of blocks elapsed from deposit. A was earliest, then B then C.
      assert.equal(result.get("usera"), "300");
      assert.equal(result.get("userb"), "200");
      assert.equal(result.get("userc"), "100");
    });
    it("gets rewards with simple examples", async function() {
      // This sets up as close to a real calculation without using a real dataset.
      // All the state is setup before hand and then reward output is checked.
      const balances = Balances();
      let attributions = AttributionLookback();
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
      // The case sets up an equally attributed dataset to each developer, so we expect 50% split.
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
