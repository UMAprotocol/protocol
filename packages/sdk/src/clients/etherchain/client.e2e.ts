import assert from "assert";
import { Etherchain } from ".";

describe("etherchain", () => {
  let etherchain: Etherchain;

  test("init", () => {
    etherchain = new Etherchain();
    assert.ok(etherchain);
  });

  test("oracle gas price", async () => {
    const gasPrice = await etherchain.getGasPrice();
    assert.strictEqual(typeof gasPrice.currentBaseFee === "number", true);
  });
});
