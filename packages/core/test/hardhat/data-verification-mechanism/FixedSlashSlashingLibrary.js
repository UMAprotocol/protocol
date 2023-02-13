const { assert } = require("chai");
const hre = require("hardhat");
const { didContractRevertWith } = require("@uma/common");

const { getContract, web3 } = hre;
const { toWei } = web3.utils;

const SlashingLibrary = getContract("FixedSlashSlashingLibrary");

const baseSlashAmount = toWei("0.0016");
const governanceSlashAmount = toWei("0");

describe("FixedSlashSlashingLibrary", function () {
  let accounts, owner;
  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [owner] = accounts;
  });
  it("Validate baseSlashAmount", async function () {
    const invalidBaseSlashAmount = toWei("1");
    assert(
      await didContractRevertWith(
        SlashingLibrary.new(invalidBaseSlashAmount, governanceSlashAmount).send({ from: owner }),
        "Invalid base slash amount"
      )
    );
  });
  it("Validate governanceSlashAmount", async function () {
    const invalidGovernanceSlashAmount = toWei("1");
    assert(
      await didContractRevertWith(
        SlashingLibrary.new(baseSlashAmount, invalidGovernanceSlashAmount).send({ from: owner }),
        "Invalid governance slash amount"
      )
    );
  });
});
