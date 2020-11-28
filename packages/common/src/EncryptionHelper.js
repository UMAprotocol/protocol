const web3 = require("web3");

// Web3's soliditySha3 will attempt to auto-detect the type of given input parameters,
// but this won't produce expected behavior for certain types such as `bytes32` or `address`.
// Therefore, these helper methods will explicitly set types.

function computeTopicHash(request, roundId) {
  return web3.utils.soliditySha3(
    { t: "bytes32", v: request.identifier },
    { t: "uint", v: request.time },
    { t: "uint", v: roundId }
  );
}

function computeVoteHash(request) {
  return web3.utils.soliditySha3(
    { t: "int", v: request.price },
    { t: "int", v: request.salt },
    { t: "address", v: request.account },
    { t: "uint", v: request.time },
    { t: "bytes", v: "0x" },
    { t: "uint", v: request.roundId },
    { t: "bytes32", v: request.identifier }
  );
}

function computeVoteHashAncillary(request) {
  return web3.utils.soliditySha3(
    { t: "int", v: request.price },
    { t: "int", v: request.salt },
    { t: "address", v: request.account },
    { t: "uint", v: request.time },
    { t: "bytes", v: request.ancillaryData },
    { t: "uint", v: request.roundId },
    { t: "bytes32", v: request.identifier }
  );
}

function getKeyGenMessage(roundId) {
  // TODO: discuss dApp tradeoffs for changing this to a per-topic hash keypair.
  return `UMA Protocol one time key for round: ${roundId.toString()}`;
}

module.exports = { computeTopicHash, computeVoteHash, computeVoteHashAncillary, getKeyGenMessage };
