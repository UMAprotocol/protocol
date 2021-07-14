const web3 = require("web3");

function getRandomSignedInt() {
  const unsignedValue = getRandomUnsignedInt();

  // The signed range is just the unsigned range decreased by 2^255.
  const signedOffset = web3.utils.toBN(2).pow(web3.utils.toBN(255));
  return unsignedValue.sub(signedOffset);
}

// Generate a random unsigned 256 bit int.
function getRandomUnsignedInt() {
  return web3.utils.toBN(web3.utils.randomHex(32));
}

module.exports = { getRandomSignedInt, getRandomUnsignedInt };
