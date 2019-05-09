const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const Voting = artifacts.require("Voting");

contract("Voting", function(accounts) {
  const account1 = accounts[0];
  const account2 = accounts[1];
  const account3 = accounts[2];
  const account4 = accounts[3];

  const getRandomInt = () => {
    return web3.utils.toBN(web3.utils.randomHex(32));
  };

  it("One voter, one request", async function() {
    const voting = await Voting.new();

    const identifier = web3.utils.utf8ToHex("id");
    const time = "1000";

    const price = getRandomInt();
    const salt = getRandomInt();
    const hash = web3.utils.soliditySha3(price, salt);

    // Can't commit hash of 0.
    assert(await didContractThrow(voting.commitVote(identifier, time, "0x0")));

    // Can't reveal before committing.
    assert(await didContractThrow(voting.revealVote(identifier, time, price, salt)));
    // Can commit a new hash.
    await voting.commitVote(identifier, time, hash);

    // Voters can alter their commits.
    const newPrice = getRandomInt();
    const newSalt = getRandomInt();
    const newHash = web3.utils.soliditySha3(newPrice, newSalt);

    // Can't reveal before committing.
    assert(await didContractThrow(voting.revealVote(identifier, time, newPrice, newSalt)));
    // Can alter a committed hash.
    await voting.commitVote(identifier, time, newHash);

    // Can't reveal the overwritten commit.
    assert(await didContractThrow(voting.revealVote(identifier, time, price, salt)));

    // Can't reveal with the wrong price but right salt, and reverse.
    assert(await didContractThrow(voting.revealVote(identifier, time, newPrice, salt)));
    assert(await didContractThrow(voting.revealVote(identifier, time, price, newSalt)));

    // Successfully reveal the latest commit.
    await voting.revealVote(identifier, time, newPrice, newSalt);

    // Can't reveal the same commit again.
    assert(await didContractThrow(voting.revealVote(identifier, time, newPrice, newSalt)));
  });

  it("Multiple voters", async function() {
    const voting = await Voting.new();

    const identifier = web3.utils.utf8ToHex("id");
    const time = "1000";

    const price1 = getRandomInt();
    const salt1 = getRandomInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);

    const price2 = getRandomInt();
    const salt2 = getRandomInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);

    // Voter3 wants to vote the same price as voter1.
    const price3 = price1;
    const salt3 = getRandomInt();
    const hash3 = web3.utils.soliditySha3(price3, salt3);

    // Multiple voters can commit.
    await voting.commitVote(identifier, time, hash1, { from: account1 });
    await voting.commitVote(identifier, time, hash2, { from: account2 });
    await voting.commitVote(identifier, time, hash3, { from: account3 });

    // They can't reveal each other's votes.
    assert(await didContractThrow(voting.revealVote(identifier, time, price2, salt2, { from: account1 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price3, salt3, { from: account1 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price1, salt1, { from: account2 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price3, salt3, { from: account2 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price1, salt1, { from: account3 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price2, salt2, { from: account3 })));

    // Someone who didn't even commit can't reveal anything either.
    assert(await didContractThrow(voting.revealVote(identifier, time, price1, salt1, { from: account4 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price2, salt2, { from: account4 })));
    assert(await didContractThrow(voting.revealVote(identifier, time, price3, salt3, { from: account4 })));

    // They can reveal their own votes.
    await voting.revealVote(identifier, time, price1, salt1, { from: account1 });
    await voting.revealVote(identifier, time, price2, salt2, { from: account2 });
    await voting.revealVote(identifier, time, price3, salt3, { from: account3 });
  });

  it("Overlapping request keys", async function() {
    const voting = await Voting.new();

    // Verify that concurrent votes with the same identifier but different times, or the same time but different
    // identifiers don't cause any problems.
    const identifier1 = web3.utils.utf8ToHex("id1");
    const time1 = "1000";
    const identifier2 = web3.utils.utf8ToHex("id2");
    const time2 = "2000";

    const price1 = getRandomInt();
    const salt1 = getRandomInt();
    const hash1 = web3.utils.soliditySha3(price1, salt1);

    const price2 = getRandomInt();
    const salt2 = getRandomInt();
    const hash2 = web3.utils.soliditySha3(price2, salt2);

    await voting.commitVote(identifier1, time2, hash1);
    await voting.commitVote(identifier2, time1, hash2);

    // Can't reveal the wrong combos.
    assert(await didContractThrow(voting.revealVote(identifier1, time2, price2, salt2)));
    assert(await didContractThrow(voting.revealVote(identifier2, time1, price1, salt1)));
    assert(await didContractThrow(voting.revealVote(identifier1, time1, price1, salt1)));
    assert(await didContractThrow(voting.revealVote(identifier1, time1, price2, salt2)));

    // Can reveal the right combos.
    voting.revealVote(identifier1, time2, price1, salt1);
    voting.revealVote(identifier2, time1, price2, salt2);
  });

  it("Request and retrieval", async function() {
    const voting = await Voting.new();

    // Verify that concurrent votes with the same identifier but different times, or the same time but different
    // identifiers don't cause any problems.
    const identifier1 = web3.utils.utf8ToHex("id1");
    const time1 = "1000";
    const identifier2 = web3.utils.utf8ToHex("id2");
    const time2 = "2000";

    // Requests should not be added to the current voting round.
    await voting.requestPrice(identifier1, time1);
    let pendingRequests = await voting.getPendingRequests();
    assert.equal(pendingRequests, []);

    await voting.requestPrice(identifier2, time2);
    pendingRequests = await voting.getPendingRequests();
    assert.equal(pendingRequests, []);

    // Since the round for these requests has not started, the price retrieval should fail.
    assert(await didContractThrow(voting.getPrice(identifier1, time1)));
    assert(await didContractThrow(voting.getPrice(identifier2, time2)));
  });
});
