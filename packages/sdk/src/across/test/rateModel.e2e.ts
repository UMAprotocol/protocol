import dotenv from "dotenv";
import assert from "assert";
import * as rateModel from "../rateModel";
import { expectedRateModelKeys } from "../constants";
import { ethers, Event } from "ethers";
dotenv.config();

import { RateModelStoreEthers, RateModelStoreEthers__factory } from "@uma/contracts-node";

// Test against mainnet for hardcoded block range so we can know which events we should expect to fetch.
const address = "0xd18fFeb5fdd1F2e122251eA7Bf357D8Af0B60B50";
const blockSearchConfig = { fromBlock: 13771428, toBlock: 13771428 };

describe("rateModel", function () {
  let provider: ethers.providers.BaseProvider;
  let rateModelStore: RateModelStoreEthers;
  let rateModelDictionary: rateModel.RateModelDictionary;
  let filteredEvents: rateModel.RateModelEvent[];
  beforeEach(async function () {
    rateModelDictionary = new rateModel.RateModelDictionary();
  });
  test("inits", async function () {
    provider = ethers.providers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    rateModelStore = RateModelStoreEthers__factory.connect(address, provider);
    const allUpdateEvents = await rateModelStore.queryFilter(
      rateModelStore.filters.UpdatedRateModel(),
      blockSearchConfig.fromBlock,
      blockSearchConfig.toBlock
    );
    filteredEvents = allUpdateEvents.map((event: Event) => {
      return {
        blockNumber: event.blockNumber,
        transactionIndex: event.transactionIndex,
        logIndex: event.logIndex,
        rateModel: event.args?.rateModel,
        l1Token: event.args?.l1Token,
      };
    });
  });
  describe("RateModelDictionary class", function () {
    test("getRateModelForBlockNumber", async function () {
      // Update dictionary with events before fetching rate model.
      try {
        await rateModelDictionary.getRateModelForBlockNumber(
          "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          blockSearchConfig.fromBlock
        );
        assert.fail("Should throw error");
      } catch (err) {
        if (err instanceof Error) {
          assert.equal(err.message.includes("method called before updating"), true);
        } else {
          throw err;
        }
      }
      rateModelDictionary.updateWithEvents(filteredEvents);

      // Cannot fetch rate model for block height before earliest event.
      try {
        await rateModelDictionary.getRateModelForBlockNumber(
          "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          blockSearchConfig.fromBlock - 1
        );
        assert.fail("Should throw error");
      } catch (err) {
        if (err instanceof Error) {
          assert.equal(err.message.includes("before first UpdatedRateModel event"), true);
        } else {
          throw err;
        }
      }

      // Cannot fetch rate model when dictionary has no entries for L1 token.
      try {
        await rateModelDictionary.getRateModelForBlockNumber(rateModelStore.address, blockSearchConfig.fromBlock - 1);
        assert.fail("Should throw error");
      } catch (err) {
        if (err instanceof Error) {
          assert.equal(err.message.includes("No updated rate model events for L1 token"), true);
        } else {
          throw err;
        }
      }

      // Test for expected rate models.
      assert.deepStrictEqual(
        await rateModelDictionary.getRateModelForBlockNumber(
          "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          blockSearchConfig.fromBlock
        ),
        { UBar: "650000000000000000", R0: "0", R1: "80000000000000000", R2: "1000000000000000000" }
      );
      assert.deepStrictEqual(
        await rateModelDictionary.getRateModelForBlockNumber(
          "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          blockSearchConfig.fromBlock
        ),
        { UBar: "800000000000000000", R0: "0", R1: "40000000000000000", R2: "600000000000000000" }
      );
      assert.deepStrictEqual(
        await rateModelDictionary.getRateModelForBlockNumber(
          "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828",
          blockSearchConfig.fromBlock
        ),
        { UBar: "500000000000000000", R0: "0", R1: "50000000000000000", R2: "2000000000000000000" }
      );
      assert.deepStrictEqual(
        await rateModelDictionary.getRateModelForBlockNumber(
          "0x3472A5A71965499acd81997a54BBA8D852C6E53d",
          blockSearchConfig.fromBlock
        ),
        { UBar: "500000000000000000", R0: "25000000000000000", R1: "25000000000000000", R2: "2000000000000000000" }
      );

      // Returns latest rate model when block number is undefined
      assert.deepStrictEqual(
        await rateModelDictionary.getRateModelForBlockNumber("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
        { UBar: "650000000000000000", R0: "0", R1: "80000000000000000", R2: "1000000000000000000" }
      );

      // TODO: Add unit tests to check that rate model grabs newly updated rate model for a block height.
    });
    test("getL1TokensFromRateModel", async function () {
      // Update dictionary with events before fetching tokens.
      try {
        await rateModelDictionary.getL1TokensFromRateModel(blockSearchConfig.fromBlock);
        assert.fail("Should throw error");
      } catch (err) {
        if (err instanceof Error) {
          assert.equal(err.message.includes("method called before updating"), true);
        } else {
          throw err;
        }
      }
      rateModelDictionary.updateWithEvents(filteredEvents);

      // Returns 0 tokens when block height is before earliest event
      assert.deepStrictEqual(await rateModelDictionary.getL1TokensFromRateModel(blockSearchConfig.fromBlock - 1), []);

      // Returns expected # of tokens when block height is set correctly
      assert.deepStrictEqual(await rateModelDictionary.getL1TokensFromRateModel(blockSearchConfig.fromBlock), [
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828",
        "0x3472A5A71965499acd81997a54BBA8D852C6E53d",
      ]);
      // Rate model didn't change after one block, should return same set of tokens
      assert.deepStrictEqual(
        await rateModelDictionary.getL1TokensFromRateModel(blockSearchConfig.fromBlock + 1),
        await rateModelDictionary.getL1TokensFromRateModel(blockSearchConfig.fromBlock)
      );
    });
  });
  test("parseAndReturnRateModelFromString", function () {
    try {
      rateModel.parseAndReturnRateModelFromString("not a JSON");
      assert.fail("Should throw error");
    } catch (err) {
      if (err instanceof Error) {
        assert.equal(err.message.includes("JSON"), true);
      } else {
        throw err;
      }
    }

    const validRateModel = {
      [expectedRateModelKeys[0]]: "2",
      [expectedRateModelKeys[1]]: "2",
      [expectedRateModelKeys[2]]: "2",
      [expectedRateModelKeys[3]]: "2",
    };
    const rateModelWithMissingKeys = JSON.parse(JSON.stringify(validRateModel));
    delete rateModelWithMissingKeys[expectedRateModelKeys[0]];
    try {
      rateModel.parseAndReturnRateModelFromString(JSON.stringify(rateModelWithMissingKeys));
      assert.fail("Should throw error");
    } catch (err) {
      if (err instanceof Error) {
        assert.equal(err.message.includes("does not contain all expected keys"), true);
      } else {
        throw err;
      }
    }

    const rateModelWithExtraKeys = {
      ...validRateModel,
      extraKey: "value",
    };
    try {
      rateModel.parseAndReturnRateModelFromString(JSON.stringify(rateModelWithExtraKeys));
      assert.fail("Should throw error");
    } catch (err) {
      if (err instanceof Error) {
        assert.equal(err.message.includes("contains unexpected keys"), true);
      } else {
        throw err;
      }
    }

    assert.deepStrictEqual(rateModel.parseAndReturnRateModelFromString(JSON.stringify(validRateModel)), validRateModel);
  });
});
