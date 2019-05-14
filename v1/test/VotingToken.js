const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const VotingToken = artifacts.require("VotingToken");

contract("VotingToken", function(accounts) {
  const governance = accounts[0];
  const votingContractAddress = accounts[1];
  const voter = accounts[2];
  const buybackUser = accounts[3];

  // Corresponds to VotingToken.Roles enum.
  const minterRoleEnumValue = 1;
  const burnerRoleEnumValue = 2;

  it("Minting/Burning", async function() {
    const votingToken = await VotingToken.deployed();

    assert.equal(await votingToken.totalSupply(), "0");
    assert.equal(await votingToken.balanceOf(voter), "0");

    // Contracts can't authorize themselves to mint tokens.
    assert(await didContractThrow(votingToken.resetMember(1, votingContractAddress, { from: votingContractAddress })));
    // Set minter. In prod, this will be the address of the voting contract.
    await votingToken.addMember(minterRoleEnumValue, votingContractAddress, { from: governance });
    // Set burner.
    await votingToken.addMember(burnerRoleEnumValue, buybackUser, { from: governance });

    const numTokens = web3.utils.toWei("100");
    // Voters can't mint themselves new tokens.
    assert(await didContractThrow(votingToken.mint(voter, numTokens, { from: voter })));
    // The voting contract can mint new tokens to a voter.
    await votingToken.mint(voter, numTokens, { from: votingContractAddress });

    // Verify updated balances.
    assert.equal(await votingToken.totalSupply(), numTokens);
    assert.equal(await votingToken.balanceOf(voter), numTokens);

    const tokensToBurn = web3.utils.toWei("25");
    const tokensLeft = web3.utils
      .toBN(numTokens)
      .sub(web3.utils.toBN(tokensToBurn))
      .toString();
    // Voters can't burn their own tokens.
    assert(await didContractThrow(votingToken.burn(tokensToBurn, { from: voter })));
    // Can't burn tokens if you don't own any, not even the governance role.
    assert(await didContractThrow(votingToken.burn(tokensToBurn, { from: governance })));

    // Transfer to the buyback user.
    await votingToken.transfer(buybackUser, tokensToBurn, { from: voter });
    assert.equal(await votingToken.balanceOf(voter), tokensLeft);
    assert.equal(await votingToken.balanceOf(buybackUser), tokensToBurn);

    // Buyback user can burn tokens.
    await votingToken.burn(tokensToBurn, { from: buybackUser });

    // Check updated balances.
    assert.equal(await votingToken.totalSupply(), tokensLeft);
    assert.equal(await votingToken.balanceOf(buybackUser), "0");
  });
});
