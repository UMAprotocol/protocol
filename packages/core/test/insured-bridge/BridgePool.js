const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");

describe("BridgePool", () => {
  //   let accounts, owner, rando;

  before(async function () {
    // accounts = await web3.eth.getAccounts();
    // [owner, rando] = accounts;
    await runDefaultFixture(hre);
  });
});
