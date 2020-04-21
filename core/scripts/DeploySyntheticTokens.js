// Usage example:
// $(npm bin)/truffle exec scripts/DeploySyntheticTokens.js --network=<network> --input_csv=<csv filename>
const argv = require("minimist")(process.argv.slice(), { string: ["input_csv"] });
const fs = require("fs");

const { toBN, toWei } = web3.utils;
const { RegistryRolesEnum } = require("../../common/Enums.js");

const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");

const collateral = {
  "Kovan DAI": "0x08ae34860fbfe73e223596e65663683973c72dd3"
};

const expiration = {
  "5/1/2020": "1588291200",
  "6/1/2020": "1590969600",
  "7/1/2020": "1593561600",
  "8/1/2020": "1596240000",
  "9/1/2020": "1598918400",
  "10/1/2020": "1601510400",
  "11/1/2020": "1604188800",
  "12/1/2020": "1606780800"
};

const parseLine = line => {
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
    minSponsorTokens: "0.01",
    timerAddress: "0x0000000000000000000000000000000000000000"
  };
  // return {
  //   tokenName: "UMA Gold",
  //   tokenSymbol: "UMAG",
  //   expirationTimestamp: expiration["8/1/2020"],
  //   identifier: web3.utils.utf8ToHex("GOLD_APR20"),
  //   collateralCurrency: collateral["Kovan DAI"],
  //   collateralRequirement: "110",
  //   disputeBond: "10",
  //   sponsorDisputeReward: "10",
  //   disputeReward: "10",
  //   minSponsorTokens: "0.01",
  //   timerAddress: "0x0000000000000000000000000000000000000000"
  // };
};

const percentToFixedPoint = percent => {
  return {
    rawValue: toBN(toWei(percent))
      .divn(100)
      .toString()
  };
};

const actualDeploy = async inputCsv => {
  const deployer = (await web3.eth.getAccounts())[0];
  const expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
  const identifierWhitelist = await IdentifierWhitelist.deployed();

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

    // Create a new EMP.
    const constructorParams = {
      expirationTimestamp: params.expirationTimestamp,
      collateralAddress: params.collateralCurrency,
      priceFeedIdentifier: priceFeedIdentifier,
      syntheticName: params.tokenName,
      syntheticSymbol: params.tokenSymbol,
      collateralRequirement: percentToFixedPoint(params.collateralRequirement),
      disputeBondPct: percentToFixedPoint(params.disputeBond),
      sponsorDisputeRewardPct: percentToFixedPoint(params.sponsorDisputeReward),
      disputerDisputeRewardPct: percentToFixedPoint(params.disputeReward),
      minSponsorTokens: percentToFixedPoint(params.minSponsorTokens),
      timerAddress: params.timerAddress
    };
    const address = await expiringMultiPartyCreator.createExpiringMultiParty.call(constructorParams, {
      from: deployer
    });
    await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, { from: deployer });
    console.log(params.tokenSymbol, address);
  }
};

const deploySyntheticTokens = async callback => {
  try {
    await actualDeploy(argv.input_csv);
  } catch (err) {
    callback(err);
  }
  callback();
};

module.exports = deploySyntheticTokens;
