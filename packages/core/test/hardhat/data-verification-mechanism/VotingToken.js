const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const VotingToken = getContract("VotingToken");

describe("VotingToken", function () {
  let accounts;
  let governance;
  let votingContractAddress;
  let voter;
  let buybackUser;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [governance, votingContractAddress, voter, buybackUser] = accounts;
    await runDefaultFixture(hre);
  });

  // Corresponds to VotingToken.Roles enum.
  const minterRoleEnumValue = 1;
  const burnerRoleEnumValue = 2;

  const { toBN, toWei } = web3.utils;

  it("Minting/Burning", async function () {
    const votingToken = await VotingToken.deployed();

    const initialTokenSupply = toWei("100000000");

    // Should start with 100MM tokens granted to the governance address.
    assert.equal(await votingToken.methods.totalSupply().call(), initialTokenSupply);
    assert.equal(await votingToken.methods.balanceOf(governance).call(), initialTokenSupply);
    assert.equal(await votingToken.methods.balanceOf(voter).call(), "0");

    // Contracts can't authorize themselves to mint tokens.
    assert(
      await didContractThrow(
        votingToken.methods.resetMember(1, votingContractAddress).send({ from: votingContractAddress })
      )
    );
    // Set minter. In prod, this will be the address of the voting contract.
    await votingToken.methods.addMember(minterRoleEnumValue, votingContractAddress).send({ from: governance });
    // Set burner.
    await votingToken.methods.addMember(burnerRoleEnumValue, buybackUser).send({ from: governance });

    const numTokens = toWei("100");
    // Voters can't mint themselves new tokens.
    assert(await didContractThrow(votingToken.methods.mint(voter, numTokens).send({ from: voter })));
    // The voting contract can mint new tokens to a voter.
    await votingToken.methods.mint(voter, numTokens).send({ from: votingContractAddress });

    // Verify updated balances.
    assert.equal(
      await votingToken.methods.totalSupply().call(),
      toBN(numTokens).add(toBN(initialTokenSupply)).toString()
    );
    assert.equal(await votingToken.methods.balanceOf(voter).call(), numTokens);

    const tokensToBurn = toWei("25");
    const tokensLeft = toBN(numTokens).sub(toBN(tokensToBurn)).toString();
    // Voters can't burn their own tokens.
    assert(await didContractThrow(votingToken.methods.burn(tokensToBurn).send({ from: voter })));
    // Can't burn tokens if you don't own any, not even the governance role.
    assert(await didContractThrow(votingToken.methods.burn(tokensToBurn).send({ from: governance })));

    // Transfer to the buyback user.
    await votingToken.methods.transfer(buybackUser, tokensToBurn).send({ from: voter });
    assert.equal(await votingToken.methods.balanceOf(voter).call(), tokensLeft);
    assert.equal(await votingToken.methods.balanceOf(buybackUser).call(), tokensToBurn);

    // Buyback user can burn tokens.
    await votingToken.methods.burn(tokensToBurn).send({ from: buybackUser });

    // Check updated balances.
    assert.equal(
      await votingToken.methods.totalSupply().call(),
      toBN(tokensLeft).add(toBN(initialTokenSupply)).toString()
    );
    assert.equal(await votingToken.methods.balanceOf(buybackUser).call(), "0");
  });
});
