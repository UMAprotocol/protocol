// Usage example:
// $(npm bin)/truffle exec scripts/DeploySyntheticTokens.js --network=<network> --input_csv=<csv filename>
const argv = require("minimist")(process.argv.slice(), { string: ["input_csv"] });
const fs = require("fs");

const { toBN, toWei } = web3.utils;
const { RegistryRolesEnum } = require("@uma/common");

const AddressWhitelist = artifacts.require("AddressWhitelist");
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Registry = artifacts.require("Registry");
const Store = artifacts.require("Store");

const collateral = { "Kovan DAI": "0x08ae34860fbfe73e223596e65663683973c72dd3" };

const expiration = {
  "5/1/2020": "1588291200",
  "6/1/2020": "1590969600",
  "7/1/2020": "1593561600",
  "8/1/2020": "1596240000",
  "9/1/2020": "1598918400",
  "10/1/2020": "1601510400",
  "11/1/2020": "1604188800",
  "12/1/2020": "1606780800",
};

const parseLine = (line) => {
  // This script hardcodes the order of the fields:
  // 0. tokenName, "UMA GOLD"
  // 1. tokenSymbol, "UMA_GLD"
  // 2. expirationTimestamp: "8/1/2020"
  // 3. identifier: "GOLD_NOV20" (key in `expiration` map)
  // 4. collateralCurrency: "Kovan DAI" (key in `collateral` map)
  // 5. collateralRequirement: "110"
  // 6. disputeBond: "10"
  // 7. sponsorDisputeReward: "10"
  // 8. disputeReward: "10"
  const fields = line.split(",");
  return {
    tokenName: fields[0],
    tokenSymbol: fields[1],
    expirationTimestamp: expiration[fields[2]],
    identifier: web3.utils.utf8ToHex(fields[3]),
    collateralCurrency: collateral[fields[4]],
    collateralRequirement: fields[5],
    disputeBond: fields[6],
    sponsorDisputeReward: fields[7],
    disputeReward: fields[8],
    // Hardcode min sponsor tokens. Most users of this script aren't interested in configuring this value.
    minSponsorTokens: "0.01",
  };
};

const percentToFixedPoint = (percent) => {
  return { rawValue: toBN(toWei(percent)).divn(100).toString() };
};

const actualDeploy = async (inputCsv) => {
  const expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
  const identifierWhitelist = await IdentifierWhitelist.deployed();
  const store = await Store.deployed();

  // Add EMP as a registered financial contract template factory.
  const registry = await Registry.deployed();
  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address);

  const data = fs.readFileSync(inputCsv).toString();
  const lines = data.split("\n");
  for (const line of lines) {
    if (line == "") {
      continue;
    }
    const params = parseLine(line);

    // Register the identifier.
    const priceFeedIdentifier = web3.utils.utf8ToHex(params.identifier);
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier);

    // Register the collateral currency.
    const collateralTokenWhitelist = await AddressWhitelist.at(
      await expiringMultiPartyCreator.collateralTokenWhitelist()
    );
    await collateralTokenWhitelist.addToWhitelist(params.collateralCurrency);

    // Create a new EMP.
    const constructorParams = {
      expirationTimestamp: params.expirationTimestamp,
      collateralAddress: params.collateralCurrency,
      priceFeedIdentifier: priceFeedIdentifier,
      syntheticName: params.tokenName,
      syntheticSymbol: params.tokenSymbol,
      collateralRequirement: percentToFixedPoint(params.collateralRequirement),
      disputeBondPercentage: percentToFixedPoint(params.disputeBond),
      sponsorDisputeRewardPercentage: percentToFixedPoint(params.sponsorDisputeReward),
      disputerDisputeRewardPercentage: percentToFixedPoint(params.disputeReward),
      minSponsorTokens: percentToFixedPoint(params.minSponsorTokens),
      excessTokenBeneficiary: store.address,
    };
    const address = await expiringMultiPartyCreator.createExpiringMultiParty.call(constructorParams);
    await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams);
    console.log(params.tokenSymbol, address);
  }
};

const deploySyntheticTokens = async (callback) => {
  try {
    await actualDeploy(argv.input_csv);
  } catch (err) {
    callback(err);
  }
  callback();
};

module.exports = deploySyntheticTokens;
