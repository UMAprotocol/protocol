const { web3 } = require("hardhat");
const { toHex, toBN } = web3.utils;

function applyL1ToL2Alias(l1Address) {
  const offset = toBN("0x1111000000000000000000000000000000001111");
  const l1AddressAsNumber = toBN(l1Address);

  const l2AddressAsNumber = l1AddressAsNumber.add(offset);

  const mask = toBN("2").pow(toBN("160"));
  return toHex(l2AddressAsNumber.mod(mask));
}

module.exports = { applyL1ToL2Alias };
