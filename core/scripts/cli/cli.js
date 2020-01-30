const { decodeGovernorProposal } = require("./decode.js");

const cli = async function(callback) {
  try {
    console.log("You have started the UMA CLI!");
  } catch (e) {
    callback(e);
  }

  callback();
};

module.exports = cli;
