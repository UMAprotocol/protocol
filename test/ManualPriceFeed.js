const { didContractThrow } = require("./utils/DidContractThrow.js");

const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const BigNumber = require("bignumber.js");

contract("ManualPriceFeed", function(accounts) {

    // A deployed instance of the ManualPriceFeed contract, ready for testing.
    let manualPriceFeed;

    let owner = accounts[0];
    let rando = accounts[1];

    before(async function() {
        manualPriceFeed = await ManualPriceFeed.deployed();
    });

    it("No prices > One price > Updated price", async function() {
        const productBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("product"));

        // No prices have been published, so the product is not yet supported.
        let supported = await manualPriceFeed.isProductSupported(productBytes);
        assert.equal(supported, false);

        // No prices have been published, so latest `publishTime` is 0.
        assert(
            await didContractThrow(manualPriceFeed.latestPrice(productBytes)));

        // Push a price at time=100, and the product should now be supported.
        await manualPriceFeed.pushLatestPrice(productBytes, 100, 500);
        supported = await manualPriceFeed.isProductSupported(productBytes);
        assert.equal(supported, true);

        // `latestPrice` should retrieve the price at time=100.
        actualPriceTick = await manualPriceFeed.latestPrice(productBytes);
        assert.equal(actualPriceTick.publishTime, 100);
        assert.equal(actualPriceTick.price, 500);

        // Push an updated price at time=200.
        await manualPriceFeed.pushLatestPrice(productBytes, 200, 1000);

        // `latestPrice` should retrieve the price at time=200.
        actualPriceTick = await manualPriceFeed.latestPrice(productBytes);
        assert.equal(actualPriceTick.publishTime, 200);
        assert.equal(actualPriceTick.price, 1000);
    });

    it("Multiple products", async function() {
        const firstProductBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("First"));
        const secondProductBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Second"));
        const absentProductBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Absent"));

        // Verify that all products start off unsupported.
        let firstProductSupported = await manualPriceFeed.isProductSupported(firstProductBytes);
        let secondProductSupported = await manualPriceFeed.isProductSupported(secondProductBytes);
        let absentProductSupported = await manualPriceFeed.isProductSupported(absentProductBytes);
        assert.equal(firstProductSupported, false);
        assert.equal(secondProductSupported, false);
        assert.equal(absentProductSupported, false);

        // And all latestPrice calls revert because these products are not supported.
        assert(
            await didContractThrow(manualPriceFeed.latestPrice(firstProductBytes)));
        assert(
            await didContractThrow(manualPriceFeed.latestPrice(secondProductBytes)));
        assert(
            await didContractThrow(manualPriceFeed.latestPrice(absentProductBytes)));

        // Push a price for the first product.
        await manualPriceFeed.pushLatestPrice(firstProductBytes, 100, 500);

        // Prices exist only for the first product.
        let firstProductPriceTick = await manualPriceFeed.latestPrice(firstProductBytes);
        assert.equal(firstProductPriceTick.publishTime, 100);
        assert.equal(firstProductPriceTick.price, 500);
        secondProductSupported = await manualPriceFeed.isProductSupported(secondProductBytes);
        absentProductSupported = await manualPriceFeed.isProductSupported(absentProductBytes);
        assert.equal(secondProductSupported, false);
        assert.equal(absentProductSupported, false);

        // Push a price for the second product.
        await manualPriceFeed.pushLatestPrice(secondProductBytes, 200, 1000);

        // Distinct prices exist for the two products, but the absentProduct is still unsupported.
        firstProductPriceTick = await manualPriceFeed.latestPrice(firstProductBytes);
        let secondProductPriceTick = await manualPriceFeed.latestPrice(secondProductBytes);
        assert.equal(firstProductPriceTick.publishTime, 100);
        assert.equal(firstProductPriceTick.price, 500);
        assert.equal(secondProductPriceTick.publishTime, 200);
        assert.equal(secondProductPriceTick.price, 1000);
        absentProductSupported = await manualPriceFeed.isProductSupported(absentProductBytes);
        assert.equal(absentProductSupported, false);
    });

    it("Non owner", async function() {
        const productBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Owned"));

        // Verify that the product is not supported yet.
        let supported = await manualPriceFeed.isProductSupported(productBytes, { from: rando });
        assert.equal(supported, false);

        // Non-owners can't push prices.
        assert(
            await didContractThrow(manualPriceFeed.pushLatestPrice(productBytes, 100, 500, { from: rando }))
        );

        await manualPriceFeed.pushLatestPrice(productBytes, 100, 500, { from: owner })

        // Verify that non-owners can still query prices.
        let priceTick = await manualPriceFeed.latestPrice(productBytes, { from: rando });
        assert.equal(priceTick.publishTime, 100);
        assert.equal(priceTick.price, 500);
    });

    it("Push non-consecutive prices", async function() {
        const productBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Non-consecutive"));

        // Push an initial price.
        await manualPriceFeed.pushLatestPrice(productBytes, 100, 500);
        // Verify that a price earlier than the latest can't be pushed.
        assert(
            await didContractThrow(manualPriceFeed.pushLatestPrice(productBytes, 50, 500))
        );
    });

    it("Push a future price", async function() {
        const productBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Future-price"));

        const tolerance = 900;
        const currentTime = 1000;
        await manualPriceFeed.setCurrentTime(currentTime);

        // Verify that a price later than the current time + tolerance can't be pushed.
        assert(
            await didContractThrow(manualPriceFeed.pushLatestPrice(productBytes, currentTime + tolerance + 1, 500))
        );

        // Verify that prices can be pushed within the tolerance.
        await manualPriceFeed.pushLatestPrice(productBytes, currentTime + tolerance, 500);
        let priceTick = await manualPriceFeed.latestPrice(productBytes);
        assert.equal(priceTick.publishTime, currentTime + tolerance);
        assert.equal(priceTick.price, 500);
    });
});
