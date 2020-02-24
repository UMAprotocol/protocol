const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const DesignatedVoting = artifacts.require("DesignatedVoting");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const VotingToken = artifacts.require("VotingToken");
const { RegistryRolesEnum } = require("../../../common/Enums.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../../common/Random.js");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { computeTopicHash, getKeyGenMessage } = require("../../../common/EncryptionHelper.js");

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
  const voterRole = "1";

  before(async function() {
    voting = await Voting.deployed();
    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    const finder = await Finder.deployed();
    designatedVoting = await DesignatedVoting.new(finder.address, tokenOwner, voter);

    tokenBalance = web3.utils.toWei("100000000");
    // The admin can burn tokens for the purposes of this test.
    await votingToken.addBurner(umaAdmin);
    await votingToken.transfer(tokenOwner, tokenBalance, { from: umaAdmin });

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
    await supportedIdentifiers.addSupportedIdentifier(identifier);
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
    const roundId = await voting.getCurrentRoundId();
    await moveToNextRound(voting);
    assert.equal((await voting.getPrice(identifier, time, { from: registeredDerivative })).toString(), price);

    // Retrieve rewards and check that rewards accrued to the `designatedVoting` contract.
    await designatedVoting.retrieveRewards(roundId, [{ identifier, time }], { from: voter });
    assert(
      await didContractThrow(designatedVoting.retrieveRewards(roundId, [{ identifier, time }], { from: tokenOwner }))
    );
    assert(
      await didContractThrow(designatedVoting.retrieveRewards(roundId, [{ identifier, time }], { from: umaAdmin }))
    );

    // Expected inflation = token balance * inflation rate = 1 * 0.5
    const expectedInflation = web3.utils.toWei("50000000");
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

  it("Batch commit and reveal", async function() {
    await votingToken.transfer(designatedVoting.address, tokenBalance, { from: tokenOwner });

    // Request a price.
    const identifier = web3.utils.utf8ToHex("batch");
    const time1 = "1000";
    const time2 = "2000";
    await supportedIdentifiers.addSupportedIdentifier(identifier);
    await voting.requestPrice(identifier, time1, { from: registeredDerivative });
    await voting.requestPrice(identifier, time2, { from: registeredDerivative });
    await moveToNextRound(voting);

    const roundId = await voting.getCurrentRoundId();

    const price1 = getRandomSignedInt();
    const salt1 = getRandomUnsignedInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);
    const message1 = web3.utils.randomHex(4);

    const price2 = getRandomSignedInt();
    const salt2 = getRandomUnsignedInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);
    const message2 = web3.utils.randomHex(4);

    // Batch commit.
    const commits = [
      { identifier, time: time1, hash: hash1, encryptedVote: message1 },
      { identifier, time: time2, hash: hash2, encryptedVote: message2 }
    ];
    assert(await didContractThrow(designatedVoting.batchCommit(commits, { from: tokenOwner })));
    await designatedVoting.batchCommit(commits, { from: voter });

    // Move to the reveal phase.
    await moveToNextPhase(voting);

    // Check message retrieval.
    assert.equal(
      await voting.getMessage(designatedVoting.address, computeTopicHash({ identifier, time: time1 }, roundId)),
      message1
    );
    assert.equal(
      await voting.getMessage(designatedVoting.address, computeTopicHash({ identifier, time: time2 }, roundId)),
      message2
    );

    // Batch reveal.
    const reveals = [
      { identifier, time: time1, price: price1.toString(), salt: salt1.toString() },
      { identifier, time: time2, price: price2.toString(), salt: salt2.toString() }
    ];
    assert(await didContractThrow(designatedVoting.batchReveal(reveals, { from: tokenOwner })));
    await designatedVoting.batchReveal(reveals, { from: voter });

    // Check the resolved price.
    await moveToNextRound(voting);
    assert.equal((await voting.getPrice(identifier, time1, { from: registeredDerivative })).toString(), price1);
    assert.equal((await voting.getPrice(identifier, time2, { from: registeredDerivative })).toString(), price2);

    // Reset the state.
    await designatedVoting.withdrawErc20(votingToken.address, tokenBalance, { from: tokenOwner });
  });
});
