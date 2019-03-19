const Migrations = artifacts.require("./Migrations.sol");
const Registry = artifacts.require("Registry");
const CentralizedOracle = artifacts.require("CentralizedOracle");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const CentralizedStore = artifacts.require("CentralizedStore");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");

const checkDeploymentValidity = async function(callback) {
  try {
    // Note: this script pulls the all contracts that are deployed as singletons and does a rough verification that
    // the deployed address points to a contract of the correct type. This will not catch minor bytecode mismatches.

    // Migrations
    const migrations = await Migrations.deployed();
    await migrations.lastCompletedMigration();

    // Registry
    const registry = await Registry.deployed();
    await registry.getAllRegisteredDerivatives();

    // CentralizedOracle
    const centralizedOracle = await CentralizedOracle.deployed();
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("Arbitrary Product"));
    await centralizedOracle.isIdentifierSupported(identifierBytes);

    // ManualPriceFeed
    const manualPriceFeed = await ManualPriceFeed.deployed();
    await manualPriceFeed.isIdentifierSupported(identifierBytes);

    // CentralizedStore
    const centralizedStore = await CentralizedStore.deployed();
    await centralizedStore.computeOracleFees("1", "1", "1");

    // LeveragedReturnCalculator
    const leveragedReturnCalculator = await LeveragedReturnCalculator.deployed();
    await leveragedReturnCalculator.leverage();

    // TokenizedDerivativeCreator
    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    const sponsorWhitelist = await AddressWhitelist.at(await tokenizedDerivativeCreator.sponsorWhitelist());
    const marginCurrencyWhitelist = await AddressWhitelist.at(
      await tokenizedDerivativeCreator.marginCurrencyWhitelist()
    );
    const returnCalculatorWhitelist = await AddressWhitelist.at(
      await tokenizedDerivativeCreator.returnCalculatorWhitelist()
    );

    // Sponsor Whitelist
    const arbitraryAddress = web3.utils.randomHex(20);
    await sponsorWhitelist.isOnWhitelist(arbitraryAddress);

    // Margin Currency Whitelist
    await marginCurrencyWhitelist.isOnWhitelist(arbitraryAddress);

    // Return Calculator Whitelist
    if (!(await returnCalculatorWhitelist.isOnWhitelist(leveragedReturnCalculator.address))) {
      // TODO: check other, more specific parameterizations if/when they are abstracted out of the migration scripts.
      throw "Deployed Return Calculator is not on the whitelist.";
    }

    console.log("Deployment looks good!");
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
};

module.exports = checkDeploymentValidity;
