const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const {
  RegistryRolesEnum,
  didContractThrow,
  getRandomSignedInt,
  computeVoteHashAncillary,
  signMessage,
} = require("@uma/common");
const { assert } = require("chai");

const DesignatedVoting = getContract("DesignatedVoting");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const Voting = getContract("Voting");
const VotingAncillaryInterfaceTesting = getContract("VotingAncillaryInterfaceTesting");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");
const { moveToNextRound, moveToNextPhase } = require("../utils/Voting.js");
const snapshotMessage = "Sign For Snapshot";
const { utf8ToHex, padRight } = web3.utils;

describe("DesignatedVoting", function () {
  let accounts;
  let umaAdmin;
  let tokenOwner;
  let voter;
  let registeredContract;

  let voting;
  let votingToken;
  let designatedVoting;
  let supportedIdentifiers;
  let signature;

  let tokenBalance;

  // Corresponds to DesignatedVoting.Roles.Voter.
  const voterRole = "1";

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [umaAdmin, tokenOwner, voter, registeredContract] = accounts;
    await runDefaultFixture(hre);
    voting = await VotingAncillaryInterfaceTesting.at((await Voting.deployed()).options.address);
    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    const finder = await Finder.deployed();
    designatedVoting = await DesignatedVoting.new(finder.options.address, tokenOwner, voter).send({
      from: accounts[0],
    });

    tokenBalance = web3.utils.toWei("100000000");
    // The admin can burn tokens for the purposes of this test.
    await votingToken.methods.addMember("2", umaAdmin).send({ from: accounts[0] });
    await votingToken.methods.transfer(tokenOwner, tokenBalance).send({ from: umaAdmin });

    const registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, umaAdmin).send({ from: accounts[0] });
    await registry.methods.registerContract([], registeredContract).send({ from: umaAdmin });
    signature = await signMessage(web3, snapshotMessage, umaAdmin);
  });

  it("Deposit and withdraw", async function () {
    assert.equal(await votingToken.methods.balanceOf(tokenOwner).call(), tokenBalance);
    assert.equal(await votingToken.methods.balanceOf(designatedVoting.options.address).call(), web3.utils.toWei("0"));

    // The owner can transfer tokens into DesignatedVoting.
    await votingToken.methods.transfer(designatedVoting.options.address, tokenBalance).send({ from: tokenOwner });
    assert.equal(await votingToken.methods.balanceOf(tokenOwner).call(), web3.utils.toWei("0"));
    assert.equal(await votingToken.methods.balanceOf(designatedVoting.options.address).call(), tokenBalance);

    // Neither the designated voter nor the UMA admin can withdraw tokens.
    assert(
      await didContractThrow(
        designatedVoting.methods.withdrawErc20(votingToken.options.address, tokenBalance).send({ from: voter })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods.withdrawErc20(votingToken.options.address, tokenBalance).send({ from: umaAdmin })
      )
    );

    // `tokenOwner` can withdraw tokens.
    await designatedVoting.methods.withdrawErc20(votingToken.options.address, tokenBalance).send({ from: tokenOwner });
    assert.equal(await votingToken.methods.balanceOf(tokenOwner).call(), tokenBalance);
    assert.equal(await votingToken.methods.balanceOf(designatedVoting.options.address).call(), web3.utils.toWei("0"));
  });

  it("Reverts passed through", async function () {
    // Verify that there are no silent failures, and reverts get bubbled up.
    assert(
      await didContractThrow(
        designatedVoting.methods
          .commitVote(padRight(utf8ToHex("bad"), 64), "100", "0x0", "0x123456")
          .send({ from: voter })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods
          .revealVote(padRight(utf8ToHex("bad"), 64), "100", "200", "0x123456", "300")
          .send({ from: voter })
      )
    );
  });

  it("Commit, reveal and retrieve", async function () {
    await votingToken.methods.transfer(designatedVoting.options.address, tokenBalance).send({ from: tokenOwner });

    // Set inflation to 50% to test reward retrieval.
    const inflationRate = web3.utils.toWei("0.5");
    await voting.methods.setInflationRate({ rawValue: inflationRate }).send({ from: accounts[0] });

    // Request a price.
    const identifier = padRight(utf8ToHex("one-voter"), 64);
    const time = "1000";
    const ancillaryData = "0x123456";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time, ancillaryData).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);
    let roundId = await voting.methods.getCurrentRoundId().call();

    const price = getRandomSignedInt();
    const salt = getRandomSignedInt();
    // Note: the "voter" address for this vote must be the designated voting contract since its the one that will ultimately
    // "reveal" the vote. Only the voter can call reveal through the designated voting contract.
    const hash = computeVoteHashAncillary({
      price,
      salt,
      account: designatedVoting.options.address,
      time,
      ancillaryData: ancillaryData,
      roundId,
      identifier,
    });

    // Only the voter can commit a vote.
    assert(
      await didContractThrow(
        designatedVoting.methods.commitVote(identifier, time, ancillaryData, hash).send({ from: tokenOwner })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods.commitVote(identifier, time, ancillaryData, hash).send({ from: umaAdmin })
      )
    );
    await designatedVoting.methods.commitVote(identifier, time, ancillaryData, hash).send({ from: voter });

    // The UMA admin can't add new voters.
    assert(await didContractThrow(designatedVoting.methods.resetMember(voterRole, umaAdmin).send({ from: umaAdmin })));

    // Move to the reveal phase.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

    // Only the voter can reveal a vote.
    assert(
      await didContractThrow(
        designatedVoting.methods.revealVote(identifier, time, price, ancillaryData, salt).send({ from: tokenOwner })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods.revealVote(identifier, time, price, ancillaryData, salt).send({ from: umaAdmin })
      )
    );
    await designatedVoting.methods.revealVote(identifier, time, price, ancillaryData, salt).send({ from: voter });

    // Check the resolved price.
    roundId = await voting.methods.getCurrentRoundId().call();
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time, ancillaryData).call({ from: registeredContract })).toString(),
      price
    );

    // Retrieve rewards and check that rewards accrued to the `designatedVoting` contract.
    assert(
      await didContractThrow(
        designatedVoting.methods
          .retrieveRewards(roundId, [{ identifier, time, ancillaryData }])
          .send({ from: tokenOwner })
      )
    );
    assert(
      await didContractThrow(
        designatedVoting.methods
          .retrieveRewards(roundId, [{ identifier, time, ancillaryData }])
          .send({ from: umaAdmin })
      )
    );
    await designatedVoting.methods
      .retrieveRewards(roundId, [{ identifier, time, ancillaryData }])
      .send({ from: voter });

    // Expected inflation = token balance * inflation rate = 1 * 0.5
    const expectedInflation = web3.utils.toWei("50000000");
    const expectedNewBalance = web3.utils.toBN(tokenBalance).add(web3.utils.toBN(expectedInflation));
    assert.equal(await votingToken.methods.balanceOf(tokenOwner).call(), web3.utils.toWei("0"));
    assert.equal(
      await votingToken.methods.balanceOf(designatedVoting.options.address).call(),
      expectedNewBalance.toString()
    );

    // Reset the state.
    await voting.methods.setInflationRate({ rawValue: web3.utils.toWei("0") }).send({ from: accounts[0] });
    await designatedVoting.methods
      .withdrawErc20(votingToken.options.address, expectedNewBalance)
      .send({ from: tokenOwner });
    // Throw away the reward tokens to avoid interacting with other test cases.
    await votingToken.methods.transfer(umaAdmin, expectedInflation).send({ from: tokenOwner });
    await votingToken.methods.burn(expectedInflation).send({ from: umaAdmin });
  });

  it("Batch commit and reveal", async function () {
    await votingToken.methods.transfer(designatedVoting.options.address, tokenBalance).send({ from: tokenOwner });

    // Request a price.
    const identifier = padRight(utf8ToHex("batch"), 64);
    const time1 = "1000";
    const ancillaryData1 = "0x11111111";
    const time2 = "2000";
    const ancillaryData2 = "0x2222";
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await voting.methods.requestPrice(identifier, time1, ancillaryData1).send({ from: registeredContract });
    await voting.methods.requestPrice(identifier, time2, ancillaryData2).send({ from: registeredContract });
    await moveToNextRound(voting, accounts[0]);

    const roundId = await voting.methods.getCurrentRoundId().call();

    const price1 = getRandomSignedInt();
    const salt1 = getRandomSignedInt();
    const hash1 = computeVoteHashAncillary({
      price: price1,
      salt: salt1,
      account: designatedVoting.options.address,
      time: time1,
      ancillaryData: ancillaryData1,
      roundId,
      identifier,
    });
    const message1 = web3.utils.randomHex(4);

    const price2 = getRandomSignedInt();
    const salt2 = getRandomSignedInt();
    const hash2 = computeVoteHashAncillary({
      price: price2,
      salt: salt2,
      account: designatedVoting.options.address,
      time: time2,
      ancillaryData: ancillaryData2,
      roundId,
      identifier,
    });
    const message2 = web3.utils.randomHex(4);

    // Batch commit.
    const commits = [
      { identifier, time: time1, ancillaryData: ancillaryData1, hash: hash1, encryptedVote: message1 },
      { identifier, time: time2, ancillaryData: ancillaryData2, hash: hash2, encryptedVote: message2 },
    ];
    assert(await didContractThrow(designatedVoting.methods.batchCommit(commits).send({ from: tokenOwner })));
    await designatedVoting.methods.batchCommit(commits).send({ from: voter });

    // Move to the reveal phase.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

    // Check messages in emitted events.
    let events = await voting.getPastEvents("EncryptedVote", { fromBlock: 0, filter: { identifier } });
    assert.equal(events[events.length - 2].returnValues.encryptedVote, message1);
    assert.equal(events[events.length - 1].returnValues.encryptedVote, message2);

    // Batch reveal.
    const reveals = [
      { identifier, time: time1, price: price1.toString(), ancillaryData: ancillaryData1, salt: salt1.toString() },
      { identifier, time: time2, price: price2.toString(), ancillaryData: ancillaryData2, salt: salt2.toString() },
    ];
    assert(await didContractThrow(designatedVoting.methods.batchReveal(reveals).send({ from: tokenOwner })));
    await designatedVoting.methods.batchReveal(reveals).send({ from: voter });

    // Check the resolved price.
    await moveToNextRound(voting, accounts[0]);
    assert.equal(
      (await voting.methods.getPrice(identifier, time1, ancillaryData1).call({ from: registeredContract })).toString(),
      price1
    );
    assert.equal(
      (await voting.methods.getPrice(identifier, time2, ancillaryData2).call({ from: registeredContract })).toString(),
      price2
    );

    // Reset the state.
    await designatedVoting.methods.withdrawErc20(votingToken.options.address, tokenBalance).send({ from: tokenOwner });
  });
});
