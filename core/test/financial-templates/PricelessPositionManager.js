// Libraries and helpers
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");

// Contracts to test
const PricelessPositionManager = artifacts.require("PricelessPositionManager");

// Other UMA related contracts and mocks
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const MockOracle = artifacts.require("MockOracle");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MarginToken = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");

contract("PricelessPositionManager", function(accounts) {
  const { toWei, hexToUtf8, toBN } = web3.utils;
  const contractDeployer = accounts[0];
  const sponsor = accounts[1];
  const tokenHolder = accounts[2];
  const other = accounts[3];
  const collateralOwner = accounts[4];

  // Contracts
  let collateral;
  let pricelessPositionManager;
  let tokenCurrency;
  let identifierWhitelist;
  let mockOracle;
  let financialContractsAdmin;

  // Initial constant values
  const initialPositionTokens = toBN(toWei("1000"));
  const initialPositionCollateral = toBN(toWei("1"));
  const syntheticName = "UMA test Token";
  const syntheticSymbol = "UMATEST";
  const withdrawalLiveness = 1000;
  const expirationTimestamp = Math.floor(Date.now() / 1000) + 10000;
  const siphonDelay = 100000;
  const priceTrackingIdentifier = web3.utils.utf8ToHex("UMATEST");

  // Contract state
  const STATES = {
    OPEN: "0",
    EXPIRED_PRICE_REQUESTED: "1",
    EXPIRED_PRICE_RECEIVED: "2"
  };

  const checkBalances = async (expectedSponsorTokens, expectedSponsorCollateral) => {
    const expectedTotalTokens = expectedSponsorTokens.add(initialPositionTokens);
    const expectedTotalCollateral = expectedSponsorCollateral.add(initialPositionCollateral);

    const positionData = await pricelessPositionManager.positions(sponsor);
    const sponsorCollateral = await pricelessPositionManager.getCollateral(sponsor);
    assert.equal(sponsorCollateral.toString(), expectedSponsorCollateral.toString());
    assert.equal(positionData.tokensOutstanding.toString(), expectedSponsorTokens.toString());
    assert.equal((await tokenCurrency.balanceOf(sponsor)).toString(), expectedSponsorTokens.toString());

    assert.equal(
      (await pricelessPositionManager.totalPositionCollateral()).toString(),
      expectedTotalCollateral.toString()
    );
    assert.equal((await pricelessPositionManager.totalTokensOutstanding()).toString(), expectedTotalTokens.toString());
    assert.equal(await collateral.balanceOf(pricelessPositionManager.address), expectedTotalCollateral.toString());
  };

  before(async function() {
    // Represents DAI or some other token that the sponsor and contracts don't control.
    collateral = await MarginToken.new({ from: collateralOwner });
    await collateral.addMember(1, collateralOwner, { from: collateralOwner });
    await collateral.mint(sponsor, toWei("1000000"), { from: collateralOwner });
    await collateral.mint(other, toWei("1000000"), { from: collateralOwner });

    store = await Store.deployed();
  });

  beforeEach(async function() {
    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceTrackingIdentifier, {
      from: contractDeployer
    });

    // Create a mockOracle and finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(identifierWhitelist.address, {
      from: contractDeployer
    });
    finder = await Finder.deployed();
    const mockOracleInterfaceName = web3.utils.utf8ToHex("Oracle");
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address, { from: contractDeployer });

    financialContractsAdmin = await FinancialContractsAdmin.deployed();

    // Create the instance of the PricelessPositionManager to test against.
    // The contract expires 10k seconds in the future -> will not expire during this test case.
    pricelessPositionManager = await PricelessPositionManager.new(
      true, // _isTest
      expirationTimestamp, // _expirationTimestamp
      withdrawalLiveness, // _withdrawalLiveness
      siphonDelay, // __siphonDelay
      collateral.address, // _collateralAddress
      Finder.address, // _finderAddress
      priceTrackingIdentifier, // _priceFeedIdentifier
      syntheticName, // _syntheticName
      syntheticSymbol, // _syntheticSymbol
      { from: contractDeployer }
    );
    tokenCurrency = await SyntheticToken.at(await pricelessPositionManager.tokenCurrency());
  });

  it("Correct deployment and variable assignment", async function() {
    // PricelessPosition variables
    assert.equal(await pricelessPositionManager.expirationTimestamp(), expirationTimestamp);
    assert.equal(await pricelessPositionManager.withdrawalLiveness(), withdrawalLiveness);
    assert.equal(await pricelessPositionManager.collateralCurrency(), collateral.address);
    assert.equal(await pricelessPositionManager.finder(), finder.address);
    assert.equal(hexToUtf8(await pricelessPositionManager.priceIdentifer()), hexToUtf8(priceTrackingIdentifier));

    // Synthetic token
    assert.equal(await tokenCurrency.name(), syntheticName);
    assert.equal(await tokenCurrency.symbol(), syntheticSymbol);

    // Reverts on bad constructor input (unknown identifer)
    assert(
      await didContractThrow(
        PricelessPositionManager.new(
          true, // _isTest (unchanged)
          expirationTimestamp, // _expirationTimestamp (unchanged)
          withdrawalLiveness, // _withdrawalLiveness (unchanged)
          collateral.address, // _collateralAddress (unchanged)
          finder.address, // _finderAddress (unchanged)
          web3.utils.utf8ToHex("UNKNOWN"), // Some identifer that the whitelist tracker does not know
          syntheticName, // _syntheticName (unchanged)
          syntheticSymbol, // _syntheticSymbol (unchanged)
          { from: contractDeployer }
        )
      )
    );
  });

  it("Lifecycle", async function() {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    // Create the initial pricelessPositionManager.
    const createTokens = toWei("100");
    const createCollateral = toWei("150");
    let expectedSponsorTokens = toBN(createTokens);
    let expectedSponsorCollateral = toBN(createCollateral);
    // Fails without approving collateral.
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: createCollateral }, { rawValue: createTokens }, { from: sponsor })
      )
    );
    await collateral.approve(pricelessPositionManager.address, createCollateral, { from: sponsor });
    const createResult = await pricelessPositionManager.create(
      { rawValue: createCollateral },
      { rawValue: createTokens },
      { from: sponsor }
    );
    truffleAssert.eventEmitted(createResult, "PositionCreated", ev => {
      return (
        ev.sponsor == sponsor &&
        ev.collateralAmount == createCollateral.toString() &&
        ev.tokenAmount == createTokens.toString()
      );
    });
    truffleAssert.eventEmitted(createResult, "NewSponsor", ev => {
      return ev.sponsor == sponsor;
    });

    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Deposit.
    const depositCollateral = toWei("50");
    expectedSponsorCollateral = expectedSponsorCollateral.add(toBN(depositCollateral));
    // Fails without approving collateral.
    assert(
      await didContractThrow(pricelessPositionManager.deposit({ rawValue: depositCollateral }, { from: sponsor }))
    );
    await collateral.approve(pricelessPositionManager.address, depositCollateral, { from: sponsor });
    await pricelessPositionManager.deposit({ rawValue: depositCollateral }, { from: sponsor });
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Withdraw.
    const withdrawCollateral = toWei("20");
    expectedSponsorCollateral = expectedSponsorCollateral.sub(toBN(withdrawCollateral));
    let sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await pricelessPositionManager.withdraw({ rawValue: withdrawCollateral }, { from: sponsor });
    let sponsorFinalBalance = await collateral.balanceOf(sponsor);
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), withdrawCollateral);
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Redeem 50% of the tokens for 50% of the collateral.
    const redeemTokens = toWei("50");
    expectedSponsorTokens = expectedSponsorTokens.sub(toBN(redeemTokens));
    expectedSponsorCollateral = expectedSponsorCollateral.divn(2);
    // Fails without approving token.
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: redeemTokens }, { from: sponsor })));
    await tokenCurrency.approve(pricelessPositionManager.address, redeemTokens, { from: sponsor });
    sponsorInitialBalance = await collateral.balanceOf(sponsor);
    const redemptionResult = await pricelessPositionManager.redeem({ rawValue: redeemTokens }, { from: sponsor });
    truffleAssert.eventEmitted(redemptionResult, "Redeem", ev => {
      return (
        ev.sponsor == sponsor &&
        ev.collateralAmount == expectedSponsorCollateral.toString() &&
        ev.tokenAmount == redeemTokens.toString()
      );
    });

    sponsorFinalBalance = await collateral.balanceOf(sponsor);
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), expectedSponsorCollateral);
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Create additional.
    const createAdditionalTokens = toWei("10");
    const createAdditionalCollateral = toWei("110");
    expectedSponsorTokens = expectedSponsorTokens.add(toBN(createAdditionalTokens));
    expectedSponsorCollateral = expectedSponsorCollateral.add(toBN(createAdditionalCollateral));
    await collateral.approve(pricelessPositionManager.address, createAdditionalCollateral, { from: sponsor });
    await pricelessPositionManager.create(
      { rawValue: createAdditionalCollateral },
      { rawValue: createAdditionalTokens },
      { from: sponsor }
    );
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Redeem full.
    const redeemRemainingTokens = toWei("60");
    await tokenCurrency.approve(pricelessPositionManager.address, redeemRemainingTokens, { from: sponsor });
    sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await pricelessPositionManager.redeem({ rawValue: redeemRemainingTokens }, { from: sponsor });
    sponsorFinalBalance = await collateral.balanceOf(sponsor);
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), expectedSponsorCollateral);
    await checkBalances(toBN("0"), toBN("0"));

    // TODO: Add a test to check that normal redemption does not work after maturity.
  });

  it("Withdrawal request", async function() {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    const startTime = await pricelessPositionManager.getCurrentTime();
    // Approve large amounts of token and collateral currencies: this test case isn't checking for that.
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await tokenCurrency.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });

    // Create the initial pricelessPositionManager.
    const initialSponsorTokens = toWei("100");
    const initialSponsorCollateral = toWei("150");
    await pricelessPositionManager.create(
      { rawValue: initialSponsorCollateral },
      { rawValue: initialSponsorTokens },
      { from: sponsor }
    );

    // Request withdrawal. Check event is emitted
    const resultRequestWithdrawal = await pricelessPositionManager.requestWithdrawal(
      { rawValue: toWei("100") },
      { from: sponsor }
    );
    truffleAssert.eventEmitted(resultRequestWithdrawal, "RequestWithdrawal", ev => {
      return ev.sponsor == sponsor && ev.collateralAmount == toWei("100").toString();
    });

    // All other actions are locked.
    assert(await didContractThrow(pricelessPositionManager.deposit({ rawValue: toWei("1") }, { from: sponsor })));
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor })));
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }, { from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: toWei("1") }, { from: sponsor })));
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("1") }, { from: sponsor }))
    );

    // Can't withdraw before time is up.
    await pricelessPositionManager.setCurrentTime(startTime.toNumber() + withdrawalLiveness - 1);
    assert(await didContractThrow(pricelessPositionManager.withdrawPassedRequest({ from: sponsor })));

    // The price moved against the sponsor, and they need to cancel. Ensure event is emitted.
    const resultCancelWithdrawal = await pricelessPositionManager.cancelWithdrawal({ from: sponsor });
    truffleAssert.eventEmitted(resultCancelWithdrawal, "RequestWithdrawalCanceled", ev => {
      return ev.sponsor == sponsor && ev.collateralAmount == toWei("100").toString();
    });

    // They can now request again.
    const withdrawalAmount = toWei("25");
    const expectedSponsorCollateral = toBN(initialSponsorCollateral).sub(toBN(withdrawalAmount));
    await pricelessPositionManager.requestWithdrawal({ rawValue: withdrawalAmount }, { from: sponsor });

    // Can withdraw after time is up.
    await pricelessPositionManager.setCurrentTime(
      (await pricelessPositionManager.getCurrentTime()).toNumber() + withdrawalLiveness + 1
    );

    const sponsorInitialBalance = await collateral.balanceOf(sponsor);
    const expectedSponsorFinalBalance = sponsorInitialBalance.add(toBN(withdrawalAmount));

    // Execute the withdrawal request. Check event is emitted
    const resultWithdrawPassedRequest = await pricelessPositionManager.withdrawPassedRequest({ from: sponsor });
    truffleAssert.eventEmitted(resultWithdrawPassedRequest, "RequestWithdrawalExecuted", ev => {
      return ev.sponsor == sponsor && ev.collateralAmount == withdrawalAmount.toString();
    });

    // Check that withdrawal-request related parameters in pricelessPositionManager are reset
    const positionData = await pricelessPositionManager.positions(sponsor);
    assert.equal(positionData.requestPassTimestamp.toString(), 0);
    assert.equal(positionData.withdrawalRequestAmount.toString(), 0);

    // Verify state of pricelessPositionManager post-withdrawal.
    await checkBalances(toBN(initialSponsorTokens), expectedSponsorCollateral);
    const sponsorFinalBalance = await collateral.balanceOf(sponsor);
    assert.equal(sponsorFinalBalance.toString(), expectedSponsorFinalBalance.toString());

    // Methods are now unlocked again.
    await pricelessPositionManager.deposit({ rawValue: toWei("1") }, { from: sponsor });

    // First withdrawal that should pass. Ensure event is emmited
    const resultWithdraw = await pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor });
    truffleAssert.eventEmitted(resultWithdraw, "Withdrawal", ev => {
      return ev.sponsor == sponsor && ev.collateralAmount.toString() == toWei("1");
    });

    await pricelessPositionManager.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor });
    await pricelessPositionManager.redeem({ rawValue: toWei("100") }, { from: sponsor });
    await checkBalances(toBN(initialSponsorTokens), expectedSponsorCollateral);

    // Can't cancel if no withdrawals pending.
    assert(await didContractThrow(pricelessPositionManager.cancelWithdrawal({ from: sponsor })));
  });

  it("Global collateralization ratio checks", async function() {
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: other });

    // Create the initial pricelessPositionManager, with a 150% collateralization ratio.
    await pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor });

    // Any withdrawal requests should fail, because withdrawals would reduce the global collateralization ratio.
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor })));

    // A new pricelessPositionManager can't be created below the global ratio.
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("101") }, { from: sponsor })
      )
    );
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("101") }, { from: other })
      )
    );

    // A new pricelessPositionManager CAN be expanded or created above the global ratio.
    await pricelessPositionManager.create({ rawValue: toWei("15") }, { rawValue: toWei("10") }, { from: sponsor });
    await pricelessPositionManager.create({ rawValue: toWei("25") }, { rawValue: toWei("10") }, { from: other });

    // Can't withdraw below global ratio.
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor })));

    // For the "other" pricelessPositionManager:
    // global collateralization ratio = (150 + 15 + 25) / (100 + 10 + 10) = 1.58333
    // To maintain 10 tokens, need at least 15.833 collateral => can withdraw from 25 down to 16 but not to 15.
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("10") }, { from: other })));
    await pricelessPositionManager.withdraw({ rawValue: toWei("9") }, { from: other });
  });

  it("Transfer", async function() {
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });

    // Create the initial pricelessPositionManager.
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });
    assert.equal((await pricelessPositionManager.getCollateral(sponsor)).toString(), amountCollateral);
    assert.equal((await pricelessPositionManager.positions(other)).rawCollateral.toString(), toWei("0"));

    // Transfer.
    const result = await pricelessPositionManager.transfer(other, { from: sponsor });
    truffleAssert.eventEmitted(result, "Transfer", ev => {
      return ev.oldSponsor == sponsor && ev.newSponsor == other;
    });
    truffleAssert.eventEmitted(result, "NewSponsor", ev => {
      return ev.sponsor == other;
    });

    assert.equal((await pricelessPositionManager.positions(sponsor)).rawCollateral.toString(), toWei("0"));
    assert.equal((await pricelessPositionManager.getCollateral(other)).toString(), amountCollateral);

    // Can't transfer if the target already has a pricelessPositionManager.
    await pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor });
    assert(await didContractThrow(pricelessPositionManager.transfer(other, { from: sponsor })));
  });

  it("Frozen when pre expiry and undercollateralized", async function() {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });

    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() - 1);

    // Even though the contract isn't expired yet, can't issue a withdrawal request past the expiration time.
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("1") }, { from: sponsor }))
    );

    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + 1);

    // All method calls should revert.
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor })));
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("1") }, { from: sponsor }))
    );
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: toWei("1") }, { from: sponsor })));
    assert(await didContractThrow(pricelessPositionManager.deposit({ rawValue: toWei("1") }, { from: sponsor })));
    assert(await didContractThrow(pricelessPositionManager.transfer(accounts[3], { from: sponsor })));
  });

  it("Redemption post expiry", async function() {
    // Create one position with 100 synthetic tokens to mint with 150 tokens of collateral. For this test say the
    // collateral is Dai with a value of 1USD and the synthetic is some fictional stock or commodity.
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = toWei("50");
    await tokenCurrency.transfer(tokenHolder, tokenHolderTokens, {
      from: sponsor
    });

    // Should revert if before contract expiration.
    assert(await didContractThrow(pricelessPositionManager.settleExpired()));
    assert(await didContractThrow(pricelessPositionManager.expire()));

    // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + 1);

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    const expireResult = await pricelessPositionManager.expire({ from: other });
    truffleAssert.eventEmitted(expireResult, "ContractExpired", ev => {
      return ev.caller == other;
    });

    // Settling an expired position should revert if the contract has expired but the DVM has not yet returned a price.
    assert(await didContractThrow(pricelessPositionManager.settleExpired({ from: tokenHolder })));

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
    const redemptionPrice = 1.2;
    const redemptionPriceWei = toWei(redemptionPrice.toString());
    await mockOracle.pushPrice(priceTrackingIdentifier, expirationTime.toNumber(), redemptionPriceWei);

    // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
    // They have 50 tokens settled at a price of 1.2 should yield 60 units of underling (or 60 USD as underlying is Dai).
    const tokenHolderInitialCollateral = await collateral.balanceOf(tokenHolder);
    const tokenHolderInitialSynthetic = await tokenCurrency.balanceOf(tokenHolder);
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.approve(pricelessPositionManager.address, tokenHolderInitialSynthetic, {
      from: tokenHolder
    });
    let settleExpiredResult = await pricelessPositionManager.settleExpired({ from: tokenHolder });
    const tokenHolderFinalCollateral = await collateral.balanceOf(tokenHolder);
    const tokenHolderFinalSynthetic = await tokenCurrency.balanceOf(tokenHolder);

    // The token holder should gain the value of their synthetic tokens in underlying.
    // The value in underlying is the number of tokens they held in the beginning * settlement price as TRV
    // When redeeming 50 tokens at a price of 1.2 we expect to receive 60 collateral tokens (50 * 1.2)
    const expectedTokenHolderFinalCollateral = toWei("60");
    assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // Check the event returned the correct values
    truffleAssert.eventEmitted(settleExpiredResult, "SettleExpiredPosition", ev => {
      return (
        ev.caller == tokenHolder &&
        ev.collateralReturned == tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral).toString() &&
        ev.tokensBurned == tokenHolderInitialSynthetic.toString()
      );
    });

    // For the sponsor, they are entitled to the underlying value of their remaining synthetic tokens + the excess collateral
    // in their position at time of settlement. The sponsor had 150 units of collateral in their position and the final TRV
    // of their synthetics they sold is 120. Their redeemed amount for this excess collateral is the difference between the two.
    // The sponsor also has 50 synthetic tokens that they did not sell. This makes their expected redemption = 150 - 120 + 50 * 1.2 = 90
    const sponsorInitialCollateral = await collateral.balanceOf(sponsor);
    const sponsorInitialSynthetic = await tokenCurrency.balanceOf(sponsor);

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.approve(pricelessPositionManager.address, sponsorInitialSynthetic, {
      from: sponsor
    });
    await pricelessPositionManager.settleExpired({ from: sponsor });
    const sponsorFinalCollateral = await collateral.balanceOf(sponsor);
    const sponsorFinalSynthetic = await tokenCurrency.balanceOf(sponsor);

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 150 - 100 * 1.2 = 30
    const expectedSponsorCollateralUnderlying = toBN(toWei("30"));
    // Value of remaining synthetic tokens = 50 * 1.2 = 60
    const expectedSponsorCollateralSynthetic = toBN(toWei("60"));
    const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
      expectedSponsorCollateralSynthetic
    );
    assert.equal(
      sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
      expectedTotalSponsorCollateralReturned
    );

    // The token Sponsor should have no synthetic positions left after settlement.
    assert.equal(sponsorFinalSynthetic, 0);

    // Last check is that after redemption the position in the positions mapping has been removed.
    const sponsorsPosition = await pricelessPositionManager.positions(sponsor);
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.requestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
  });

  it("Non sponsor can't deposit or redeem", async function() {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    await tokenCurrency.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });

    // Can't deposit without first creating a pricelessPositionManager.
    assert(await didContractThrow(pricelessPositionManager.deposit({ rawValue: toWei("1") }, { from: sponsor })));

    // Can't request a withdrawal without first creating a pricelessPositionManager.
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("0") }, { from: sponsor }))
    );

    // Even if the "sponsor" acquires a token somehow, they can't redeem.
    await tokenCurrency.transfer(sponsor, toWei("1"), { from: other });
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: toWei("1") }, { from: sponsor })));
  });

  it("Can't redeem more than pricelessPositionManager size", async function() {
    await tokenCurrency.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: other });
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });

    const numTokens = toWei("1");
    const numCombinedTokens = toWei("2");
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: numTokens }, { from: other });
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: numTokens }, { from: sponsor });

    await tokenCurrency.transfer(sponsor, numTokens, { from: other });
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: numCombinedTokens }, { from: sponsor })));
    await pricelessPositionManager.redeem({ rawValue: numTokens }, { from: sponsor });
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: numTokens }, { from: sponsor })));
  });

  it("Basic fees", async function() {
    // Set up position.
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: other });
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });

    // Set up another position that is less collateralized so sponsor can withdraw freely.
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: toWei("100000") }, { from: other });
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }, { from: sponsor });

    // Set store fees to 1% per second.
    await store.setFixedOracleFeePerSecond({ rawValue: toWei("0.01") });

    // Move time in the contract forward by 1 second to capture a 1% fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));

    // Determine the expected store balance by adding 1% of the sponsor balance to the starting store balance.
    // Multiply by 2 because there are two active positions
    const expectedStoreBalance = (await collateral.balanceOf(store.address)).add(toBN(toWei("0.02")));

    // Pay the fees, then check the collateral and the store balance.
    await pricelessPositionManager.payFees();
    let collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    assert.equal(collateralAmount.rawValue.toString(), toWei("0.99"));
    assert.equal((await collateral.balanceOf(store.address)).toString(), expectedStoreBalance.toString());

    // Ensure that fees are not applied to new collateral.
    // TODO: value chosen specifically to avoid rounding errors -- see #873.
    await pricelessPositionManager.deposit({ rawValue: toWei("99") }, { from: sponsor });
    collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    assert.equal(collateralAmount.rawValue.toString(), toWei("99.99"));

    // Ensure that the conversion works correctly for withdrawals.
    const expectedSponsorBalance = (await collateral.balanceOf(sponsor)).add(toBN(toWei("1")));
    await pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor });
    assert.equal((await collateral.balanceOf(sponsor)).toString(), expectedSponsorBalance.toString());
    assert.equal((await pricelessPositionManager.getCollateral(sponsor)).toString(), toWei("98.99"));

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.setFixedOracleFeePerSecond({ rawValue: "0" });
  });

  it("Basic fees: Rounding error causes redeemable collateral to sometimes be lower than expected", async function() {
    // Set up position.
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });

    // Here, we choose a collateral amount that will produce rounding errors:
    // - Collateral = 3 wei (3e-18)
    // - 50% fees per second * 1 second * 3e-18 collateral = 1.5e-18 fees, however this gets floored by `Store.computeFee()` to 1 wei (1e-18) fees
    // - Fees paid as % of collateral = 1e-18 / 3e-18 = 0.33...33 repeating, which cannot be represented by FixedPoint
    // - This will get ceil'd up to 0.33...34
    // - This causes the adjustment multiplier applied to the collateral (1 - fee %) to be slightly lower: (1-0.33..34) versus (1+0.33..33)
    // - Ultimately this adjusts the collateral available for redemption to be lower than anticipated
    await pricelessPositionManager.create({ rawValue: "3" }, { rawValue: toWei("1") }, { from: sponsor });

    // Set store fees to 50% per second.
    await store.setFixedOracleFeePerSecond({ rawValue: toWei("0.5") });

    // Move time in the contract forward by 1 second to capture a 50% fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));

    // Store should have received the 1 wei of fees
    const expectedStoreBalance = (await collateral.balanceOf(store.address)).add(toBN("1"));

    // Pay the fees, then check the collateral and the store balance.
    await pricelessPositionManager.payFees();
    // Due to the rounding error mentioned above, `getCollateral()` will return
    // slightly less than what we are expecting:
    // Without rounding errors, we would expect there to be (3 wei collateral - 1 wei fee = 2 wei collateral) in the contract
    let collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    // However, `getCollateral()` returns a value less than expected
    assert(toBN(collateralAmount.rawValue).lt(toBN("2")));
    // Store should still have received the correct fee
    assert.equal((await collateral.balanceOf(store.address)).toString(), expectedStoreBalance.toString());
    // The contract itself has more collateral than `getCollateral()` returns (i.e. it has the expected amount of collateral absent any rounding errors)
    assert.equal((await collateral.balanceOf(pricelessPositionManager.address)).toString(), "2");

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.setFixedOracleFeePerSecond({ rawValue: "0" });
  });

  it("Final fees", async function() {
    // Create a new position
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    const numTokens = toWei("50");
    const amountCollateral = toWei("100");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = toWei("25");
    await tokenCurrency.transfer(tokenHolder, tokenHolderTokens, {
      from: sponsor
    });

    // Set store final fees to 1 collateral token.
    const finalFeePaid = toWei("1");
    await store.setFinalFee(collateral.address, { rawValue: finalFeePaid });

    // Advance time until after expiration. Token holders and sponsors should now be able to to settle.
    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + 1);

    // Determine the expected store balance by adding 1% of the sponsor balance to the starting store balance.
    const expectedStoreBalance = (await collateral.balanceOf(store.address)).add(toBN(finalFeePaid));

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    await pricelessPositionManager.expire({ from: other });

    // Check that final fees were paid correctly and position's locked collateral was decremented
    let collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    assert.equal(collateralAmount.rawValue.toString(), toWei("99"));
    assert.equal((await collateral.balanceOf(store.address)).toString(), expectedStoreBalance.toString());

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
    const redemptionPrice = 1.2;
    const redemptionPriceWei = toWei(redemptionPrice.toString());
    await mockOracle.pushPrice(priceTrackingIdentifier, expirationTime.toNumber(), redemptionPriceWei);

    // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
    // They have 25 tokens settled at a price of 1.2 should yield 30 units of underling (or 60 USD as underlying is Dai).
    const tokenHolderInitialCollateral = await collateral.balanceOf(tokenHolder);
    const tokenHolderInitialSynthetic = await tokenCurrency.balanceOf(tokenHolder);

    // Approve the tokens to be moved by the contract and execute the settlement for the token holder.
    await tokenCurrency.approve(pricelessPositionManager.address, tokenHolderInitialSynthetic, {
      from: tokenHolder
    });
    let settleExpiredResult = await pricelessPositionManager.settleExpired({ from: tokenHolder });
    const tokenHolderFinalCollateral = await collateral.balanceOf(tokenHolder);
    const tokenHolderFinalSynthetic = await tokenCurrency.balanceOf(tokenHolder);

    // The token holder should gain the value of their synthetic tokens in underlying.
    // The value in underlying is the number of tokens they held in the beginning * settlement price as TRV
    // When redeeming 25 tokens at a price of 1.2 we expect to receive 30 collateral tokens (25 * 1.2)
    const expectedTokenHolderFinalCollateral = toWei("30");
    assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // Check the event returned the correct values
    truffleAssert.eventEmitted(settleExpiredResult, "SettleExpiredPosition", ev => {
      return (
        ev.caller == tokenHolder &&
        ev.collateralReturned == tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral).toString() &&
        ev.tokensBurned == tokenHolderInitialSynthetic.toString()
      );
    });

    // For the sponsor, they are entitled to the underlying value of their remaining synthetic tokens + the excess collateral
    // in their position at time of settlement - final fees. The sponsor had 100 units of collateral in their position and the final TRV
    // of their synthetics they sold is 60. Their redeemed amount for this excess collateral is the difference between the two.
    // The sponsor also has 25 synthetic tokens that they did not sell. This makes their expected redemption = 100 - 60 + 25 * 1.2 - 1 = 69
    const sponsorInitialCollateral = await collateral.balanceOf(sponsor);
    const sponsorInitialSynthetic = await tokenCurrency.balanceOf(sponsor);

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.approve(pricelessPositionManager.address, sponsorInitialSynthetic, {
      from: sponsor
    });
    await pricelessPositionManager.settleExpired({ from: sponsor });
    const sponsorFinalCollateral = await collateral.balanceOf(sponsor);
    const sponsorFinalSynthetic = await tokenCurrency.balanceOf(sponsor);

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 100 - 50 * 1.2 - 1 = 39
    const expectedSponsorCollateralUnderlying = toBN(toWei("39"));
    // Value of remaining synthetic tokens = 25 * 1.2 = 30
    const expectedSponsorCollateralSynthetic = toBN(toWei("30"));
    const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
      expectedSponsorCollateralSynthetic
    );
    assert.equal(
      sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
      expectedTotalSponsorCollateralReturned
    );

    // The token Sponsor should have no synthetic positions left after settlement.
    assert.equal(sponsorFinalSynthetic, 0);

    // The contract should have no more collateral tokens
    assert.equal(await collateral.balanceOf(pricelessPositionManager.address), 0);

    // Last check is that after redemption the position in the positions mapping has been removed.
    const sponsorsPosition = await pricelessPositionManager.positions(sponsor);
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.requestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.setFinalFee(collateral.address, { rawValue: "0" });
  });

  it("Final Fees: Rounding error causes redeemable collateral to sometimes be lower than expected", async () => {
    // Setting the amount of collateral = 30 wei and the final fee to 1 wei will result in rounding errors
    // because of the intermediate calculation in `payFees()` for calculating the `feeAdjustment`: ( fees paid ) / (total collateral)
    // = 0.033... repeating, which cannot be represented precisely by a fixed point.

    // Create a new position
    await collateral.approve(pricelessPositionManager.address, "100000", { from: sponsor });
    const numTokens = "20";
    const amountCollateral = "30";
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = "10";
    await tokenCurrency.transfer(tokenHolder, tokenHolderTokens, {
      from: sponsor
    });

    // Set store final fees to 1e-18 collateral token.
    const finalFeePaid = "1";
    await store.setFinalFee(collateral.address, { rawValue: finalFeePaid });

    // Expire the contract, causing the contract to pay its final fees
    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + 1);
    const expectedStoreBalance = (await collateral.balanceOf(store.address)).add(toBN(finalFeePaid));
    await pricelessPositionManager.expire({ from: other });

    // Absent any rounding errors, `getCollateral` should return (initial-collateral - final-fees) = 30 wei - 1 wei = 29 wei.
    // But, because of the use of mulCeil and divCeil in _payFinalFees, getCollateral() will return slightly less
    // collateral than expected. When calculating the new `feeAdjustment`, we need to calculate the %: (fees paid / pfc), which is
    // 1/30. However, 1/30 = 0.03333... repeating, which cannot be represented in FixedPoint. Normally mul() would floor
    // this value to 0.033....33, but mulCeil sets this to 0.033...34. A higher `feeAdjustment` causes a lower `adjustment` and ultimately
    // lower `totalPositionCollateral` and `positionAdjustment` values.
    let collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    assert(toBN(collateralAmount.rawValue).lt(toBN("29")));

    // The actual amount of fees paid to the store is as expected = 1e-18
    assert.equal((await collateral.balanceOf(store.address)).toString(), expectedStoreBalance.toString());

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 20 units of outstanding tokens this results in a token redemption value of: TRV = 20 * 1.2 = 24 USD.
    const redemptionPrice = 1.2;
    const redemptionPriceWei = toWei(redemptionPrice.toString());
    await mockOracle.pushPrice(priceTrackingIdentifier, expirationTime.toNumber(), redemptionPriceWei);

    // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
    // They have 10 tokens settled at a price of 1.2 should yield 12 units of collateral.
    // The rounding errors DO NOT affect the token holder's redemption amount
    const tokenHolderInitialCollateral = await collateral.balanceOf(tokenHolder);
    const tokenHolderInitialSynthetic = await tokenCurrency.balanceOf(tokenHolder);
    await tokenCurrency.approve(pricelessPositionManager.address, tokenHolderInitialSynthetic, {
      from: tokenHolder
    });
    await pricelessPositionManager.settleExpired({ from: tokenHolder });
    const tokenHolderFinalCollateral = await collateral.balanceOf(tokenHolder);
    const tokenHolderFinalSynthetic = await tokenCurrency.balanceOf(tokenHolder);

    // The token holder should gain the value of their synthetic tokens in underlying.
    const expectedTokenHolderFinalCollateral = "12";
    assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // The sponsor is entitled to the underlying value of their remaining synthetic tokens + the excess collateral
    // in their position at time of settlement - final fees.
    // HOWEVER, the excess collateral calculated will be slightly less than expected because of the aformentioned rounding issues.
    // The sponsor also has 10 synthetic tokens that they did not sell. This makes their expected redemption = 30 - (20 * 1.2) + (10 * 1.2) - 1 - rounding-error <= 17
    const sponsorInitialCollateral = await collateral.balanceOf(sponsor);
    const sponsorInitialSynthetic = await tokenCurrency.balanceOf(sponsor);

    await tokenCurrency.approve(pricelessPositionManager.address, sponsorInitialSynthetic, {
      from: sponsor
    });
    await pricelessPositionManager.settleExpired({ from: sponsor });
    const sponsorFinalCollateral = await collateral.balanceOf(sponsor);
    const sponsorFinalSynthetic = await tokenCurrency.balanceOf(sponsor);

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 30 - 20 * 1.2 - 1 - roundingErrors <= 5
    const expectedSponsorCollateralUnderlying = toBN("5");
    // Value of remaining synthetic tokens = 10 * 1.2 = 12
    const expectedSponsorCollateralSynthetic = toBN("12");
    const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
      expectedSponsorCollateralSynthetic
    );
    // This should return slightly less collateral than expected
    assert(sponsorFinalCollateral.sub(sponsorInitialCollateral).lt(expectedTotalSponsorCollateralReturned));

    // The token Sponsor should have no synthetic positions left after settlement.
    assert.equal(sponsorFinalSynthetic, 0);

    // The contract should have a small remainder of collateral tokens due to rounding
    // TODO(#934): Put a more precise upper bound on the rounding error. I purposefully choose small enough numbers here that I know before hand what the rounding error will be.
    assert.equal((await collateral.balanceOf(pricelessPositionManager.address)).toString(), "1");

    // Last check is that after redemption the position in the positions mapping has been removed.
    const sponsorsPosition = await pricelessPositionManager.positions(sponsor);
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.requestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.setFinalFee(collateral.address, { rawValue: "0" });
  });

  it("Not enough collateral to pay final fees, reverts expire", async function() {
    // Create a new position
    await collateral.approve(pricelessPositionManager.address, toWei("2"), { from: sponsor });
    const numTokens = toWei("2");
    const amountCollateral = toWei("2");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });

    // Set store final fees >= collateral in positions.
    const finalFeePaid = toWei("3");
    await store.setFinalFee(collateral.address, { rawValue: finalFeePaid });

    // Advance time until after expiration.
    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + 1);

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    assert(await didContractThrow(pricelessPositionManager.expire({ from: other })));

    // Position has frozen collateral
    let frozenCollateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    assert.equal(frozenCollateralAmount.rawValue.toString(), amountCollateral);

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.setFinalFee(collateral.address, { rawValue: "0" });
  });

  it("Oracle swap post expiry", async function() {
    // Approvals
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await tokenCurrency.approve(pricelessPositionManager.address, toWei("100000"), { from: tokenHolder });
    await tokenCurrency.approve(pricelessPositionManager.address, toWei("100000"), { from: other });

    // Create one position with 200 synthetic tokens to mint with 300 tokens of collateral. For this test say the
    // collateral is Dai with a value of 1USD and the synthetic is some fictional stock or commodity.
    const numTokens = toWei("200");
    const amountCollateral = toWei("300");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });

    // Transfer 100 the tokens from the sponsor to two separate holders. IRL this happens through the sponsor selling
    // tokens.
    const tokenHolderTokens = toWei("100");
    await tokenCurrency.transfer(tokenHolder, tokenHolderTokens, {
      from: sponsor
    });
    await tokenCurrency.transfer(other, tokenHolderTokens, {
      from: sponsor
    });

    // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + 1);

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    await pricelessPositionManager.expire({ from: other });

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 200 units of outstanding tokens this results in a token redemption value of: TRV = 200 * 1.2 = 240 USD.
    await mockOracle.pushPrice(priceTrackingIdentifier, expirationTime, toWei("1.2"));

    // Token holder should receive 120 collateral tokens for their 100 synthetic tokens.
    let initialCollateral = await collateral.balanceOf(tokenHolder);
    await pricelessPositionManager.settleExpired({ from: tokenHolder });
    let collateralPaid = (await collateral.balanceOf(tokenHolder)).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("120"));

    // Create new oracle, replace it in the finder, and push a different price to it.
    const newMockOracle = await MockOracle.new(identifierWhitelist.address);
    const mockOracleInterfaceName = web3.utils.utf8ToHex("Oracle");
    await finder.changeImplementationAddress(mockOracleInterfaceName, newMockOracle.address, {
      from: contractDeployer
    });

    // Settle expired should still work even if the new oracle has no price.
    initialCollateral = await collateral.balanceOf(sponsor);
    await pricelessPositionManager.settleExpired({ from: sponsor });
    collateralPaid = (await collateral.balanceOf(sponsor)).sub(initialCollateral);

    // Sponsor should have received 300 - 240 = 60 collateral tokens.
    assert.equal(collateralPaid, toWei("60"));

    // Push a different price to the new oracle to ensure the contract still uses the old price.
    await newMockOracle.requestPrice(priceTrackingIdentifier, expirationTime);
    await newMockOracle.pushPrice(priceTrackingIdentifier, expirationTime, toWei("0.8"));

    // Second token holder should receive the same payout as the first despite the oracle price being changed.
    initialCollateral = await collateral.balanceOf(other);
    await pricelessPositionManager.settleExpired({ from: other });
    collateralPaid = (await collateral.balanceOf(other)).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("120"));
  });

  it("Post expiration siphon", async function() {
    // Create one position with 100 synthetic tokens to mint with 150 tokens of collateral. For this test say the
    // collateral is Dai with a value of 1USD and the synthetic is some fictional stock or commodity.
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = toWei("50");
    await tokenCurrency.transfer(tokenHolder, tokenHolderTokens, {
      from: sponsor
    });

    // Siphon should revert if before the siphon delay.
    assert(await didContractThrow(pricelessPositionManager.siphonContractCollateral({ from: other })));

    // Advance time until after expiration. Token holders and sponsors should now be able to to settle.
    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + 1);

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    await pricelessPositionManager.expire({ from: other });

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price.
    await mockOracle.pushPrice(priceTrackingIdentifier, expirationTime.toNumber(), toWei("1.2"));

    // At this point, as it is post expiry,  token sponsor and token holder should be able to redeem their tokens.
    // Let the token sponsor withdraw their expected collateral however the token holder never redeems their tokens.
    await tokenCurrency.approve(pricelessPositionManager.address, amountCollateral, {
      from: sponsor
    });
    await pricelessPositionManager.settleExpired({ from: sponsor });

    // Siphon should revert if after the expired, but before the siphon delay.
    assert(await didContractThrow(pricelessPositionManager.siphonContractCollateral({ from: other })));

    // Advance time to after the siphon delay. Siphon should now work.
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + siphonDelay + 1);

    // The pricelessPositionManager should have the original collateral (150) - the amount withdrawn by the sponsor.
    // The net of this is that the pricelessPositionManager should have exactly the value unclaimed tokens from the token holder
    // denominated in collateral. The tokenHolder has 50 unclaimed tokens, valued at 1.2 Dai per token should yield: 50 * 1.2 = 60
    const ppmCollateralBefore = await collateral.balanceOf(pricelessPositionManager.address);
    assert.equal(ppmCollateralBefore.toString(), toWei("60"));

    // Grab the store balance from before. This is non-zero as fees have been accrued in previous tests.
    const storeCollateralBefore = await collateral.balanceOf(store.address);

    // Execute the siphon action. Anyone can call this
    await pricelessPositionManager.siphonContractCollateral({ from: other });

    // After the siphon is done the pricelessPositionManager should have 0 collateral left in it.
    const ppmCollateralAfter = await collateral.balanceOf(pricelessPositionManager.address);
    assert.equal(ppmCollateralAfter.toString(), 0);

    // The store should gain all of the pricelessPositionManager's collateral that was present before the siphon
    const storeCollateralAfter = await collateral.balanceOf(store.address);
    assert.equal(storeCollateralAfter.sub(storeCollateralBefore).toString(), ppmCollateralBefore.toString());

    // If the token holder tries to withdraw now they cant as it is post siphon.
    assert(await didContractThrow(pricelessPositionManager.settleExpired({ from: tokenHolder })));
  });

  it("Emergency shutdown: lifecycle", async function() {
    // Create one position with 100 synthetic tokens to mint with 150 tokens of collateral. For this test say the
    // collateral is Dai with a value of 1USD and the synthetic is some fictional stock or commodity.
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = toWei("50");
    await tokenCurrency.transfer(tokenHolder, tokenHolderTokens, { from: sponsor });

    // Some time passes and the UMA token holders decide that Emergency shutdown needs to occur.
    const shutdownTimestamp = expirationTimestamp - 1000;
    await pricelessPositionManager.setCurrentTime(shutdownTimestamp);

    // Should revert if emergency shutdown initialized by non-FinancialContractsAdmin (governor).
    assert(await didContractThrow(pricelessPositionManager.emergencyShutdown({ from: other })));

    // FinancialContractAdmin can initiate emergency shutdown.
    await financialContractsAdmin.callEmergencyShutdown(pricelessPositionManager.address);

    // Because the emergency shutdown is called by the `financialContractsAdmin`, listening for events can not
    // happen in the standard way as done in other tests. However, we can directly query the `pricelessPositionManager`
    // to see it's past events to ensure that the right parameters were emmited.
    const eventResult = await pricelessPositionManager.getPastEvents("EmergencyShutdown");
    assert.equal(eventResult[0].args.caller, financialContractsAdmin.address);
    assert.equal(eventResult[0].args.originalExpirationTimestamp.toString(), expirationTimestamp.toString());
    assert.equal(eventResult[0].args.shutdownTimestamp.toString(), shutdownTimestamp.toString());

    // Check contract state change correctly to requested oracle price and the contract expiration has updated.
    assert.equal(await pricelessPositionManager.contractState(), STATES.EXPIRED_PRICE_REQUESTED);
    assert.equal((await pricelessPositionManager.expirationTimestamp()).toString(), shutdownTimestamp.toString());

    // Emergency shutdown should not be able to be called a second time.
    assert(await didContractThrow(financialContractsAdmin.callEmergencyShutdown(pricelessPositionManager.address)));

    // Expire should not be able to be called as the contract has been emergency shutdown.
    assert(await didContractThrow(pricelessPositionManager.expire({ from: other })));

    // Before the DVM has resolved a price withdrawals should be disabled (as with settlement at maturity).
    assert(await didContractThrow(pricelessPositionManager.settleExpired({ from: sponsor })));

    // UMA token holders now vote to resolve of the price request to enable the emergency shutdown to continue.
    // Say they resolve to a price of 1.1 USD per synthetic token.
    await mockOracle.pushPrice(priceTrackingIdentifier, shutdownTimestamp, toWei("1.1"));

    // Token holders (`sponsor` and `tokenHolder`) should now be able to withdraw post emergency shutdown.
    // From the token holder's perspective, they are entitled to the value of their tokens, notated in the underlying.
    // They have 50 tokens settled at a price of 1.1 should yield 55 units of underling (or 55 USD as underlying is Dai).
    const tokenHolderInitialCollateral = await collateral.balanceOf(tokenHolder);
    const tokenHolderInitialSynthetic = await tokenCurrency.balanceOf(tokenHolder);
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.approve(pricelessPositionManager.address, tokenHolderInitialSynthetic, {
      from: tokenHolder
    });
    await pricelessPositionManager.settleExpired({ from: tokenHolder });
    const tokenHolderFinalCollateral = await collateral.balanceOf(tokenHolder);
    const tokenHolderFinalSynthetic = await tokenCurrency.balanceOf(tokenHolder);
    const expectedTokenHolderFinalCollateral = toWei("55");
    assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // If the tokenHolder tries to withdraw again they should get no additional tokens; all have been withdrawn (same as normal expiratory).
    const tokenHolderInitialCollateral_secondWithdrawal = await collateral.balanceOf(tokenHolder);
    const tokenHolderInitialSynthetic_secondWithdrawal = await tokenCurrency.balanceOf(tokenHolder);
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);
    await tokenCurrency.approve(pricelessPositionManager.address, tokenHolderInitialSynthetic, { from: tokenHolder });
    await pricelessPositionManager.settleExpired({ from: tokenHolder });
    const tokenHolderFinalCollateral_secondWithdrawal = await collateral.balanceOf(tokenHolder);
    const tokenHolderFinalSynthetic_secondWithdrawal = await tokenCurrency.balanceOf(tokenHolder);
    assert.equal(
      tokenHolderInitialCollateral_secondWithdrawal.toString(),
      tokenHolderFinalCollateral_secondWithdrawal.toString()
    );
    assert.equal(
      tokenHolderInitialSynthetic_secondWithdrawal.toString(),
      tokenHolderFinalSynthetic_secondWithdrawal.toString()
    );

    // For the sponsor, they are entitled to the underlying value of their remaining synthetic tokens + the excess collateral
    // in their position at time of settlement. The sponsor had 150 units of collateral in their position and the final TRV
    // of their synthetics they sold is 110. Their redeemed amount for this excess collateral is the difference between the two.
    // The sponsor also has 50 synthetic tokens that they did not sell.
    // This makes their expected redemption = 150 - 110 + 50 * 1.1 = 95
    const sponsorInitialCollateral = await collateral.balanceOf(sponsor);
    const sponsorInitialSynthetic = await tokenCurrency.balanceOf(sponsor);

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.approve(pricelessPositionManager.address, sponsorInitialSynthetic, {
      from: sponsor
    });
    await pricelessPositionManager.settleExpired({
      from: sponsor
    });
    const sponsorFinalCollateral = await collateral.balanceOf(sponsor);
    const sponsorFinalSynthetic = await tokenCurrency.balanceOf(sponsor);

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 150 - 100 * 1.1 = 30
    const expectedSponsorCollateralUnderlying = toBN(toWei("40"));
    // Value of remaining synthetic tokens = 50 * 1.1 = 55
    const expectedSponsorCollateralSynthetic = toBN(toWei("55"));
    const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
      expectedSponsorCollateralSynthetic
    );
    assert.equal(
      sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
      expectedTotalSponsorCollateralReturned
    );

    // The token Sponsor should have no synthetic positions left after settlement.
    assert.equal(sponsorFinalSynthetic, 0);
  });

  it("Emergency shutdown: reject emergency shutdown post expiratory", async function() {
    // Create one position with 100 synthetic tokens to mint with 150 tokens of collateral.
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor });

    // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + 1);

    // Emergency shutdown should revert as post expiration.
    assert(await didContractThrow(financialContractsAdmin.callEmergencyShutdown(pricelessPositionManager.address)));
  });
});
