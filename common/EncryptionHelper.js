const web3 = require("web3");

function computeTopicHash(request, roundId) {
  // Explicitly set the type. Otherwise `identifier` is encoded as a string.
  return web3.utils.soliditySha3(
    { t: "bytes32", v: request.identifier },
    { t: "uint", v: request.time },
    { t: "uint", v: roundId }
  );
}

function getKeyGenMessage(roundId) {
  // TODO: discuss dApp tradeoffs for changing this to a per-topic hash keypair.
  return `UMA Protocol one time key for round: ${roundId.toString()}`;
}

module.exports = { computeTopicHash, getKeyGenMessage };
