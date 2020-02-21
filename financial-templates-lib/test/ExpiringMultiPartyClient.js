const { toWei } = web3.utils;

const { ExpiringMultiPartyClient } = require("../ExpiringMultiPartyClient");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

const Finder = artifacts.require("Finder");
const TokenFactory = artifacts.require("TokenFactory");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

contract("ExpiringMultiPartyClient.js", function(accounts) {
  const updateAndVerify = async (client, expectedSponsors, expectedPositions) => {
    await client._update();

    assert.deepStrictEqual(expectedSponsors.sort(), client.getAllSponsors().sort());
    assert.deepStrictEqual(expectedPositions.sort(), client.getAllPositions().sort());
  };

  it("All Positions", async function() {
    const collateralToken = await ERC20Mintable.new({ from: accounts[0] });
    await collateralToken.mint(accounts[0], toWei("100000"), { from: accounts[0] });
    await collateralToken.mint(accounts[1], toWei("100000"), { from: accounts[0] });

    const constructorParams = {
      isTest: true,
      expirationTimestamp: "12345678900",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") }
    };

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: accounts[0]
    });

    const emp = await ExpiringMultiParty.new(constructorParams);
    const client = new ExpiringMultiPartyClient(emp.address);
    await collateralToken.approve(emp.address, toWei("1000000"), { from: accounts[0] });
    await collateralToken.approve(emp.address, toWei("1000000"), { from: accounts[1] });

    await emp.create({ rawValue: toWei("10") }, { rawValue: toWei("50") }, { from: accounts[0] });
    await updateAndVerify(
      client,
      [accounts[0]],
      [{ sponsor: accounts[0], numTokens: toWei("50"), amountCollateral: toWei("10") }]
    );

    await emp.create({ rawValue: toWei("10") }, { rawValue: toWei("50") }, { from: accounts[0] });
    await updateAndVerify(
      client,
      [accounts[0]],
      [{ sponsor: accounts[0], numTokens: toWei("100"), amountCollateral: toWei("20") }]
    );

    await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("45") }, { from: accounts[1] });
    await updateAndVerify(
      client,
      [accounts[0], accounts[1]],
      [
        { sponsor: accounts[0], numTokens: toWei("100"), amountCollateral: toWei("20") },
        { sponsor: accounts[1], numTokens: toWei("45"), amountCollateral: toWei("100") }
      ]
    );
  });
});
