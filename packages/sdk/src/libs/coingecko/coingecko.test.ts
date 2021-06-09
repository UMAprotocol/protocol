import assert from "assert";
import Coingecko from ".";

// this requires e2e testing, should only test manually for now
describe.skip("coingecko", function () {
  let cg: Coingecko;
  test("init", function () {
    cg = new Coingecko();
    assert.ok(cg);
  });
  test("getContractDetails", async function () {
    const address = "0x04fa0d235c4abf4bcf4787af4cf447de572ef828";
    const result = await cg.getContractDetails(address);
    assert.ok(result);
  });
  test("getCurrentPriceByContract", async function () {
    const address = "0x04fa0d235c4abf4bcf4787af4cf447de572ef828";
    const result = await cg.getCurrentPriceByContract(address);
    assert.ok(result);
    assert.equal(result.length, 2);
  });
});
