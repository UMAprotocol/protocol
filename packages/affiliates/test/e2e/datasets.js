const { BigQuery } = require("@google-cloud/bigquery");
// const highland = require("highland");
const { assert } = require("chai");
const fs = require("fs");
const Path = require("path");

const { Dataset, mocks, serializers } = require("../../libs/datasets");
const { Blocks, Transactions, Logs, Coingecko } = serializers;
const Queries = require("../../libs/bigquery");
const params = require("../../test/datasets/set1");
const CoingeckoApi = require("../../libs/coingecko");

const basePath = Path.join(__dirname, "test-datasets");
describe("Datasets", function() {
  let client, queries, coingecko;
  before(async function() {
    client = new BigQuery();
    queries = Queries({ client });
    coingecko = CoingeckoApi();
  });
  describe("Blocks Serializer", function() {
    it("serializes", async function() {
      this.timeout(10000);
      const config = {
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 5,
        select: ["timestamp", "number"]
      };
      const dataStream = queries.streamBlocks(config.start, config.end, config.select);
      const stream = Blocks().serialize(dataStream);
      const result = await stream.collect().toPromise(Promise);
      assert(result.length);
      assert.deepEqual(result[0].trim().split(","), ["timestamp.value", "number"]);
    });
    it("deserializes", async function() {
      this.timeout(10000);
      const config = {
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 5,
        select: ["timestamp", "number"]
      };
      const blocks = Blocks();
      const dataStream = queries.streamBlocks(config.start, config.end, config.select);
      const serialized = blocks.serialize(dataStream);
      const result = await blocks
        .deserialize(serialized)
        .collect()
        .toPromise(Promise);
      assert(result.length);
      assert(result[0].number);
      assert(result[0].timestamp.value);
    });
  });
  describe("Logs Serializer", function() {
    it("serializes", async function() {
      this.timeout(10000);
      const config = {
        contract: params.empCreator,
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 60 * 24 * 10,
        select: ["block_timestamp", "block_number", "data", "topics"]
      };
      const dataStream = queries.streamLogsByContract(config.contract, config.start, config.end, config.select);
      const stream = Logs().serialize(dataStream);
      const result = await stream.collect().toPromise(Promise);
      assert(result.length);
    });
    it("deserializes", async function() {
      this.timeout(10000);
      const config = {
        contract: params.empCreator,
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 60 * 24 * 10,
        select: ["block_timestamp", "block_number", "data", "topics"]
      };
      const logs = Logs();
      const dataStream = queries.streamLogsByContract(config.contract, config.start, config.end, config.select);
      const serialized = await logs
        .serialize(dataStream)
        .collect()
        .toPromise(Promise);
      const result = await logs
        // simulate a file stream
        .deserialize(serialized.join("").split(""))
        .collect()
        .toPromise(Promise);
      assert(result.length);
      assert(result[0].block_number);
      assert(result[0].block_timestamp.value);
      assert(result[0].data);
      assert(result[0].topics);
    });
  });
  describe("Transactions Serializer", function() {
    it("serializes", async function() {
      this.timeout(10000);
      const config = {
        contract: params.empCreator,
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 60 * 24 * 10,
        select: ["block_timestamp", "block_number", "input"]
      };
      const dataStream = queries.streamTransactionsByContract(config.contract, config.start, config.end, config.select);
      const stream = Transactions().serialize(dataStream);
      const result = await stream.collect().toPromise(Promise);
      assert(result.length);
    });
    it("deserializes", async function() {
      this.timeout(10000);
      const config = {
        contract: params.empCreator,
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 60 * 24 * 10,
        select: ["block_timestamp", "block_number", "input"]
      };
      const parser = Transactions();
      const dataStream = queries.streamTransactionsByContract(config.contract, config.start, config.end, config.select);
      const serialized = await parser
        .serialize(dataStream)
        .collect()
        .toPromise(Promise);
      const result = await parser
        // simulate a file stream
        .deserialize(serialized.join("").split(""))
        .collect()
        .toPromise(Promise);
      assert(result.length);
      assert(result[0].block_number);
      assert(result[0].block_timestamp.value);
      assert(result[0].input);
    });
  });
  describe("Coingecko Serializer", function() {
    it("serializes", async function() {
      this.timeout(10000);
      const config = {
        contract: params.syntheticTokens[0],
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 60 * 24 * 10,
        currency: "usd"
      };
      const data = await coingecko.chart(config.contract.toLowerCase(), config.currency, config.start, config.end);
      const result = Coingecko().serialize(data);
      assert(result);
    });
    it("deserializes", async function() {
      this.timeout(10000);
      const config = {
        contract: params.syntheticTokens[0],
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 60 * 24 * 10,
        currency: "usd"
      };
      const data = await coingecko.chart(config.contract.toLowerCase(), config.currency, config.start, config.end);
      const serialized = Coingecko().serialize(data);
      const result = await Coingecko()
        .deserialize(serialized.split())
        .toPromise(Promise);
      assert(result.prices.length);
      assert(result.total_volumes.length);
      assert(result.market_caps.length);
    });
  });
  describe("Dataset and Mocks", function() {
    let path;
    after(function(done) {
      fs.rmdir(basePath, { recursive: true }, done);
    });
    it("saves new set", async function() {
      this.timeout(10000);
      const config = {
        ...params,
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 60 * 24 * 10
      };
      const ds = Dataset(basePath, { queries, coingecko });
      path = await ds.save("test-set", config);
    });
    it("loads query mock", async function() {
      this.timeout(10000);
      const config = {
        ...params,
        start: params.startingTimestamp,
        end: params.startingTimestamp + 1000 * 60 * 60 * 24 * 10
      };
      assert(path, "requires dataset path");
      const query = mocks.Queries(path);
      const blocks = await query.getBlocks(config.start, config.end);
      assert(blocks.length);
      const logs = await query.getLogsByContract(config.empCreator);
      assert(logs.length);
    });
  });
});
