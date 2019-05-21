const ManualPublishPriceFeed = require("../../scripts/ManualPublishPriceFeed");

const ManualPriceFeed = artifacts.require("ManualPriceFeed");

contract("scripts/ManualPublishPriceFeed.js", function(accounts) {
  let priceFeed;
  let identifier;
  let time;
  let price;
  const account = accounts[0];

  before(async function() {
    priceFeed = await ManualPriceFeed.deployed();
    identifier = "TEST";
  });

  it("Pushes a price", async function() {
    price = "1.1";
    time = 1548997200; // January 1st, 2019
    priceFeed.setCurrentTime(time); // Set the current time to what we will update to.
    await ManualPublishPriceFeed.run(account, identifier, price, time);

    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(identifier));
    const { publishTime, price: publishPrice } = await priceFeed.latestPrice(identifierBytes);

    assert.strictEqual(time, publishTime.toNumber());
    assert.ok(web3.utils.toBN(web3.utils.toWei(price)).eq(publishPrice));
  });
});
