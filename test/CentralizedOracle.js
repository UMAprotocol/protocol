const { didContractThrow } = require("./utils/DidContractThrow.js");

const CentralizedOracle = artifacts.require("CentralizedOracle");
const BigNumber = require("bignumber.js");


contract("CentralizedOracle", function(accounts) {

    // A deployed instance of the CentralizedOracle contract, ready for testing.
    let centralizedOracle;

    const owner = accounts[0];
    const rando = accounts[1];

    const oraclePriceDelay = 60*60*24*7;

    before(async function() {
        centralizedOracle = await CentralizedOracle.deployed();
    });

    it("Enqueue queries (two times) > Push > Requery > Push > Request", async function() {
        const productBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("product"));
        const firstTime = 10;
        const price = 500;
        const secondTime = 20;

        // Configure the oracle to support the products used in this test.
        await centralizedOracle.addSupportedProduct(productBytes);

        // No queries are currently stored.
        let pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 0);

        // Enqueue the request for a price, and verify that `timeForPrice`=0.
        let currentTime = 100;
        await centralizedOracle.setCurrentTime(currentTime);
        let getPriceResult = await centralizedOracle.getPrice.call(productBytes, firstTime);
        await centralizedOracle.getPrice(productBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, 0);
        assert.equal(getPriceResult.verifiedTime, currentTime + oraclePriceDelay);

        // Check that the query is pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 1);

        // Enqueue the second request for a price, and verify that `timeForPrice`=0.
        currentTime = 5000;
        await centralizedOracle.setCurrentTime(currentTime);
        getPriceResult = await centralizedOracle.getPrice.call(productBytes, secondTime);
        await centralizedOracle.getPrice(productBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, 0);
        assert.equal(getPriceResult.verifiedTime, currentTime + oraclePriceDelay);

        // Check that both queries are pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 2);

        // Push a price for the first product.
        const firstPricePushTime = 10000;
        await centralizedOracle.setCurrentTime(firstPricePushTime);
        await centralizedOracle.pushPrice(productBytes, firstTime, price);

        // Get first price.
        getPriceResult = await centralizedOracle.getPrice.call(productBytes, firstTime);
        await centralizedOracle.getPrice(productBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, firstTime);
        assert.equal(getPriceResult.price, price);
        assert.equal(getPriceResult.verifiedTime, firstPricePushTime);

        // Check that the second query is pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 1);

        // Push a price for the second product.
        const secondPricePushTime = 20000;
        await centralizedOracle.setCurrentTime(secondPricePushTime);
        await centralizedOracle.pushPrice(productBytes, secondTime, price);

        // Get second price.
        getPriceResult = await centralizedOracle.getPrice.call(productBytes, secondTime);
        await centralizedOracle.getPrice(productBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, secondTime);
        assert.equal(getPriceResult.price, price);
        assert.equal(getPriceResult.verifiedTime, secondPricePushTime);

        // Get the first price again, just to double check.
        getPriceResult = await centralizedOracle.getPrice.call(productBytes, firstTime);
        await centralizedOracle.getPrice(productBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, firstTime);
        assert.equal(getPriceResult.price, price);
        assert.equal(getPriceResult.verifiedTime, firstPricePushTime);
    });

    it("Enqueue queries (two products) > Push > Requery > Push > Requery", async function() {
        const firstproductBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("First"));
        const firstTime = 10;
        const firstPrice = 500;

        const secondproductBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Second"));
        const secondTime = 10;
        const secondPrice = 1000;

        // Configure the oracle to support the products used in this test.
        await centralizedOracle.addSupportedProduct(firstproductBytes);
        await centralizedOracle.addSupportedProduct(secondproductBytes);

        // No queries are currently stored.
        let pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 0);

        // Enqueue the request for a price, and verify that `timeForPrice`=0.
        let getPriceResult = await centralizedOracle.getPrice.call(firstproductBytes, firstTime);
        await centralizedOracle.getPrice(firstproductBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, 0);

        // Check that the query is pending
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 1);
        assert.equal(pendingQueries[0].time, firstTime);

        // Enqueue a second request for a price, and verify that `timeForPrice`=0.
        getPriceResult = await centralizedOracle.getPrice.call(secondproductBytes, secondTime);
        await centralizedOracle.getPrice(secondproductBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, 0);

        // Check that both queries are pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 2);

        // Prices are still not available, until a price is pushed.
        getPriceResult = await centralizedOracle.getPrice.call(firstproductBytes, firstTime);
        await centralizedOracle.getPrice(firstproductBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, 0);
        getPriceResult = await centralizedOracle.getPrice.call(secondproductBytes, secondTime);
        await centralizedOracle.getPrice(secondproductBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, 0);

        // Push a price for the second product.
        await centralizedOracle.pushPrice(secondproductBytes, secondTime, secondPrice);

        // Price should now be available.
        getPriceResult = await centralizedOracle.getPrice.call(secondproductBytes, secondTime);
        await centralizedOracle.getPrice(secondproductBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, secondTime);
        assert.equal(getPriceResult.price, secondPrice);

        // First request is still pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 1);
        assert.equal(pendingQueries[0].time, firstTime);;

        // Push a price for the first product.
        await centralizedOracle.pushPrice(firstproductBytes, firstTime, firstPrice);

        // Price should now be available.
        getPriceResult = await centralizedOracle.getPrice.call(firstproductBytes, firstTime);
        await centralizedOracle.getPrice(firstproductBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, firstTime);
        assert.equal(getPriceResult.price, firstPrice);

        // No pending queries.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 0);
    });

    it("Non owner", async function() {
        const productBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Owned"));

        // Non-owners can't add supported products.
        assert(
            await didContractThrow(centralizedOracle.addSupportedProduct(productBytes, { from: rando }))
        );

        // Configure the oracle to support the products used in this test, as an owner.
        await centralizedOracle.addSupportedProduct(productBytes);

        // Request the price, which any contract can do (for now).
        await centralizedOracle.getPrice(productBytes, 10, { from: rando });

        // Non-owners can't push prices.
        assert(
            await didContractThrow(centralizedOracle.pushPrice(productBytes, 10, 10, { from: rando }))
        );
    });

    it("Push unqueried price", async function() {
        const productBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Unqueried"));

        // Configure the oracle to support the products used in this test.
        await centralizedOracle.addSupportedProduct(productBytes);

        // Can't push a price that isn't queried yet.
        assert(
            await didContractThrow(centralizedOracle.pushPrice(productBytes, 10, 10))
        );
    });

    it("Unsupported product", async function() {
        const productBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Unsupported"));
        assert(
            await didContractThrow(centralizedOracle.getPrice(productBytes, 10))
        );
    });
});
