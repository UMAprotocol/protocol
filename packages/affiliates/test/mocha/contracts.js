const assert = require("assert");
const Contracts = require("../../libs/contracts");
const Web3 = require("web3");
const web3 = new Web3();

const { toWei } = web3.utils;

describe("Contracts", function () {
  describe("calculateValue", function () {
    it("should calculate value in usd", function () {
      const decimals = 18;
      const amount = toWei("1").toString();
      const price = 2345.42;
      const result = Contracts.calculateValue(amount, price, decimals);
      assert.equal(toWei(price.toString()), result.toString());
    });
  });
});
