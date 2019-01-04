const { didContractThrow } = require("./utils/DidContractThrow.js");

const CentralizedOracle = artifacts.require("CentralizedOracle");
const BigNumber = require("bignumber.js");


contract("CentralizedOracle", function(accounts) {

    // A deployed instance of the CentralizedOracle contract, ready for testing.
    let centralizedOracle;

    let owner = accounts[0];
    let rando = accounts[1];

    before(async function() {
        centralizedOracle = await CentralizedOracle.deployed();
    });

    it("Enqueue queries (two times) > Push > Requery > Push > Request", async function() {
        const symbolBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("symbol"));
        const firstTime = 10;
        const price = 500;
        const secondTime = 20;

        // No queries are currently stored.
        let pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 0);

        // Enqueue the request for a price, and verify that `timeForPrice`=0.
        let getPriceResult = await centralizedOracle.getPrice.call(symbolBytes, firstTime);
        await centralizedOracle.getPrice(symbolBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, 0);

        // Check that the query is pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 1);

        // Enqueue the second request for a price, and verify that `timeForPrice`=0.
        getPriceResult = await centralizedOracle.getPrice.call(symbolBytes, secondTime);
        await centralizedOracle.getPrice(symbolBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, 0);

        // Check that both queries are pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 2);

        // Push a price for the first symbol.
        await centralizedOracle.pushPrice(symbolBytes, firstTime, price);

        // Get first price.
        getPriceResult = await centralizedOracle.getPrice.call(symbolBytes, firstTime);
        await centralizedOracle.getPrice(symbolBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, firstTime);
        assert.equal(getPriceResult.price, price);

        // Check that the second query is pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 1);

        // Push a price for the second symbol.
        await centralizedOracle.pushPrice(symbolBytes, secondTime, price);

        // Get second price.
        getPriceResult = await centralizedOracle.getPrice.call(symbolBytes, secondTime);
        await centralizedOracle.getPrice(symbolBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, secondTime);
        assert.equal(getPriceResult.price, price);

        // Get the first price again, just to double check.
        getPriceResult = await centralizedOracle.getPrice.call(symbolBytes, firstTime);
        await centralizedOracle.getPrice(symbolBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, firstTime);
        assert.equal(getPriceResult.price, price);
    });

    it("Enqueue queries (two symbols) > Push > Requery > Push > Requery", async function() {
        const firstSymbol = "First";
        const firstSymbolBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(firstSymbol));
        const firstTime = 10;
        const firstPrice = 500;

        const secondSymbolBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Second"));
        const secondTime = 10;
        const secondPrice = 1000;

        // No queries are currently stored.
        let pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 0);

        // Enqueue the request for a price, and verify that `timeForPrice`=0.
        let getPriceResult = await centralizedOracle.getPrice.call(firstSymbolBytes, firstTime);
        await centralizedOracle.getPrice(firstSymbolBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, 0);

        // Check that the query is pending
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 1);
        // assert.equal(web3.utils.hexToUtf8(web3.utils.bytesToHex(pendingQueries[0].symbol)), firstSymbol);
        assert.equal(pendingQueries[0].time, firstTime);

        // Enqueue a second request for a price, and verify that `timeForPrice`=0.
        getPriceResult = await centralizedOracle.getPrice.call(secondSymbolBytes, secondTime);
        await centralizedOracle.getPrice(secondSymbolBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, 0);

        // Check that both queries are pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 2);

        // Prices are still not available, until a price is pushed.
        getPriceResult = await centralizedOracle.getPrice.call(firstSymbolBytes, firstTime);
        await centralizedOracle.getPrice(firstSymbolBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, 0);
        getPriceResult = await centralizedOracle.getPrice.call(secondSymbolBytes, secondTime);
        await centralizedOracle.getPrice(secondSymbolBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, 0);

        // Push a price for the second symbol.
        await centralizedOracle.pushPrice(secondSymbolBytes, secondTime, secondPrice);

        // Price should now be available.
        getPriceResult = await centralizedOracle.getPrice.call(secondSymbolBytes, secondTime);
        await centralizedOracle.getPrice(secondSymbolBytes, secondTime);
        assert.equal(getPriceResult.timeForPrice, secondTime);
        assert.equal(getPriceResult.price, secondPrice);

        // First request is still pending.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 1);
        assert.equal(pendingQueries[0].time, firstTime);;

        // Push a price for the first symbol.
        await centralizedOracle.pushPrice(firstSymbolBytes, firstTime, firstPrice);

        // Price should now be available.
        getPriceResult = await centralizedOracle.getPrice.call(firstSymbolBytes, firstTime);
        await centralizedOracle.getPrice(firstSymbolBytes, firstTime);
        assert.equal(getPriceResult.timeForPrice, firstTime);
        assert.equal(getPriceResult.price, firstPrice);

        // No pending queries.
        pendingQueries = await centralizedOracle.getPendingQueries();
        assert.equal(pendingQueries.length, 0);
    });

    it("Non owner", async function() {
        const symbolBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Owned"));

        let blah = await centralizedOracle.getPrice.call(symbolBytes, 10);
        await centralizedOracle.getPrice(symbolBytes, 10);

        // Non-owners can't push prices.
        assert(
            await didContractThrow(centralizedOracle.pushPrice(symbolBytes, 10, 10, { from: rando }))
        );
    });

    it("Push unqueried price", async function() {
        const symbolBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Unqueried"));

        // Can't push a price that isn't queried yet.
        assert(
            await didContractThrow(centralizedOracle.pushPrice(symbolBytes, 10, 10))
        );
    });
});
