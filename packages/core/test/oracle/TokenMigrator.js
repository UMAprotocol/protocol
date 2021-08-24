const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const TokenMigrator = getContract("TokenMigrator");
const VotingToken = getContract("VotingToken");

describe("TokenMigrator", function () {
  // Corresponds to VotingToken.Roles enum.
  const minterRoleEnumValue = 1;

  let accounts;
  let owner;
  let tokenHolder1;
  let tokenHolder2;

  let oldToken;
  let newToken;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, tokenHolder1, tokenHolder2] = accounts;
    await runDefaultFixture(hre);
  });

  beforeEach(async function () {
    oldToken = await VotingToken.new().send({ from: owner });
    newToken = await VotingToken.new().send({ from: owner });
    await oldToken.methods.addMember(minterRoleEnumValue, owner).send({ from: owner });
  });

  const createMigrator = async (rate) => {
    const migrator = await TokenMigrator.new(
      { rawValue: rate },
      oldToken.options.address,
      newToken.options.address
    ).send({ from: accounts[0] });
    await newToken.methods.addMember(minterRoleEnumValue, migrator.options.address).send({ from: owner });
    return migrator;
  };

  it("Can't set migration rate to 0", async function () {
    assert(await didContractThrow(createMigrator("0")));
  });

  it("Snapshot Timing", async function () {
    // Mint tokenHolder1 a single old token to start.
    await oldToken.methods.mint(tokenHolder1, web3.utils.toWei("1", "ether")).send({ from: owner });

    // Creation of the migrator should trigger a migration balance snapshot.
    const migrator = await createMigrator(web3.utils.toWei("1", "ether"));

    // tokenHolder1 transfers all tokens to tokenHolder2 *after* the snapshot.
    await oldToken.methods.transfer(tokenHolder2, web3.utils.toWei("1", "ether")).send({ from: tokenHolder1 });

    // Migrate both token holders.
    await migrator.methods.migrateTokens(tokenHolder1).send({ from: accounts[0] });
    await migrator.methods.migrateTokens(tokenHolder2).send({ from: accounts[0] });

    // Only tokenHolder1 should only have been minted tokens.
    assert.equal((await newToken.methods.balanceOf(tokenHolder1).call()).toString(), web3.utils.toWei("1", "ether"));
    assert.equal((await newToken.methods.balanceOf(tokenHolder2).call()).toString(), "0");
  });

  it("Modified Rate", async function () {
    // Mint tokenHolder1 a single old token to start.
    await oldToken.methods.mint(tokenHolder1, web3.utils.toWei("1", "ether")).send({ from: owner });

    // Use a rate of 2, which means that it takes 2 old tokens to produce a single new token.
    const migrator = await createMigrator(web3.utils.toWei("2", "ether"));

    // Migrate.
    await migrator.methods.migrateTokens(tokenHolder1).send({ from: accounts[0] });

    // tokenHolder1 should only have half of one token since the rate was set to 2.
    assert.equal((await newToken.methods.balanceOf(tokenHolder1).call()).toString(), web3.utils.toWei("0.5", "ether"));
  });

  it("Migration rate creates new token amount with repeating decimals, least significant decimal gets floor'd", async function () {
    // Case 1:
    // - Token-Holder-1 has 1 old token
    // - Migration rate = (3 new token : 1 new token)
    // - Token-Holder-2 should have 0.3333....33 new tokens since 0.33-repeating can't be represented by FixedPoint and gets floor'd
    await oldToken.methods.mint(tokenHolder1, web3.utils.toWei("1", "ether")).send({ from: owner });
    const migrator = await createMigrator(web3.utils.toWei("3", "ether"));
    await migrator.methods.migrateTokens(tokenHolder1).send({ from: accounts[0] });
    assert.equal((await newToken.methods.balanceOf(tokenHolder1).call()).toString(), "3".repeat(18));
  });

  it("Migration rate causes really small token holders to get floor'd", async function () {
    // Case 2:
    // - Token-Holder-1 has 1 wei old token
    // - Migration rate = (2 new token: 1 new token)
    // - Token-Holder-2 should have 0 new tokens since <1 wei can't be represented by FixedPoint and gets floor'd
    await oldToken.methods.mint(tokenHolder1, "1").send({ from: owner });
    const migrator = await createMigrator(web3.utils.toWei("2", "ether"));
    await migrator.methods.migrateTokens(tokenHolder1).send({ from: accounts[0] });
    assert.equal((await newToken.methods.balanceOf(tokenHolder1).call()).toString(), "0");
  });

  it("Repeated Migration", async function () {
    // Mint tokenHolder1 a single old token to start.
    await oldToken.methods.mint(tokenHolder1, web3.utils.toWei("1", "ether")).send({ from: owner });

    // Use a rate of 2, which means that it takes 2 old tokens to produce a single new token.
    const migrator = await createMigrator(web3.utils.toWei("1", "ether"));

    // Migrate.
    await migrator.methods.migrateTokens(tokenHolder1).send({ from: accounts[0] });

    // Second migration should revert.
    assert(await didContractThrow(migrator.methods.migrateTokens(tokenHolder1).send({ from: accounts[0] })));

    // tokenHolder1 should only have 1 new token despite trying migration twice.
    assert.equal((await newToken.methods.balanceOf(tokenHolder1).call()).toString(), web3.utils.toWei("1", "ether"));
  });
});
