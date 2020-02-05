const style = require("../textStyle");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const filterRequests = require("./filterRequestsByRound");
const { VotePhasesEnum } = require("../../../../common/Enums");

module.exports = async (web3, voting) => {
  style.spinnerReadingContracts.start();
  const pendingRequests = await voting.getPendingRequests();
  const roundId = await voting.getCurrentRoundId();
  const roundPhase = await voting.getVotePhase();
  const account = await getDefaultAccount(web3);
  const filteredRequests = await filterRequests(pendingRequests, account, roundId, roundPhase, voting);
  style.spinnerReadingContracts.stop();

  if (filteredRequests.length === 0) {
    console.log(`No pending requests for this vote phase!`);
  } else {
    console.group(
      `${style.bgMagenta(
        `\n** ${
          roundPhase.toString() === VotePhasesEnum.COMMIT ? "Price" : "Reveal"
        } Requests Sorted Chronologically by Timestamp **`
      )}`
    );
    console.log(
      `${style.bgMagenta(`(example) Identifier`)}: <PRICE-FEED>, ${style.bgMagenta(`Timestamp`)}: <UTC-TIME>`
    );

    for (let i = 0; i < filteredRequests.length; i++) {
      const request = filteredRequests[i];
      const identifierUtf8 = web3.utils.hexToUtf8(request.identifier);
      const timestampUtc = style.formatSecondsToUtc(parseInt(request.time));
      console.log(
        `${style.bgMagenta(`(${i}) Identifier`)}: ${identifierUtf8}, ${style.bgMagenta(`Timestamp`)}: ${timestampUtc}`
      );
    }
    console.log(`\n`);
    console.groupEnd();
  }
};
