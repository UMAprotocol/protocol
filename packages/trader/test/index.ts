import { run } from "../src/index";
import { web3, assert } from "hardhat";

describe("index.js", function() {
  let accounts: string[];

  before(async function() {
    accounts = await web3.eth.getAccounts();
  });

  it("Runs with no errors", async function() {
    const originalEnv = process.env;
    process.env.EMP_ADDRESS = web3.utils.randomHex(20);

    // Nonsensical check just to use assert.
    assert.isAbove(accounts.length, 0);

    // Must not throw.
    await run();

    process.env = originalEnv;
  });
});
