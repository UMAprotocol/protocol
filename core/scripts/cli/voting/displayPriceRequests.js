const style = require("../textStyle");

module.exports = async (web3, artifacts) => {
  // TODO: Find a way not to have to require this artifacts twice, if that is even an inefficiency
  const Voting = artifacts.require("Voting");
  const voting = await Voting.deployed();

  style.spinnerReadingContracts.start();
  const pendingRequests = await voting.getPendingRequests();
  style.spinnerReadingContracts.stop();

  if (pendingRequests.length > 0) {
    console.group(`${style.bgMagenta(`\n** Price Requests Awaiting Your Vote **`)}`);
    console.log(`${style.bgMagenta(`(example) Identifier`)}: <PRICE-FEED>, ${style.bgMagenta(`Time`)}: <UTC-TIME>`);
    for (let i = 0; i < pendingRequests.length; i++) {
      const request = pendingRequests[i];
      const identifierUtf8 = web3.utils.hexToUtf8(request.identifier);
      const timestampUtc = style.formatSecondsToUtc(parseInt(request.time));
      console.log(
        `${style.bgMagenta(`(${i}) Identifier`)}: ${identifierUtf8}, ${style.bgMagenta(`Time`)}: ${timestampUtc}`
      );
    }
    console.log(`\n`);
    console.groupEnd();
  } else {
    console.log(`There are no pending price requests`);
  }
};
