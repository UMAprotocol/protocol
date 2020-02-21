const { toWei } = web3.utils;

const { ExpiringMultiPartyClient } = require("../ExpiringMultiPartyClient");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

const Finder = artifacts.require("Finder");
const TokenFactory = artifacts.require("TokenFactory");
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

contract("ExpiringMultiPartyClient.js", function(accounts) {
  let collateralToken;
  let emp;
  let client;
  let syntheticToken;

  const updateAndVerify = async (client, expectedSponsors, expectedPositions) => {
    await client._update();

    assert.deepStrictEqual(expectedSponsors.sort(), client.getAllSponsors().sort());
    assert.deepStrictEqual(expectedPositions.sort(), client.getAllPositions().sort());
  };

  before(async function() {
    collateralToken = await ERC20Mintable.new({ from: accounts[0] });
    await collateralToken.mint(accounts[0], toWei("100000"), { from: accounts[0] });
    await collateralToken.mint(accounts[1], toWei("100000"), { from: accounts[0] });
  });

  beforeEach(async function() {
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
    emp = await ExpiringMultiParty.new(constructorParams);
    client = new ExpiringMultiPartyClient(emp.address);
    await collateralToken.approve(emp.address, toWei("1000000"), { from: accounts[0] });
    await collateralToken.approve(emp.address, toWei("1000000"), { from: accounts[1] });

    syntheticToken = await ERC20Mintable.at(await emp.tokenCurrency());
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: accounts[0] });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: accounts[1] });
  });

  it("All Positions", async function() {
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

    // Liquidations.
    const id = await emp.createLiquidation.call(accounts[1], { rawValue: toWei("100") }, { from: accounts[0] });
    await emp.createLiquidation(accounts[1], { rawValue: toWei("100") }, { from: accounts[0] });

    await updateAndVerify(
      client,
      [accounts[0], accounts[1]],
      [{ sponsor: accounts[0], numTokens: toWei("100"), amountCollateral: toWei("20") }]
    );
    const expectedLiquidations = [
      {
        sponsor: accounts[1],
        id: id.toString(),
        numTokens: toWei("45"),
        amountCollateral: toWei("100"),
        liquidationTime: (await emp.getCurrentTime()).toString()
      }
    ];
    assert.deepStrictEqual(expectedLiquidations.sort(), client.getUndisputedLiquidations().sort());
  });

  it("Undercollateralized", async function() {
    await emp.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: accounts[0] });

    await client._update();
    // At 150% collateralization requirement, the position is just collateralized enough at a token price of 1.
    assert.deepStrictEqual([], client.getUnderCollateralizedPositions(toWei("1")));
    // Undercollateralized at a price just above 1.
    assert.deepStrictEqual(
      [{ sponsor: accounts[0], numTokens: toWei("100"), amountCollateral: toWei("150") }],
      client.getUnderCollateralizedPositions(toWei("1.00000000000000001"))
    );
  });
});
