const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const TokenMigrator = artifacts.require("TokenMigrator");
const VotingToken = artifacts.require("VotingToken");

contract("TokenMigrator", function(accounts) {
  // Corresponds to VotingToken.Roles enum.
  const minterRoleEnumValue = 1;

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

  const createMigrator = async rate => {
    const migrator = await TokenMigrator.new({ rawValue: rate }, oldToken.address, newToken.address);
    await newToken.addMember(minterRoleEnumValue, migrator.address, { from: owner });
    return migrator;
  };

  it("Can't set migration rate to 0", async function() {
    assert(await didContractThrow(createMigrator("0")));
  });

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

  it("Migration rate creates new token amount with repeating decimals, least significant decimal gets floor'd", async function() {
    // Case 1:
    // - Token-Holder-1 has 1 old token
    // - Migration rate = (3 new token : 1 new token)
    // - Token-Holder-2 should have 0.3333....33 new tokens since 0.33-repeating can't be represented by FixedPoint and gets floor'd
    await oldToken.mint(tokenHolder1, web3.utils.toWei("1", "ether"), { from: owner });
    const migrator = await createMigrator(web3.utils.toWei("3", "ether"));
    await migrator.migrateTokens(tokenHolder1);
    assert.equal((await newToken.balanceOf(tokenHolder1)).toString(), "3".repeat(18));
  });

  it("Migration rate causes really small token holders to get floor'd", async function() {
    // Case 2:
    // - Token-Holder-1 has 1 wei old token
    // - Migration rate = (2 new token: 1 new token)
    // - Token-Holder-2 should have 0 new tokens since <1 wei can't be represented by FixedPoint and gets floor'd
    await oldToken.mint(tokenHolder1, "1", { from: owner });
    const migrator = await createMigrator(web3.utils.toWei("2", "ether"));
    await migrator.migrateTokens(tokenHolder1);
    assert.equal((await newToken.balanceOf(tokenHolder1)).toString(), "0");
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
