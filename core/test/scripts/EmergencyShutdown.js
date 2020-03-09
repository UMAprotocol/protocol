const EmergencyShutdown = require("../../scripts/EmergencyShutdown");

const AddressWhitelist = artifacts.require("AddressWhitelist");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const TokenizedDerivative = artifacts.require("TokenizedDerivative");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");

contract("scripts/EmergencyShutdown.js", function(accounts) {
  const ethAddress = "0x0000000000000000000000000000000000000000";

  let creator;
  let registry;
  let admin;
  let voting;
  let leverage;
  let priceFeed;
  let contract;
  let identifierBytes;
  const deployer = accounts[0];
  const sponsor = accounts[1];

  before(async function() {
    creator = await TokenizedDerivativeCreator.deployed();
    registry = await Registry.deployed();
    admin = await FinancialContractsAdmin.deployed();
    voting = await Voting.deployed();
    supportedIdentifiers = await IdentifierWhitelist.deployed();
    leverage = await LeveragedReturnCalculator.deployed();
    priceFeed = await ManualPriceFeed.deployed();

    identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("SOMETHING"));

    // Add eth as a margin currency
    const marginCurrencyWhitelist = await AddressWhitelist.at(await creator.marginCurrencyWhitelist());
    await marginCurrencyWhitelist.addToWhitelist(ethAddress);

    // Add identifier to Voting
    await supportedIdentifiers.addSupportedIdentifier(identifierBytes);

    // Push a price to the price feed
    const latestTime = parseInt(await priceFeed.getCurrentTime(), 10);
    await priceFeed.pushLatestPrice(identifierBytes, latestTime + 600, web3.utils.toWei("1", "ether"));

    // Voting currently disallows price requests in the future, so push Voting's time forward to make the Oracle
    // request created by emergency shutdown is in the past.
    await voting.setCurrentTime(latestTime + 700);

    // Create contract
    const params = {
      sponsor: sponsor,
      priceFeedAddress: priceFeed.address,
      defaultPenalty: web3.utils.toWei("0.5", "ether"),
      supportedMove: web3.utils.toWei("0.1", "ether"),
      product: identifierBytes,
      fixedYearlyFee: "0",
      disputeDeposit: web3.utils.toWei("0.5", "ether"),
      returnCalculator: leverage.address,
      startingTokenPrice: web3.utils.toWei("1", "ether"),
      expiry: 0,
      marginCurrency: ethAddress,
      withdrawLimit: web3.utils.toWei("1", "ether"),
      returnType: "0",
      startingUnderlyingPrice: web3.utils.toWei("1", "ether"),
      name: "Test",
      symbol: "TEST"
    };
    await creator.createTokenizedDerivative(params, { from: sponsor });

    // Retrieve the contract we just created
    const contracts = await registry.getRegisteredContracts(sponsor);
    const contractAddress = contracts[contracts.length - 1];
    contract = await TokenizedDerivative.at(contractAddress);
  });

  it("Requests a price", async function() {
    // Assert that the contract is live
    assert.equal((await contract.derivativeStorage()).state.toString(), "0");

    // Call emergency shutdown
    await EmergencyShutdown.run(deployer, contract.address);

    // Derivative is in Emergency state
    assert.equal((await contract.derivativeStorage()).state.toString(), "4");
  });
});
