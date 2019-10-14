const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const DesignatedVoting = artifacts.require("DesignatedVoting");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const { RegistryRolesEnum } = require("../../common/Enums.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../common/Random.js");
const { moveToNextRound, moveToNextPhase } = require("../utils/Voting.js");

contract("DesignatedVoting", function(accounts) {
  const umaAdmin = accounts[0];
  const tokenOwner = accounts[1];
  const voter = accounts[2];
  const registeredDerivative = accounts[3];

  let voting;
  let votingToken;
  let designatedVoting;

  let tokenBalance;

  // Corresponds to DesignatedVoting.Roles.Voter.
  const voterRole = "2";

  before(async function() {
    voting = await Voting.deployed();
    votingToken = await VotingToken.deployed();
    const finder = await Finder.deployed();
    designatedVoting = await DesignatedVoting.new(finder.address, { from: tokenOwner });
    await designatedVoting.resetMember(voterRole, voter, { from: tokenOwner });

    tokenBalance = web3.utils.toWei("1");
    // The admin can burn and mint tokens for the purposes of this test.
    await votingToken.addMember("1", umaAdmin);
    await votingToken.addMember("2", umaAdmin);
    await votingToken.mint(tokenOwner, tokenBalance, { from: umaAdmin });

    const registry = await Registry.deployed();
    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, umaAdmin);
    await registry.registerDerivative([], registeredDerivative, { from: umaAdmin });
  });

  it("Deposit and withdraw", async function() {
    assert.equal(await votingToken.balanceOf(tokenOwner), tokenBalance);
    assert.equal(await votingToken.balanceOf(designatedVoting.address), web3.utils.toWei("0"));

    // The owner can transfer tokens into DesignatedVoting.
    await votingToken.transfer(designatedVoting.address, tokenBalance, { from: tokenOwner });
    assert.equal(await votingToken.balanceOf(tokenOwner), web3.utils.toWei("0"));
    assert.equal(await votingToken.balanceOf(designatedVoting.address), tokenBalance);

    // Neither the designated voter nor the UMA admin can withdraw tokens.
    assert(await didContractThrow(designatedVoting.withdrawErc20(votingToken.address, tokenBalance, { from: voter })));
    assert(
      await didContractThrow(designatedVoting.withdrawErc20(votingToken.address, tokenBalance, { from: umaAdmin }))
    );

    // `tokenOwner` can withdraw tokens.
    await designatedVoting.withdrawErc20(votingToken.address, tokenBalance, { from: tokenOwner });
    assert.equal(await votingToken.balanceOf(tokenOwner), tokenBalance);
    assert.equal(await votingToken.balanceOf(designatedVoting.address), web3.utils.toWei("0"));
  });

  it("Reverts passed through", async function() {
    // Verify that there are no silent failures, and reverts get bubbled up.
    assert(
      await didContractThrow(designatedVoting.commitVote(web3.utils.utf8ToHex("bad"), "100", "0x0", { from: voter }))
    );
    assert(
      await didContractThrow(
        designatedVoting.revealVote(web3.utils.utf8ToHex("bad"), "100", "200", "300", { from: voter })
      )
    );
  });

  it("Commit, reveal and retrieve", async function() {
    await votingToken.transfer(designatedVoting.address, tokenBalance, { from: tokenOwner });

    // Set inflation to 50% to test reward retrieval.
    const inflationRate = web3.utils.toWei("0.5");
    await voting.setInflationRate({ rawValue: inflationRate });

    // Request a price.
    const identifier = web3.utils.utf8ToHex("one-voter");
    const time = "1000";
    await voting.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time, { from: registeredDerivative });
    await moveToNextRound(voting);

    const price = getRandomSignedInt();
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);

    // Only the voter can commit a vote.
    await designatedVoting.commitVote(identifier, time, hash, { from: voter });
    assert(await didContractThrow(designatedVoting.commitVote(identifier, time, hash, { from: tokenOwner })));
    assert(await didContractThrow(designatedVoting.commitVote(identifier, time, hash, { from: umaAdmin })));

    // The UMA admin can't add new voters.
    assert(await didContractThrow(designatedVoting.resetMember(voterRole, umaAdmin, { from: umaAdmin })));

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Only the voter can reveal a vote.
    await designatedVoting.revealVote(identifier, time, price, salt, { from: voter });
    assert(await didContractThrow(designatedVoting.revealVote(identifier, time, price, salt, { from: tokenOwner })));
    assert(await didContractThrow(designatedVoting.revealVote(identifier, time, price, salt, { from: umaAdmin })));

    // Check the resolved price.
    await moveToNextRound(voting);
    assert.equal((await voting.getPrice(identifier, time, { from: registeredDerivative })).toString(), price);

    // Retrieve rewards and check that rewards accrued to the `designatedVoting` contract.
    await designatedVoting.retrieveRewards({ from: voter });
    assert(await didContractThrow(designatedVoting.retrieveRewards({ from: tokenOwner })));
    assert(await didContractThrow(designatedVoting.retrieveRewards({ from: umaAdmin })));

    // Expected inflation = token balance * inflation rate = 1 * 0.5
    const expectedInflation = web3.utils.toWei("0.5");
    const expectedNewBalance = web3.utils.toBN(tokenBalance).add(web3.utils.toBN(expectedInflation));
    assert.equal(await votingToken.balanceOf(tokenOwner), web3.utils.toWei("0"));
    assert.equal(await votingToken.balanceOf(designatedVoting.address), expectedNewBalance.toString());

    // Reset the state.
    await voting.setInflationRate({ rawValue: web3.utils.toWei("0") });
    await designatedVoting.withdrawErc20(votingToken.address, expectedNewBalance, { from: tokenOwner });
    // Throw away the reward tokens to avoid interacting with other test cases.
    await votingToken.transfer(umaAdmin, expectedInflation, { from: tokenOwner });
    await votingToken.burn(expectedInflation, { from: umaAdmin });
  });
});
