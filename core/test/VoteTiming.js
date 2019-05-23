const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const Voting = artifacts.require("Voting");

contract("Voting", function(accounts) {
  let voting;

  const account1 = accounts[0];
  const account2 = accounts[1];
  const account3 = accounts[2];
  const account4 = accounts[3];

  const secondsPerDay = web3.utils.toBN(86400);

  const getRandomInt = () => {
    return web3.utils.toBN(web3.utils.randomHex(32));
  };

  const moveToNextRound = async () => {
    const phase = await voting.getVotePhase();
    const currentTime = await voting.getCurrentTime();
    let timeIncrement;
    if (phase.toString() === "0") {
      // Commit phase, so it will take 2 days to move to the next round.
      timeIncrement = secondsPerDay.muln(2);
    } else {
      // Reveal phase, so it will take 1 day to move to the next round.
      timeIncrement = secondsPerDay;
    }

    await voting.setCurrentTime(currentTime.add(timeIncrement));
  };

  const moveToNextPhase = async () => {
    const currentTime = await voting.getCurrentTime();
    await voting.setCurrentTime(currentTime.add(secondsPerDay));
  };

  before(async function() {
    voting = await Voting.deployed();
  });

  it("Vote phasing", async function() {
  });
});
