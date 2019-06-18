const getRandomSignedInt = web3 => {
  // Generate a random unsigned 256 bit int.
  const unsignedValue = web3.utils.toBN(web3.utils.randomHex(32));

  // The signed range is just the unsigned range decreased by 2^255.
  const signedOffset = web3.utils.toBN(2).pow(web3.utils.toBN(255));
  return unsignedValue.sub(signedOffset);
};

const getRandomUnsignedInt = web3 => {
  return web3.utils.toBN(web3.utils.randomHex(32));
};

module.exports = { getRandomSignedInt, getRandomUnsignedInt };
