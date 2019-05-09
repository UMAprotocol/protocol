const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const VotingToken = artifacts.require("VotingToken");

contract("VotingToken", function(accounts) {
  const governance = accounts[0];
  const votingContractAddress = accounts[1];
  const voter = accounts[2];

  // Corresponds to VotingToken.Roles.Minter;
  const minterRoleEnumValue = 1;

  it("Minting", async function() {
    const votingToken = await VotingToken.deployed();

    assert.equal(await votingToken.totalSupply(), "0");
    assert.equal(await votingToken.balanceOf(voter), "0");

    // Contracts can't authorize themselves to mint tokens.
    assert(await didContractThrow(votingToken.resetMember(1, votingContractAddress, { from: votingContractAddress })));
    // Set minter. In prod, this will be the address of the voting contract.
    await votingToken.resetMember(minterRoleEnumValue, votingContractAddress, { from: governance });

    const numTokens = web3.utils.toWei("100");
    // Voters can't mint themselves new tokens.
    assert(await didContractThrow(votingToken.mint(voter, numTokens, { from: voter })));
    // The voting contract can mint new tokens to a voter.
    await votingToken.mint(voter, numTokens, { from: votingContractAddress });

    // Verify updated balances.
    assert.equal(await votingToken.totalSupply(), numTokens);
    assert.equal(await votingToken.balanceOf(voter), numTokens);
  });
});
