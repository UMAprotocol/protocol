const { web3 } = require("hardhat");
const { assert } = require("chai");
const { ETHVIXPriceFeed } = require("../../dist/price-feed/EthVixPriceFeed");
const { NetworkerMock } = require("../../dist/price-feed/NetworkerMock");
const { parseFixed } = require("@uma/common");
const moment = require("moment");
const winston = require("winston");

describe("EthVixPriceFeed.js", () => {
  let networker;
  let priceFeed;
  let inversePriceFeed;
  let mockTime = 1616598000000;

  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 60;

  const historicalResponse = [
    { currency: "ETH", timestamp: "2021-03-24T14:30:00.000Z", spotPrice: "1737.04", vix: "88.47", iVix: "113.04" },
    { currency: "ETH", timestamp: "2021-03-24T14:45:00.000Z", spotPrice: "1738.36", vix: "88.78", iVix: "112.62" },
    { currency: "ETH", timestamp: "2021-03-24T15:00:00.000Z", spotPrice: "1740.26", vix: "70.2", iVix: "142.44" },
  ];

  beforeEach(() => {
    const logger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
    networker = new NetworkerMock();
    priceFeed = new ETHVIXPriceFeed(logger, web3, false, networker, getTime, minTimeBetweenUpdates, 18);
    inversePriceFeed = new ETHVIXPriceFeed(logger, web3, true, networker, getTime, minTimeBetweenUpdates, 18);
  });

  describe("After an initial update has been performed", () => {
    beforeEach(async () => {
      networker.getJsonReturns = new Array(3).fill(historicalResponse);
    });

    describe("Price discovery", () => {
      it("can return the latest ethVIX price", async () => {
        await priceFeed.update();
        assert.equal(priceFeed.getCurrentPrice().toString(), web3.utils.toWei("70.2"));
      });

      it("can return the latest iethVIX price", async () => {
        await inversePriceFeed.update();
        assert.equal(inversePriceFeed.getCurrentPrice().toString(), web3.utils.toWei("142.44"));
      });

      it("can properly scale results per the DVM requirement (wei units)", async () => {
        await priceFeed.update();
        assert.equal(web3.utils.fromWei(priceFeed.getCurrentPrice()), "70.2");
      });

      it("can properly handle unordered response data", async () => {
        networker.getJsonReturns = [[...historicalResponse].reverse()];
        await priceFeed.update();
        assert.equal(web3.utils.fromWei(priceFeed.getCurrentPrice()), "70.2");
      });
    });

    describe("Historical price discovery", () => {
      it("can return the historical ethVIX price at a specific time", async () => {
        const { timestamp, vix } = historicalResponse[1];
        await priceFeed.update();
        const historicalPrice = await priceFeed.getHistoricalPrice(moment.utc(timestamp).valueOf());
        assert.equal(historicalPrice.toString(), parseFixed(vix, 18).toString());
      });

      it("can return the most recent historical ethVIX price within 15m of a given time", async () => {
        await priceFeed.update();
        const historicalPrice = await priceFeed.getHistoricalPrice(
          moment.utc(historicalResponse[1].timestamp).add(1, "minute").valueOf()
        );
        assert.equal(historicalPrice.toString(), parseFixed(historicalResponse[1].vix, 18).toString());

        const justBeforeNextPrice = await priceFeed.getHistoricalPrice(
          moment.utc(historicalResponse[1].timestamp).add(15, "minutes").subtract(1, "ms").valueOf()
        );
        assert.equal(justBeforeNextPrice.toString(), parseFixed(historicalResponse[1].vix, 18).toString());

        const nextPrice = await priceFeed.getHistoricalPrice(
          moment.utc(historicalResponse[1].timestamp).add(15, "minutes").valueOf()
        );
        assert.equal(nextPrice.toString(), parseFixed(historicalResponse[2].vix, 18).toString());
      });
    });

    describe("Updating the cache", () => {
      it("will process updates as frequently as configured", async () => {
        await priceFeed.update();
        const initialUpdateTime = priceFeed.getLastUpdateTime();

        mockTime += moment.duration(minTimeBetweenUpdates, "seconds");
        await priceFeed.update();
        const subsequentUpdateTime = priceFeed.getLastUpdateTime();

        assert.notEqual(subsequentUpdateTime, initialUpdateTime);
      });

      it("will not process updates too frequently", async () => {
        await priceFeed.update();
        const initialUpdateTime = priceFeed.getLastUpdateTime();

        await priceFeed.update();
        const skippedUpdateTime = priceFeed.getLastUpdateTime();
        assert.equal(skippedUpdateTime, initialUpdateTime);

        mockTime += moment.duration(minTimeBetweenUpdates, "seconds");
        await priceFeed.update();
        const finalUpdateTime = priceFeed.getLastUpdateTime();
        assert.notEqual(finalUpdateTime, initialUpdateTime);
      });
    });
  });

  describe("Before an initial update has been performed", () => {
    it("does not have a last update time", () => {
      assert.isNull(priceFeed.getLastUpdateTime());
    });

    it("throws when the ethVIX price is requested", () => {
      assert.throws(() => priceFeed.getCurrentPrice());
    });

    it("throws when the iethVIX price is requested", () => {
      assert.throws(() => inversePriceFeed.getCurrentPrice());
    });

    it("throws when the historical ethVIX price is requested", async () => {
      let result;
      let errorMessage;

      try {
        result = await priceFeed.getHistoricalPrice(mockTime);
      } catch (error) {
        errorMessage = error.message;
      }

      assert.equal(errorMessage, "dVIX.ethVIX: undefined lastUpdateTime. Update required.");
      assert.isUndefined(result);
    });

    it("throws when the historical iethVIX price is requested", async () => {
      let result;
      let errorMessage;

      try {
        result = await inversePriceFeed.getHistoricalPrice(mockTime);
      } catch (error) {
        errorMessage = error.message;
      }

      assert.equal(errorMessage, "dVIX.iethVIX: undefined lastUpdateTime. Update required.");
      assert.isUndefined(result);
    });
  });
});
