const web3 = require("web3");

function getRandomSignedInt() {
  // Generate a random unsigned 256 bit int.
  const unsignedValue = web3.utils.toBN(web3.utils.randomHex(32));

  // The signed range is just the unsigned range decreased by 2^255.
  const signedOffset = web3.utils.toBN(2).pow(web3.utils.toBN(255));
  return unsignedValue.sub(signedOffset);
}

function getRandomUnsignedInt() {
  return web3.utils.toBN(web3.utils.randomHex(32));
}

module.exports = {
  getRandomSignedInt,
  getRandomUnsignedInt
};
