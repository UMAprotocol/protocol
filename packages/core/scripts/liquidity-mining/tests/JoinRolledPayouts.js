const { toWei, toBN, fromWei } = web3.utils;

// Script to test.
const { _joinPayouts } = require("../JoinRolledPayouts");

contract("JoinRolledPayouts.js", function(accounts) {
  it("Correctly joins balances between weekly and rolled payouts", async function() {
    // create two payout objects that are formatted with the same structure as the scripts output. Create a spread of
    // sponsors; some are only in the weekly rewards, some are only in the rolled rewards and some are in both. Then,
    // use this to validate that all sponsors are correctly added during the join and that their balances are preserved.

    // Create a sample payout for the weekly LM rewards. Add accounts 0, 1, 2 for rewards.
    const sampleWeeklyPayout = {
      week: 4,
      fromBlock: 10680373,
      toBlock: 10725992,
      poolAddress: "0x58EF3abAB72c6C365D4D0D8a70039752b9f32Bc9",
      blocksPerSnapshot: 256,
      umaPerWeek: 8363,
      shareHolderPayout: {
        [accounts[0]]: "0.733264950109564979",
        [accounts[1]]: "12.325527829074857455",
        [accounts[2]]: "386.654545825648555491"
      }
    };

    // Create a sample payout for the rolled weeks payout. Add accounts 1, 2, 3 for rewards.
    const sampleRolledPayout = {
      rollNum: 1,
      fromBlock: 10725993,
      toBlock: 10752010,
      pool1Address: "0x58EF3abAB72c6C365D4D0D8a70039752b9f32Bc9",
      pool2Address: "0xd2f574637898526fcddfb3d487cc73c957fa0268",
      umaPerWeek: 16637,
      blocksPerSnapshot: 256,
      shareHolderPayout: {
        [accounts[1]]: "111.766401376681396497",
        [accounts[2]]: "0.961997253854479237",
        [accounts[3]]: "6.637050228881641885"
      }
    };
    // Generate a joined output from the two weekly payouts.
    const joinedOutput = _joinPayouts(sampleWeeklyPayout, sampleRolledPayout);

    // Output should contain all sponsors from the two input sets (accounts 0 -> 4)
    for (const sponsor of accounts.slice(0, 3)) {
      assert.isTrue(Object.keys(joinedOutput.shareHolderPayout).includes(sponsor));
    }

    // Output should contain all expected meta data.
    assert.equal(joinedOutput.fromBlock, sampleRolledPayout.fromBlock); // joined output fromBlock should start at beginning of roll.
    assert.equal(joinedOutput.endRollBlock, sampleRolledPayout.toBlock); // joined output end roll block should be end of roll.
    assert.equal(joinedOutput.toBlock, sampleWeeklyPayout.toBlock); // joined output toBlock should be end of the weekly payout.
    assert.equal(joinedOutput.umaPerWeek, sampleWeeklyPayout.umaPerWeek + sampleRolledPayout.umaPerWeek); // umaPerWeek should be the sum of the two payout's UMAs.
    assert.equal(joinedOutput.rollNum, sampleRolledPayout.rollNum); // output should contain the roll number.
    assert.equal(joinedOutput.week, sampleWeeklyPayout.week); // output should contain sample weekly payout week.

    // Output should correctly add token sponsor balances.
    // Sponsor0 was only in the weekly payout.
    assert.equal(joinedOutput.shareHolderPayout[accounts[0]], sampleWeeklyPayout.shareHolderPayout[accounts[0]]);

    // Sponsor1 was in both payouts. Should receive the sum of of payouts.
    assert.equal(
      joinedOutput.shareHolderPayout[accounts[1]],
      fromWei(
        toBN(toWei(sampleWeeklyPayout.shareHolderPayout[accounts[1]])).add(
          toBN(toWei(sampleRolledPayout.shareHolderPayout[accounts[1]]))
        )
      )
    );

    // Sponsor2 was in both payouts. Should receive the sum of of payouts.
    assert.equal(
      joinedOutput.shareHolderPayout[accounts[2]],
      fromWei(
        toBN(toWei(sampleWeeklyPayout.shareHolderPayout[accounts[2]])).add(
          toBN(toWei(sampleRolledPayout.shareHolderPayout[accounts[2]]))
        )
      )
    );

    // Sponsor3 was only in the rolled payout.
    assert.equal(joinedOutput.shareHolderPayout[accounts[3]], sampleRolledPayout.shareHolderPayout[accounts[3]]);
  });
});
