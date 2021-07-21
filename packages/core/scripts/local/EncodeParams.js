/**
 * @notice The purpose of this script is to encode ExpiringMultiParty parameters.
 *
 * Spinning up mainnet fork: ganache-cli --fork https://mainnet.infura.io/v3/5f56f0a4c8844c96a430fbd3d7993e39 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
 * Example: yarn truffle exec ./packages/core/scripts/local/EncodeParams.js --cversion latest --address 0x5A7f8F8B0E912BBF8525bc3fb2ae46E70Db9516B --network mainnet-fork
 */
const { toWei } = web3.utils;
const { ZERO_ADDRESS } = require("@uma/common");
const { getAbi, getTruffleContract } = require("../../dist/index");
const argv = require("minimist")(process.argv.slice(), { string: ["cversion", "address"] });
const abiVersion = argv.cversion || "latest"; // Default to most recent mainnet deployment, 1.2.2.
const address = argv.address || "0x0";

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiPartyCreator = getTruffleContract("ExpiringMultiPartyCreator", web3, abiVersion);
const ExpiringMultiParty = getTruffleContract("ExpiringMultiParty", web3, abiVersion);
const Finder = getTruffleContract("Finder", web3, abiVersion);
const TokenFactory = getTruffleContract("TokenFactory", web3, abiVersion);

/** ***************************************************
 * Main Script
 /*****************************************************/
const encodeParams = async (callback) => {
  try {
    const expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
    const finder = await Finder.deployed();
    const tokenFactory = await TokenFactory.deployed();

    const emp = await ExpiringMultiParty.at(address);

    // Replace these with the EMP constructor params you want to encode
    let constructorParams = {
      expirationTimestamp: "1619812800",
      collateralAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
      priceFeedIdentifier: "0x7553544f4e4b535f4150523231",
      syntheticName: "uSTONKS Index Token April 2021",
      syntheticSymbol: "uSTONKS_APR21",
      collateralRequirement: { rawValue: toWei("1.25") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.05") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.2") },
      minSponsorTokens: { rawValue: toWei("1") },
      liquidationLiveness: 7200,
      withdrawalLiveness: 7200,
      finderAddress: finder.address,
      tokenFactoryAddress: tokenFactory.address,
      timerAddress: await expiringMultiPartyCreator.timerAddress(),
    };

    // Inject constructor params neccessary for "2.0.1" version of the EMPCreator:
    if (abiVersion === "2.0.1") {
      constructorParams = {
        ...constructorParams,
        financialProductLibraryAddress: ZERO_ADDRESS,
        tokenAddress: await emp.tokenCurrency(),
      };
    }

    const encodedParameters = web3.eth.abi.encodeParameters(getAbi("ExpiringMultiParty", abiVersion)[0].inputs, [
      constructorParams,
    ]);

    // Done!
    console.log("Encoded EMP Parameters", encodedParameters);
    console.table(constructorParams);
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = encodeParams;
