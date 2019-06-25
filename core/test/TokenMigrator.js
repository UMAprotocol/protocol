const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const TokenMigrator = artifacts.require("TokenMigrator");
const VotingToken = artifacts.require("VotingToken");

contract("TokenMigrator", function(accounts) {
  // Corresponds to VotingToken.Roles enum.
  const minterRoleEnumValue = 1;
  const burnerRoleEnumValue = 2;

  let tokenMigrator;

  const owner = accounts[0];
  const tokenHolder1 = accounts[1];
  const tokenHolder2 = accounts[2];

  let oldToken;
  let newToken;

  beforeEach(async function() {
    oldToken = await VotingToken.new({ from: owner });
    newToken = await VotingToken.new({ from: owner });
    await oldToken.addMember(minterRoleEnumValue, owner, { from: owner });
  });

  const createMigrator = async (rate) => {
    const migrator = await TokenMigrator.new({ value: rate }, oldToken.address, newToken.address);
    await newToken.addMember(minterRoleEnumValue, migrator.address, { from: owner });
    return migrator;
  }

  it("Snapshot Timing", async function() {
    // Mint tokenHolder1 a single old token to start.
    await oldToken.mint(tokenHolder1, web3.utils.toWei("1", "ether"), { from: owner });

    // Creation of the migrator should trigger a migration balance snapshot.
    const migrator = await createMigrator(web3.utils.toWei("1", "ether"));

    // tokenHolder1 transfers all tokens to tokenHolder2 *after* the snapshot.
    await oldToken.transfer(tokenHolder2, web3.utils.toWei("1", "ether"), { from: tokenHolder1 });

    // Migrate both token holders.
    await migrator.migrateTokens(tokenHolder1);
    await migrator.migrateTokens(tokenHolder2);

    // Only tokenHolder1 should only have been minted tokens.
    assert.equal((await newToken.balanceOf(tokenHolder1)).toString(), web3.utils.toWei("1", "ether"));
    assert.equal((await newToken.balanceOf(tokenHolder2)).toString(), "0");
  });

  it("Modified Rate", async function() {
    // Mint tokenHolder1 a single old token to start.
    await oldToken.mint(tokenHolder1, web3.utils.toWei("1", "ether"), { from: owner });

    // Use a rate of 2, which means that it takes 2 old tokens to produce a single new token.
    const migrator = await createMigrator(web3.utils.toWei("2", "ether"));

    // Migrate.
    await migrator.migrateTokens(tokenHolder1);

    // tokenHolder1 should only have half of one token since the rate was set to 2.
    assert.equal((await newToken.balanceOf(tokenHolder1)).toString(), web3.utils.toWei("0.5", "ether"));
  });

  it("Repeated Migration", async function() {
    // Mint tokenHolder1 a single old token to start.
    await oldToken.mint(tokenHolder1, web3.utils.toWei("1", "ether"), { from: owner });

    // Use a rate of 2, which means that it takes 2 old tokens to produce a single new token.
    const migrator = await createMigrator(web3.utils.toWei("1", "ether"));

    // Migrate.
    await migrator.migrateTokens(tokenHolder1);

    // Second migration should revert.
    assert(await didContractThrow(migrator.migrateTokens(tokenHolder1)));

    // tokenHolder1 should only have 1 new token despite trying migration twice.
    assert.equal((await newToken.balanceOf(tokenHolder1)).toString(), web3.utils.toWei("1", "ether"));
  });
});