// Script to test
const AncillaryDataParser = require("../dist/AncillaryDataParser");
const Web3 = require("web3");
const { assert } = require("chai");

describe("AncillaryDataParser.js", function () {
  describe("parseAncillaryData", function () {
    it("parses simple key-value data correctly", async function () {
      const data = Web3.utils.utf8ToHex("key:value");
      const expectedObject = { key: "value" };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("removes excess whitespace", async function () {
      const data = Web3.utils.utf8ToHex("  key1  :  value1  , key2 : value2 ");
      const expectedObject = { key1: "value1", key2: "value2" };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("leaves quoted whitespace", async function () {
      const data = Web3.utils.utf8ToHex('"  key " :"  value  "');
      const expectedObject = { "  key ": "  value  " };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("leaves unclosed quotes", async function () {
      const data = Web3.utils.utf8ToHex('"  key  :  value  "');
      const expectedObject = { '"  key': 'value  "' };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("parses json values as an object", async function () {
      const data = Web3.utils.utf8ToHex('key:{"nestedKey": "nestedValue"}');
      const expectedObject = { key: { nestedKey: "nestedValue" } };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("parses non-compliant json enclosed in {} or [] as a string", async function () {
      const data = Web3.utils.utf8ToHex('key:{nestedKey: "nestedValue",}');
      const expectedObject = { key: '{nestedKey: "nestedValue",}' };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("parses json array with different types as values correctly", async function () {
      const data = Web3.utils.utf8ToHex('key:[1, "a", null, true, { }, []]');
      const expectedObject = { key: [1, "a", null, true, {}, []] };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("parses no value after column delimiter as an empty string", async function () {
      const data = Web3.utils.utf8ToHex("key:");
      const expectedObject = { key: "" };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("parses SPACEXLAUNCH data correctly", async function () {
      const data = "0x6964303a537461726c696e6b2d31382c77303a312c6964313a537461726c696e6b2d31392c77313a31";
      const expectedObject = { id0: "Starlink-18", w0: 1, id1: "Starlink-19", w1: 1 };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("parses KPI option example #1 data correctly", async function () {
      const data =
        "0x4d65747269633a54564c20696e20554d412066696e616e6369616c20636f6e747261637473206d6561737572656420696e2062696c6c696f6e73206f66205553442c456e64706f696e743a2268747470733a2f2f6170692e756d6170726f6a6563742e6f72672f756d612d74766c222c4d6574686f643a2268747470733a2f2f6769746875622e636f6d2f554d4170726f746f636f6c2f554d4950732f626c6f622f6d61737465722f554d4950732f756d69702d36352e6d64222c4b65793a63757272656e7454766c2c496e74657276616c3a55706461746564206576657279203130206d696e757465732c526f756e64696e673a2d372c5363616c696e673a2d39";
      const expectedObject = {
        Metric: "TVL in UMA financial contracts measured in billions of USD",
        Endpoint: "https://api.umaproject.org/uma-tvl",
        Method: "https://github.com/UMAprotocol/UMIPs/blob/master/UMIPs/umip-65.md",
        Key: "currentTvl",
        Interval: "Updated every 10 minutes",
        Rounding: -7,
        Scaling: -9,
      };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("parses KPI option example #2 data correctly", async function () {
      const data =
        "0x4d65747269633a4e756d626572206f66207175616c696679696e6720554d412044414f20696e746567726174696f6e732c456e64706f696e743a2268747470733a2f2f6170692e756d6170726f6a6563742e6f72672f756d612d64616f2d696e746567726174696f6e73222c4d6574686f643a2268747470733a2f2f6769746875622e636f6d2f554d4170726f746f636f6c2f554d4950732f626c6f622f6d61737465722f554d4950732f756d69702d3131322e6d64222c4b65793a63757272656e74496e746567726174696f6e732c496e74657276616c3a55706461746564206461696c792c526f756e64696e673a322c737461727454696d657374616d703a313632323532373230302c6d617842617365496e746567726174696f6e733a31352c6d6178426f6e7573496e746567726174696f6e733a332c626f6e75734d696e56616c75653a2224312c3030302c303030222c626f6e7573496e746567726174696f6e734d756c7469706c6965723a332e30302c666c6f6f72496e746567726174696f6e733a33";
      const expectedObject = {
        Metric: "Number of qualifying UMA DAO integrations",
        Endpoint: "https://api.umaproject.org/uma-dao-integrations",
        Method: "https://github.com/UMAprotocol/UMIPs/blob/master/UMIPs/umip-112.md",
        Key: "currentIntegrations",
        Interval: "Updated daily",
        Rounding: 2,
        startTimestamp: 1622527200,
        maxBaseIntegrations: 15,
        maxBonusIntegrations: 3,
        bonusMinValue: "$1,000,000",
        bonusIntegrationsMultiplier: 3.0,
        floorIntegrations: 3,
      };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("parses TOKEN_PRICE example data correctly", async function () {
      const data =
        "0x626173653a554d412c62617365416464726573733a3078303446613064323335433461626634426346343738376146344346343437444535373265463832382c71756f74653a5553442c71756f746544657461696c733a556e697465642053746174657320446f6c6c61722c726f756e64696e673a362c66616c6c6261636b3a2268747470733a2f2f7777772e636f696e6765636b6f2e636f6d2f656e2f636f696e732f756d61222c636f6e66696775726174696f6e3a7b0a202020202274797065223a20226d656469616e697a6572222c0a20202020226d696e54696d654265747765656e55706461746573223a2036302c0a2020202022747761704c656e677468223a20333630302c0a20202020226d656469616e697a65644665656473223a205b0a2020202020207b202274797065223a202263727970746f7761746368222c202265786368616e6765223a2022636f696e626173652d70726f222c202270616972223a2022756d6175736422207d2c0a2020202020207b202274797065223a202263727970746f7761746368222c202265786368616e6765223a202262696e616e6365222c202270616972223a2022756d617573647422207d2c0a2020202020207b202274797065223a202263727970746f7761746368222c202265786368616e6765223a20226f6b6578222c202270616972223a2022756d617573647422207d0a202020205d0a20207d";
      const expectedObject = {
        base: "UMA",
        baseAddress: "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828",
        quote: "USD",
        quoteDetails: "United States Dollar",
        rounding: 6,
        fallback: "https://www.coingecko.com/en/coins/uma",
        configuration: {
          type: "medianizer",
          minTimeBetweenUpdates: 60,
          twapLength: 3600,
          medianizedFeeds: [
            { type: "cryptowatch", exchange: "coinbase-pro", pair: "umausd" },
            { type: "cryptowatch", exchange: "binance", pair: "umausdt" },
            { type: "cryptowatch", exchange: "okex", pair: "umausdt" },
          ],
        },
      };
      const parsedData = AncillaryDataParser.parseAncillaryData(data);
      assert.equal(JSON.stringify(parsedData), JSON.stringify(expectedObject));
    });
    it("random hex should throw error", async function () {
      const data = "0xb54a997b04e78c474d02d297a31b75a6";
      assert.throw(() => {
        AncillaryDataParser.parseAncillaryData(data);
      });
    });
    it("json object as key should throw error", async function () {
      const data = Web3.utils.utf8ToHex('{"nestedKey":"nestedValue"}:value');
      assert.throw(() => {
        AncillaryDataParser.parseAncillaryData(data);
      });
    });
    it("key with no column delimiter should throw error", async function () {
      const data = Web3.utils.utf8ToHex("key");
      assert.throw(() => {
        AncillaryDataParser.parseAncillaryData(data);
      });
    });
    it("empty key before column delimiter should throw error", async function () {
      const data = Web3.utils.utf8ToHex(":value");
      assert.throw(() => {
        AncillaryDataParser.parseAncillaryData(data);
      });
    });
    it("multiple column delimiters in a key-value pair should throw error", async function () {
      const data = Web3.utils.utf8ToHex("key:value1:value2");
      assert.throw(() => {
        AncillaryDataParser.parseAncillaryData(data);
      });
    });
  });
});
