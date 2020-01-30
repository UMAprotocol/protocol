const { decodeGovernorProposal, decodeAllActiveGovernorProposals } = require("./decode.js");

const cli = async function(callback) {
  try {
    console.log("You have started the UMA CLI!");

    await decodeAllActiveGovernorProposals(artifacts, web3);
  } catch (e) {
    callback(e);
  }

  callback();
};

module.exports = cli;
