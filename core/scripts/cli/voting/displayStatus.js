const style = require('../textStyle');

module.exports = async (artifacts) => {
    // TODO: Find a way not to have to require this artifacts twice, if that is even an inefficiency
    const Voting = artifacts.require("Voting");
    const voting = await Voting.deployed();
  
    style.spinnerReadingContracts.start();
    const pendingRequests = await voting.getPendingRequests();
    const roundId = await voting.getCurrentRoundId();
    const roundPhase = await voting.getVotePhase();
    const roundStats = await voting.rounds(roundId);
    style.spinnerReadingContracts.stop();

    console.group(`${style.bgMagenta(`\n** Your voting status **`)}`);
    console.log(`${style.bgMagenta(`- Current round ID`)}: ${roundId.toString()}`);
    // TODO: Display these as ordered table intuitvely
    console.log(`${style.bgMagenta(`- Pending price requests`)}: ${pendingRequests.length}`);
    // TODO: Differentiate between requests to commit votes on and reveals
    console.log(`${style.bgMagenta(`- Pending votes to reveal`)}: 0`);
    console.log(
      `${style.bgMagenta(`- Current round phase`)}: ${roundPhase.toString() === "0" ? "Commit" : "Reveal"}`
    );
    console.log(`${style.bgMagenta(`- Round Inflation percentage`)}: ${roundStats.inflationRate.toString()}`);
    console.log(`${style.bgMagenta(`- Round GAT percentage`)}: ${roundStats.gatPercentage.toString()}`);
    console.log(`\n`);
    console.groupEnd();
}