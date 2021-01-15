const assert = require("assert");

/**
 * Get the version and type of a financial contract deployed using the official UMA contract factories.
 * Note: all inputs and outputs are expressed as fixed-point (scaled by 1e18) BNs.
 * @param {Object} web3 instance
 * @param {string} contractAddress address of the contract in question
 * @return {Object} contract name & version
 */

async function findContractVersion(contractAddress, web3) {
  assert(web3, "Web3 object must be provided");
  assert(contractAddress, "Contract Address Must be provided");
  const contractCode = await web3.eth.getCode(contractAddress);
  const contractCodeHash = web3.utils.soliditySha3(contractCode);
  console.log("Contract code hash", contractCodeHash);
  return versionMap[contractCodeHash];
}

const versionMap = {
  "0xa13e06c4439902742ac1a823744c7f8c201068ab6786d33f218433e55d69b1f2": {
    // Mainnet 1.2.2
    contractType: "ExpiringMultiParty",
    contractVersion: "1.2.2"
  },
  "0x7a52b6452a5f68e68a1bbebf66497019194a9fc9533457eeb92043e3d3bbae3b": {
    // 1.2.2 deployed from hardhat tests.
    contractType: "ExpiringMultiParty",
    contractVersion: "1.2.2"
  },
  "0x91a7449c56a485be56bd91515dd5334b73d60371f970ea3750e146c25b65e5b7": {
    // Main net 1.2.0
    contractType: "ExpiringMultiParty",
    contractVersion: "1.2.0"
  }
};

module.exports = {
  findContractVersion
};
