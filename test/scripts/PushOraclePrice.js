const PushOraclePrice = require("../../scripts/PushOraclePrice.js");
const RequestOraclePrice = require("./RequestOraclePrice.js");

const CentralizedOracle = artifacts.require("CentralizedOracle");
const Registry = artifacts.require("Registry");

contract("scripts/PushOraclePrice.js", function(accounts) {
  let registry;
  let centralizedOracle;
  const deployer = accounts[0];
  const identifier = "CNH/USD";
  const time = 100;
  const price = 50;

  before(async function() {
    centralizedOracle = await CentralizedOracle.deployed();
    registry = await Registry.deployed();

    await registry.addDerivativeCreator(deployer, { from: deployer });
    await registry.registerDerivative([], deployer, { from: deployer });

    await RequestOraclePrice.run(registry.address, centralizedOracle.address, identifier, time);
  });

  it("Resolves a requested price", async function() {
    await PushOraclePrice.run(centralizedOracle.address, identifier, time, price);
    const identifierInBytes = web3.utils.fromAscii(identifier);
    const timeInBN = web3.utils.toBN(time);
    const pushedPrice = await centralizedOracle.getPrice(identifierInBytes, timeInBN);

    assert.equal(pushedPrice.toNumber(), price, `Expected price ${price}, got ${pushedPrice.toNumber()}`);
  });
});
