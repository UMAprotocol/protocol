const { toWei } = web3.utils;

const { ExpiringMultiPartyClient } = require("../ExpiringMultiPartyClient");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");

contract("ExpiringMultiPartyClient.js", function(accounts) {
  let collateralToken;
  let emp;
  let client;
  let syntheticToken;
  let mockOracle;

  const updateAndVerify = async (client, expectedSponsors, expectedPositions) => {
    await client._update();

    assert.deepStrictEqual(expectedSponsors.sort(), client.getAllSponsors().sort());
    assert.deepStrictEqual(expectedPositions.sort(), client.getAllPositions().sort());
  };

  before(async function() {
    collateralToken = await Token.new({ from: accounts[0] });
    await collateralToken.addMember(1, accounts[0], { from: accounts[0] });
    await collateralToken.mint(accounts[0], toWei("100000"), { from: accounts[0] });
    await collateralToken.mint(accounts[1], toWei("100000"), { from: accounts[0] });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.new();
    await identifierWhitelist.addSupportedIdentifier(web3.utils.utf8ToHex("UMATEST"));

    // Create a mockOracle and finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(identifierWhitelist.address);
    finder = await Finder.deployed();
    const mockOracleInterfaceName = web3.utils.utf8ToHex("Oracle");
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
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

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: accounts[0]
    });

    emp = await ExpiringMultiParty.new(constructorParams);
    client = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);
    await collateralToken.approve(emp.address, toWei("1000000"), { from: accounts[0] });
    await collateralToken.approve(emp.address, toWei("1000000"), { from: accounts[1] });

    syntheticToken = await Token.at(await emp.tokenCurrency());
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: accounts[0] });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: accounts[1] });
  });

  it("All Positions", async function() {
    // Create a position and check that it is detected correctly from the client.
    await emp.create({ rawValue: toWei("10") }, { rawValue: toWei("50") }, { from: accounts[0] });
    await updateAndVerify(
      client,
      [accounts[0]], //expected sponsor
      [{ sponsor: accounts[0], numTokens: toWei("50"), amountCollateral: toWei("10") }] //expected position
    );

    // Calling create again from the same sponsor should add additional collateral & debt.
    await emp.create({ rawValue: toWei("10") }, { rawValue: toWei("50") }, { from: accounts[0] });
    await updateAndVerify(
      client,
      [accounts[0]],
      [{ sponsor: accounts[0], numTokens: toWei("100"), amountCollateral: toWei("20") }]
    );

    // Calling create from a new address will create a new position and this should be added the the client.
    await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("45") }, { from: accounts[1] });
    await updateAndVerify(
      client,
      [accounts[0], accounts[1]],
      [
        { sponsor: accounts[0], numTokens: toWei("100"), amountCollateral: toWei("20") },
        { sponsor: accounts[1], numTokens: toWei("45"), amountCollateral: toWei("100") }
      ]
    );

    // If a position is liquidated it should be removed from the clients state.
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

    // Expire the liquidation by manipulating Date.now to be just after the liquidation's expiry.
    const expiryTime = (await emp.liquidations(accounts[1], id.toString())).expiry;
    let oldNow = Date.now;
    Date.now = () => {
      return Number(expiryTime) * 1000 + 1;
    };

    await updateAndVerify(
      client,
      [accounts[0], accounts[1]],
      [{ sponsor: accounts[0], numTokens: toWei("100"), amountCollateral: toWei("20") }]
    );
    assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());

    Date.now = oldNow;

    // Pending withdrawals state should be correctly identified.
    await emp.requestWithdrawal({ rawValue: toWei("10") }, { from: accounts[0] });
    await client._update();
    const expectedPendingWithdrawals = [
      {
        sponsor: accounts[0],
        requestPassTimestamp: (await emp.getCurrentTime()).add(await emp.withdrawalLiveness()).toString(),
        withdrawalRequestAmount: toWei("10"),
        numTokens: toWei("100"),
        amountCollateral: toWei("20")
      }
    ];

    assert.deepStrictEqual(expectedPendingWithdrawals, client.getPendingWithdrawals());

    // Remove the pending withdrawal and ensure it is removed from the client.
    await emp.cancelWithdrawal({ from: accounts[0] });
    await client._update();
    assert.deepStrictEqual([], client.getPendingWithdrawals());
  });

  it("Undercollateralized", async function() {
    await emp.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: accounts[0] });
    await emp.create({ rawValue: toWei("1500") }, { rawValue: toWei("100") }, { from: accounts[1] });

    await client._update();
    // At 150% collateralization requirement, the position is just collateralized enough at a token price of 1.
    assert.deepStrictEqual([], client.getUnderCollateralizedPositions(toWei("1")));
    // Undercollateralized at a price just above 1.
    assert.deepStrictEqual(
      [{ sponsor: accounts[0], numTokens: toWei("100"), amountCollateral: toWei("150") }],
      client.getUnderCollateralizedPositions(toWei("1.00000000000000001"))
    );

    // Create a new liquidation for account[0]'s position.
    const id = await emp.createLiquidation.call(accounts[0], { rawValue: toWei("150") }, { from: accounts[1] });
    await emp.createLiquidation(accounts[0], { rawValue: toWei("150") }, { from: accounts[1] });
    await client._update();

    const liquidations = client.getUndisputedLiquidations();
    // Disputable if the disputer believes the price was `1`, and not disputable if they believe the price was just
    // above `1`.
    assert.isTrue(client.isDisputable(liquidations[0], toWei("1")));
    assert.isFalse(client.isDisputable(liquidations[0], toWei("1.00000000000000001")));

    // Dispute the liquidation and make sure it no longer shows up in the list.
    // We need to advance the Oracle time forward to make `requestPrice` work.
    await mockOracle.setCurrentTime(Number(await emp.getCurrentTime()) + 1000);
    await emp.dispute(id.toString(), accounts[0], { from: accounts[0] });
    await client._update();

    // The disputed liquidation should longer show up as undisputed.
    assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());
  });
});
