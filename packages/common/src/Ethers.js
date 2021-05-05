const { hexlify, toUtf8Bytes } = require("ethers/utils");

function stringToBytes32(text) {
  let result = toUtf8Bytes(text);
  if (result.length > 32) {
    throw new Error("String too long");
  }
  result = hexlify(result);
  while (result.length < 66) {
    result += "0";
  }
  if (result.length !== 66) {
    throw new Error("invalid web3 implicit bytes32");
  }
  return result;
}

module.exports = {
  stringToBytes32
};
