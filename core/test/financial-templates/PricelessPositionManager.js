// Libraries and helpers
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");
const { PositionStatesEnum } = require("../../../common/Enums");
const { interfaceName } = require("../../utils/Constants.js");

// Contracts to test
const PricelessPositionManager = artifacts.require("PricelessPositionManager");

// Other UMA related contracts and mocks
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const MockOracle = artifacts.require("MockOracle");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MarginToken = artifacts.require("ExpandedERC20");
const TestnetERC20 = artifacts.require("TestnetERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const TokenFactory = artifacts.require("TokenFactory");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Timer = artifacts.require("Timer");

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
  let timer;

  // Initial constant values
  const initialPositionTokens = toBN(toWei("1000"));
  const initialPositionCollateral = toBN(toWei("1"));
  const syntheticName = "UMA test Token";
  const syntheticSymbol = "UMATEST";
  const withdrawalLiveness = 1000;
  const startTimestamp = Math.floor(Date.now() / 1000);
  const expirationTimestamp = startTimestamp + 10000;
  const priceFeedIdentifier = web3.utils.utf8ToHex("UMATEST");
  const minSponsorTokens = "5";

  // Conveniently asserts expected collateral and token balances, assuming that
  // there is only one synthetic token holder, the sponsor. Also assumes no
  // precision loss from `getCollateral()` coming from the fee multiplier.
  const checkBalances = async (expectedSponsorTokens, expectedSponsorCollateral) => {
    const expectedTotalTokens = expectedSponsorTokens.add(initialPositionTokens);
    const expectedTotalCollateral = expectedSponsorCollateral.add(initialPositionCollateral);

    const positionData = await pricelessPositionManager.positions(sponsor);
    const sponsorCollateral = await pricelessPositionManager.getCollateral(sponsor);
    assert.equal(sponsorCollateral.toString(), expectedSponsorCollateral.toString());
    // The below assertion only holds if the sponsor holds all of the tokens outstanding.
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
    collateral = await MarginToken.new("UMA", "UMA", 18, { from: collateralOwner });
    await collateral.addMember(1, collateralOwner, { from: collateralOwner });
    await collateral.mint(sponsor, toWei("1000000"), { from: collateralOwner });
    await collateral.mint(other, toWei("1000000"), { from: collateralOwner });

    store = await Store.deployed();
  });

  beforeEach(async function() {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    timer = await Timer.deployed();
    await timer.setCurrentTime(startTimestamp);

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, {
      from: contractDeployer
    });

    // Create a mockOracle and finder. Register the mockMoracle with the finder.
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.address, Timer.address, {
      from: contractDeployer
    });
    const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address, { from: contractDeployer });

    financialContractsAdmin = await FinancialContractsAdmin.deployed();

    // Create the instance of the PricelessPositionManager to test against.
    // The contract expires 10k seconds in the future -> will not expire during this test case.
    pricelessPositionManager = await PricelessPositionManager.new(
      expirationTimestamp, // _expirationTimestamp
      withdrawalLiveness, // _withdrawalLiveness
      collateral.address, // _collateralAddress
      Finder.address, // _finderAddress
      priceFeedIdentifier, // _priceFeedIdentifier
      syntheticName, // _syntheticName
      syntheticSymbol, // _syntheticSymbol
      TokenFactory.address, // _tokenFactoryAddress
      { rawValue: minSponsorTokens }, // _minSponsorTokens
      Timer.address, // _timerAddress
      { from: contractDeployer }
    );
    tokenCurrency = await SyntheticToken.at(await pricelessPositionManager.tokenCurrency());
  });

  it("Valid constructor params", async function() {
    // Expiration timestamp must be greater than contract current time.
    assert(
      await didContractThrow(
        PricelessPositionManager.new(
          startTimestamp, // _expirationTimestamp
          withdrawalLiveness, // _withdrawalLiveness
          collateral.address, // _collateralAddress
          Finder.address, // _finderAddress
          priceFeedIdentifier, // _priceFeedIdentifier
          syntheticName, // _syntheticName
          syntheticSymbol, // _syntheticSymbol
          TokenFactory.address, // _tokenFactoryAddress
          { rawValue: minSponsorTokens }, // _minSponsorTokens
          Timer.address, // _timerAddress
          { from: contractDeployer }
        )
      )
    );

    // Pricefeed identifier must be whitelisted.
    assert(
      await didContractThrow(
        PricelessPositionManager.new(
          expirationTimestamp, // _expirationTimestamp
          withdrawalLiveness, // _withdrawalLiveness
          collateral.address, // _collateralAddress
          Finder.address, // _finderAddress
          web3.utils.utf8ToHex("UNREGISTERED"), // _priceFeedIdentifier
          syntheticName, // _syntheticName
          syntheticSymbol, // _syntheticSymbol
          TokenFactory.address, // _tokenFactoryAddress
          { rawValue: minSponsorTokens }, // _minSponsorTokens
          Timer.address, // _timerAddress
          { from: contractDeployer }
        )
      )
    );
  });

  it("Correct deployment and variable assignment", async function() {
    // PricelessPosition variables
    assert.equal(await pricelessPositionManager.expirationTimestamp(), expirationTimestamp);
    assert.equal(await pricelessPositionManager.withdrawalLiveness(), withdrawalLiveness);
    assert.equal(await pricelessPositionManager.collateralCurrency(), collateral.address);
    assert.equal(await pricelessPositionManager.finder(), finder.address);
    assert.equal(hexToUtf8(await pricelessPositionManager.priceIdentifier()), hexToUtf8(priceFeedIdentifier));
    assert.equal(await pricelessPositionManager.contractState(), PositionStatesEnum.OPEN);

    // Synthetic token
    assert.equal(await tokenCurrency.name(), syntheticName);
    assert.equal(await tokenCurrency.symbol(), syntheticSymbol);

    // Reverts on bad constructor input (unknown identifier)
    assert(
      await didContractThrow(
        PricelessPositionManager.new(
          true, // _isTest (unchanged)
          expirationTimestamp, // _expirationTimestamp (unchanged)
          withdrawalLiveness, // _withdrawalLiveness (unchanged)
          collateral.address, // _collateralAddress (unchanged)
          finder.address, // _finderAddress (unchanged)
          web3.utils.utf8ToHex("UNKNOWN"), // Some identifier that the whitelist tracker does not know
          syntheticName, // _syntheticName (unchanged)
          syntheticSymbol, // _syntheticSymbol (unchanged)
          { rawValue: minSponsorTokens }, // _minSponsorTokens (unchanged)
          { from: contractDeployer }
        )
      )
    );
  });

  it("Withdrawal/Transfer liveness overflow", async function() {
    // Create a contract with a very large withdrawal liveness, i.e., withdrawal requests will never pass.
    const largeLiveness = toBN(2)
      .pow(toBN(256))
      .subn(10)
      .toString();
    pricelessPositionManager = await PricelessPositionManager.new(
      expirationTimestamp, // _expirationTimestamp
      largeLiveness.toString(), // _withdrawalLiveness
      collateral.address, // _collateralAddress
      Finder.address, // _finderAddress
      priceFeedIdentifier, // _priceFeedIdentifier
      syntheticName, // _syntheticName
      syntheticSymbol, // _syntheticSymbol
      TokenFactory.address, // _tokenFactoryAddress
      { rawValue: minSponsorTokens }, // _minSponsorTokens
      Timer.address, // _timerAddress
      { from: contractDeployer }
    );

    const initialSponsorTokens = toWei("100");
    const initialSponsorCollateral = toWei("150");
    await collateral.approve(pricelessPositionManager.address, initialSponsorCollateral, { from: sponsor });
    await pricelessPositionManager.create(
      { rawValue: initialSponsorCollateral },
      { rawValue: initialSponsorTokens },
      { from: sponsor }
    );
    // Withdrawal/Transfer requests should fail due to overflow.
    assert(
      await didContractThrow(
        pricelessPositionManager.requestWithdrawal({ rawValue: initialSponsorCollateral }, { from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.requestTransferPosition({ from: sponsor })));
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
    // Cannot deposit 0 collateral.
    assert(await didContractThrow(pricelessPositionManager.deposit({ rawValue: "0" }, { from: sponsor })));
    await pricelessPositionManager.deposit({ rawValue: depositCollateral }, { from: sponsor });
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Withdraw.
    const withdrawCollateral = toWei("20");
    expectedSponsorCollateral = expectedSponsorCollateral.sub(toBN(withdrawCollateral));
    let sponsorInitialBalance = await collateral.balanceOf(sponsor);
    // Cannot withdraw 0 collateral.
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: "0" }, { from: sponsor })));
    // Cannot withdraw more than balance. (The position currently has 150 + 50 collateral).
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("201") }, { from: sponsor })));
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

    // Check redeem return value and event.
    const redeem = pricelessPositionManager.redeem;
    const redeemedCollateral = await redeem.call({ rawValue: redeemTokens }, { from: sponsor });
    assert.equal(redeemedCollateral.toString(), expectedSponsorCollateral.toString());
    let redemptionResult = await redeem({ rawValue: redeemTokens }, { from: sponsor });
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
    redemptionResult = await pricelessPositionManager.redeem({ rawValue: redeemRemainingTokens }, { from: sponsor });
    truffleAssert.eventEmitted(redemptionResult, "Redeem", ev => {
      return (
        ev.sponsor == sponsor &&
        ev.collateralAmount == expectedSponsorCollateral.toString() &&
        ev.tokenAmount == redeemRemainingTokens.toString()
      );
    });
    truffleAssert.eventEmitted(redemptionResult, "EndedSponsorPosition", ev => {
      return ev.sponsor == sponsor;
    });

    sponsorFinalBalance = await collateral.balanceOf(sponsor);
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), expectedSponsorCollateral);
    await checkBalances(toBN("0"), toBN("0"));

    // Contract state should not have changed.
    assert.equal(await pricelessPositionManager.contractState(), PositionStatesEnum.OPEN);
  });

  it("Cannot instantly withdraw all of the collateral in the position", async function() {
    // Create an initial large and lowly collateralized pricelessPositionManager so that we can call `withdraw()`.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    // Create the initial pricelessPositionManager.
    const createTokens = toWei("100");
    const createCollateral = toWei("150");
    await collateral.approve(pricelessPositionManager.address, createCollateral, { from: sponsor });
    await pricelessPositionManager.create(
      { rawValue: createCollateral },
      { rawValue: createTokens },
      { from: sponsor }
    );

    // Cannot withdraw full collateral because the GCR check will always fail.
    assert(
      await didContractThrow(pricelessPositionManager.withdraw({ rawValue: createCollateral }, { from: sponsor }))
    );
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

    // Must request greater than 0 and less than full position's collateral.
    assert(await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: "0" }, { from: sponsor })));
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("151") }, { from: sponsor }))
    );

    // Cannot execute withdrawal request before a request is made.
    assert(await didContractThrow(pricelessPositionManager.withdrawPassedRequest({ from: sponsor })));

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

    // After time is up, execute the withdrawal request. Check event is emitted and return value is correct.
    await pricelessPositionManager.setCurrentTime(
      (await pricelessPositionManager.getCurrentTime()).toNumber() + withdrawalLiveness
    );
    const sponsorInitialBalance = await collateral.balanceOf(sponsor);
    const expectedSponsorFinalBalance = sponsorInitialBalance.add(toBN(withdrawalAmount));
    const withdrawPassedRequest = pricelessPositionManager.withdrawPassedRequest;
    let amountWithdrawn = await withdrawPassedRequest.call({ from: sponsor });
    assert.equal(amountWithdrawn.toString(), withdrawalAmount.toString());
    let resultWithdrawPassedRequest = await withdrawPassedRequest({ from: sponsor });
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

    // First withdrawal that should pass. Ensure event is emitted and return value is correct.
    const withdraw = pricelessPositionManager.withdraw;
    amountWithdrawn = await withdraw.call({ rawValue: toWei("1") }, { from: sponsor });
    assert.equal(amountWithdrawn.toString(), toWei("1"));
    const resultWithdraw = await withdraw({ rawValue: toWei("1") }, { from: sponsor });
    truffleAssert.eventEmitted(resultWithdraw, "Withdrawal", ev => {
      return ev.sponsor == sponsor && ev.collateralAmount.toString() == toWei("1");
    });

    await pricelessPositionManager.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor });
    await pricelessPositionManager.redeem({ rawValue: toWei("100") }, { from: sponsor });
    await checkBalances(toBN(initialSponsorTokens), expectedSponsorCollateral);

    // Can't cancel if no withdrawals pending.
    assert(await didContractThrow(pricelessPositionManager.cancelWithdrawal({ from: sponsor })));

    // Request to withdraw remaining collateral. Post-fees, this amount should get reduced to the remaining collateral.
    await pricelessPositionManager.requestWithdrawal(
      {
        rawValue: toWei("125")
      },
      { from: sponsor }
    );
    // Setting fees to 0.00001 per second will charge (0.00001 * 1000) = 0.01 or 1 % of the collateral.
    await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.00001") });
    await pricelessPositionManager.setCurrentTime(
      (await pricelessPositionManager.getCurrentTime()).toNumber() + withdrawalLiveness
    );
    resultWithdrawPassedRequest = await pricelessPositionManager.withdrawPassedRequest({ from: sponsor });
    truffleAssert.eventEmitted(resultWithdrawPassedRequest, "RequestWithdrawalExecuted", ev => {
      return ev.sponsor == sponsor && ev.collateralAmount == toWei("123.75").toString();
    });
    // @dev: Can't easily call `checkBalances(initialSponsorTokens, 0)` here because of the fee charged, which is also
    // charged on the lowly-collateralized collateral (whose sponsor is `other`).

    // Contract state should not have changed.
    assert.equal(await pricelessPositionManager.contractState(), PositionStatesEnum.OPEN);

    // Reset store state.
    await store.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" });
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

    // The "other" position has excess collateral, but that collateral can NOT be used to mint new tokens.
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: toWei("0.0001") }, { rawValue: toWei("1") }, { from: other })
      )
    );

    // For the "other" Position:
    // global collateralization ratio = (150 + 15 + 25) / (100 + 10 + 10) = 1.58333
    // To maintain 10 tokens, need at least 15.833 collateral => can withdraw from 25 down to 16 but not to 15.
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("10") }, { from: other })));
    await pricelessPositionManager.withdraw({ rawValue: toWei("9") }, { from: other });

    // GCR = (15 + 16) / (10 + 10) = 1.55.
    // `sponsor` has a CR of 1.5.
    // `other` has a CR of 1.6.
    // `sponsor` can create new tokens that are individually above 1.55, without needing to bring their whole
    // position up to 1.55. `other` can create new tokens below their current CR as long as the new tokens are above
    // GCR.
    await pricelessPositionManager.create({ rawValue: toWei("1.55") }, { rawValue: toWei("1") }, { from: sponsor });
    await pricelessPositionManager.create({ rawValue: toWei("1.55") }, { rawValue: toWei("1") }, { from: other });
  });

  it("Transfer position request", async function() {
    const startTime = await pricelessPositionManager.getCurrentTime();

    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    // Create the initial pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });
    assert.equal((await pricelessPositionManager.getCollateral(sponsor)).toString(), amountCollateral);
    assert.equal(
      (await pricelessPositionManager.positions(other)).rawCollateral.toString(),
      initialPositionCollateral.toString()
    );
    assert.equal((await pricelessPositionManager.positions(tokenHolder)).rawCollateral.toString(), "0");

    // Cannot execute or cancel a transfer before requesting one.
    assert(await didContractThrow(pricelessPositionManager.transferPositionPassedRequest(other, { from: sponsor })));
    assert(await didContractThrow(pricelessPositionManager.cancelTransferPosition({ from: sponsor })));

    // Request transfer. Check event is emitted.
    const resultRequest = await pricelessPositionManager.requestTransferPosition({ from: sponsor });
    truffleAssert.eventEmitted(resultRequest, "RequestTransferPosition", ev => {
      return ev.oldSponsor == sponsor;
    });

    // Cannot request another transfer while one is pending.
    assert(await didContractThrow(pricelessPositionManager.requestTransferPosition({ from: sponsor })));

    // Can't transfer before time is up.
    await pricelessPositionManager.setCurrentTime(startTime.toNumber() + withdrawalLiveness - 1);
    assert(
      await didContractThrow(pricelessPositionManager.transferPositionPassedRequest(tokenHolder, { from: sponsor }))
    );

    // Sponsor can cancel transfer. Ensure that event is emitted.
    const resultCancel = await pricelessPositionManager.cancelTransferPosition({ from: sponsor });
    truffleAssert.eventEmitted(resultCancel, "RequestTransferPositionCanceled", ev => {
      return ev.oldSponsor == sponsor;
    });

    // They can now request again.
    await pricelessPositionManager.requestTransferPosition({ from: sponsor });

    // Advance time through liveness.
    await pricelessPositionManager.setCurrentTime(
      (await pricelessPositionManager.getCurrentTime()).toNumber() + withdrawalLiveness
    );

    // Can't transfer if the target already has a pricelessPositionManager.
    assert(await didContractThrow(pricelessPositionManager.transferPositionPassedRequest(other, { from: sponsor })));

    // Can't transfer if there is a pending withdrawal request.
    await pricelessPositionManager.requestWithdrawal({ rawValue: toWei("1") }, { from: sponsor });
    assert(await didContractThrow(pricelessPositionManager.transferPositionPassedRequest(other, { from: sponsor })));
    await pricelessPositionManager.cancelWithdrawal({ from: sponsor });

    // Execute transfer to new sponsor. Check event is emitted.
    const result = await pricelessPositionManager.transferPositionPassedRequest(tokenHolder, { from: sponsor });
    truffleAssert.eventEmitted(result, "RequestTransferPositionExecuted", ev => {
      return ev.oldSponsor == sponsor && ev.newSponsor == tokenHolder;
    });
    truffleAssert.eventEmitted(result, "NewSponsor", ev => {
      return ev.sponsor == tokenHolder;
    });
    assert.equal((await pricelessPositionManager.positions(sponsor)).rawCollateral.toString(), toWei("0"));
    assert.equal((await pricelessPositionManager.getCollateral(tokenHolder)).toString(), amountCollateral);

    // Check that transfer-request related parameters in pricelessPositionManager are reset.
    const positionData = await pricelessPositionManager.positions(sponsor);
    assert.equal(positionData.transferPositionRequestPassTimestamp.toString(), 0);

    // Contract state should not have changed.
    assert.equal(await pricelessPositionManager.contractState(), PositionStatesEnum.OPEN);
  });

  it("Frozen when post expiry", async function() {
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

    // Even though the contract isn't expired yet, can't issue a withdrawal or transfer request that would expire beyond the position expiry time.
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("1") }, { from: sponsor }))
    );
    assert(await didContractThrow(pricelessPositionManager.requestTransferPosition({ from: sponsor })));

    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber());

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
    assert(await didContractThrow(pricelessPositionManager.requestTransferPosition({ from: sponsor })));
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: toWei("1") }, { from: sponsor })));
    assert(await didContractThrow(pricelessPositionManager.deposit({ rawValue: toWei("1") }, { from: sponsor })));
  });

  it("Settlement post expiry", async function() {
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
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber());

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    const expireResult = await pricelessPositionManager.expire({ from: other });
    assert.equal(await pricelessPositionManager.contractState(), PositionStatesEnum.EXPIRED_PRICE_REQUESTED);
    truffleAssert.eventEmitted(expireResult, "ContractExpired", ev => {
      return ev.caller == other;
    });

    // Settling an expired position should revert if the contract has expired but the DVM has not yet returned a price.
    assert(await didContractThrow(pricelessPositionManager.settleExpired({ from: tokenHolder })));

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
    const redemptionPrice = 1.2;
    const redemptionPriceWei = toWei(redemptionPrice.toString());
    await mockOracle.pushPrice(priceFeedIdentifier, expirationTime.toNumber(), redemptionPriceWei);

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
    assert.equal(await pricelessPositionManager.contractState(), PositionStatesEnum.EXPIRED_PRICE_RECEIVED);
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

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 150 - 100 * 1.2 = 30
    const expectedSponsorCollateralUnderlying = toBN(toWei("30"));
    // Value of remaining synthetic tokens = 50 * 1.2 = 60
    const expectedSponsorCollateralSynthetic = toBN(toWei("60"));
    const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
      expectedSponsorCollateralSynthetic
    );

    // Check return value.
    const settleExpired = pricelessPositionManager.settleExpired;
    const redeemedAmount = await settleExpired.call({ from: sponsor });
    assert.equal(redeemedAmount.toString(), expectedTotalSponsorCollateralReturned.toString());

    // Execute the settlement and check balances.
    settleExpiredResult = await settleExpired({ from: sponsor });
    const sponsorFinalCollateral = await collateral.balanceOf(sponsor);
    const sponsorFinalSynthetic = await tokenCurrency.balanceOf(sponsor);
    assert.equal(
      sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
      expectedTotalSponsorCollateralReturned
    );

    // Check events.
    truffleAssert.eventEmitted(settleExpiredResult, "EndedSponsorPosition", ev => {
      return ev.sponsor == sponsor;
    });

    // The token Sponsor should have no synthetic positions left after settlement.
    assert.equal(sponsorFinalSynthetic, 0);

    // Last check is that after redemption the position in the positions mapping has been removed.
    const sponsorsPosition = await pricelessPositionManager.positions(sponsor);
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.requestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
  });

  it("Non sponsor can't deposit, redeem, withdraw, or transfer", async function() {
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

    // Can't request a withdrawal or transfer without first creating a pricelessPositionManager.
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("0") }, { from: sponsor }))
    );
    assert(await didContractThrow(pricelessPositionManager.requestTransferPosition({ from: sponsor })));

    // Even if the "sponsor" acquires a token somehow, they can't redeem.
    await tokenCurrency.transfer(sponsor, toWei("1"), { from: other });
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: toWei("1") }, { from: sponsor })));
  });

  it("Can't redeem more than position size", async function() {
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

  it("Non sponsor can use depositTo", async function() {
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: other });
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });

    const numTokens = toWei("1");
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: numTokens }, { from: sponsor });

    // Other makes a deposit to the sponsor's account.
    await pricelessPositionManager.depositTo(sponsor, { rawValue: toWei("1") }, { from: other });

    assert.equal((await pricelessPositionManager.getCollateral(sponsor)).toString(), toWei("2"));
    assert.equal((await pricelessPositionManager.getCollateral(other)).toString(), "0");
  });

  it("Existing sponsor can use depositTo on other account", async function() {
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: other });
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });

    const numTokens = toWei("1");
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: numTokens }, { from: other });
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: numTokens }, { from: sponsor });

    // Other makes a deposit to the sponsor's account despite having their own position.
    await pricelessPositionManager.depositTo(sponsor, { rawValue: toWei("1") }, { from: other });

    assert.equal((await pricelessPositionManager.getCollateral(sponsor)).toString(), toWei("2"));
    assert.equal((await pricelessPositionManager.getCollateral(other)).toString(), toWei("1"));
  });

  it("Sponsor use depositTo on own account", async function() {
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });

    const numTokens = toWei("1");
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: numTokens }, { from: sponsor });

    // Sponsor makes a deposit to their own account.
    await pricelessPositionManager.depositTo(sponsor, { rawValue: toWei("1") }, { from: sponsor });

    assert.equal((await pricelessPositionManager.getCollateral(sponsor)).toString(), toWei("2"));
  });

  it("Basic fees", async function() {
    // Set up position.
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: other });
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });

    // Set up another position that is less collateralized so sponsor can withdraw freely.
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: toWei("100000") }, { from: other });
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }, { from: sponsor });

    // Set store fees to 1% per second.
    await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.01") });

    // Move time in the contract forward by 1 second to capture a 1% fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));

    // Determine the expected store balance by adding 1% of the sponsor balance to the starting store balance.
    // Multiply by 2 because there are two active positions
    const expectedStoreBalance = (await collateral.balanceOf(store.address)).add(toBN(toWei("0.02")));

    // Pay the fees, check the return value, and then check the collateral and the store balance.
    const payRegularFees = pricelessPositionManager.payRegularFees;
    const feesPaid = await payRegularFees.call();
    assert.equal(feesPaid.toString(), toWei("0.02"));
    const payFeesResult = await payRegularFees();
    truffleAssert.eventEmitted(payFeesResult, "RegularFeesPaid", ev => {
      return ev.regularFee.toString() === toWei("0.02") && ev.lateFee.toString() === "0";
    });
    let collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    assert.equal(collateralAmount.rawValue.toString(), toWei("0.99"));
    assert.equal((await collateral.balanceOf(store.address)).toString(), expectedStoreBalance.toString());

    // Calling `payRegularFees()` more than once in the same block does not emit a RegularFeesPaid event.
    const feesPaidRepeat = await payRegularFees.call();
    assert.equal(feesPaidRepeat.toString(), "0");
    const payFeesRepeatResult = await payRegularFees();
    truffleAssert.eventNotEmitted(payFeesRepeatResult, "RegularFeesPaid");

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

    // Ensure that the maximum fee % of pfc charged is 100%. Advance > 100 seconds from the last payment time to attempt to
    // pay > 100% fees on the PfC. This should pay a maximum of 100% of the PfC without reverting.
    const pfc = await pricelessPositionManager.pfc();
    const feesOwed = (
      await store.computeRegularFee(startTime.addn(1), startTime.addn(102), { rawValue: pfc.toString() })
    ).regularFee;
    assert(Number(pfc.toString()) < Number(feesOwed.toString()));
    const farIntoTheFutureSeconds = 502;
    await pricelessPositionManager.setCurrentTime(startTime.addn(farIntoTheFutureSeconds));
    const payTooManyFeesResult = await pricelessPositionManager.payRegularFees();
    truffleAssert.eventEmitted(payTooManyFeesResult, "RegularFeesPaid", ev => {
      // There should be 98.99 + 0.99 = 99.98 collateral remaining in the contract.
      return ev.regularFee.toString() === toWei("99.98") && ev.lateFee.toString() === "0";
    });
    assert.equal((await pricelessPositionManager.getCollateral(sponsor)).toString(), "0");

    // TODO: Add unit tests for when the latePenalty > 0 but (latePenalty + regularFee > pfc). The component fees need to be reduced properly.

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" });

    // Check that no event is fired if the fees owed are 0.
    await pricelessPositionManager.setCurrentTime(startTime.addn(farIntoTheFutureSeconds + 1));
    const payZeroFeesResult = await payRegularFees();
    truffleAssert.eventNotEmitted(payZeroFeesResult, "RegularFeesPaid");
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
    const expirationResult = await pricelessPositionManager.expire({ from: other });

    // Check that final fees were paid correctly and position's locked collateral was decremented
    truffleAssert.eventEmitted(expirationResult, "FinalFeesPaid", ev => {
      return ev.amount.toString() === finalFeePaid.toString();
    });
    let collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    assert.equal(collateralAmount.rawValue.toString(), toWei("99"));
    assert.equal((await collateral.balanceOf(store.address)).toString(), expectedStoreBalance.toString());

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
    const redemptionPrice = 1.2;
    const redemptionPriceWei = toWei(redemptionPrice.toString());
    await mockOracle.pushPrice(priceFeedIdentifier, expirationTime.toNumber(), redemptionPriceWei);

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
    assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.setFinalFee(collateral.address, { rawValue: "0" });
  });

  describe("Precision loss is handled as expected", () => {
    beforeEach(async () => {
      // Create a new position with:
      // - 30 collateral
      // - 20 synthetic tokens (10 held by token holder, 10 by sponsor)
      await collateral.approve(pricelessPositionManager.address, "100000", { from: sponsor });
      const numTokens = "20";
      const amountCollateral = "30";
      await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });
      await tokenCurrency.approve(pricelessPositionManager.address, numTokens, { from: sponsor });

      // Setting the regular fee to 4 % per second will result in a miscalculated cumulativeFeeMultiplier after 1 second
      // because of the intermediate calculation in `payRegularFees()` for calculating the `feeAdjustment`: ( fees paid ) / (total collateral)
      // = 0.033... repeating, which cannot be represented precisely by a fixed point.
      // --> 0.04 * 30 wei = 1.2 wei, which gets truncated to 1 wei, so 1 wei of fees are paid
      const regularFee = toWei("0.04");
      await store.setFixedOracleFeePerSecondPerPfc({ rawValue: regularFee });

      // Advance the contract one second and make the contract pay its regular fees
      let startTime = await pricelessPositionManager.getCurrentTime();
      await pricelessPositionManager.setCurrentTime(startTime.addn(1));
      await pricelessPositionManager.payRegularFees();

      // Set the store fees back to 0 to prevent fee multiplier from changing for remainder of the test.
      await store.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" });
    });
    it("Fee multiplier is set properly with precision loss, and fees are paid as expected", async () => {
      // Absent any rounding errors, `getCollateral` should return (initial-collateral - final-fees) = 30 wei - 1 wei = 29 wei.
      // But, because of the use of mul and div in payRegularFees(), getCollateral() will return slightly less
      // collateral than expected. When calculating the new `feeAdjustment`, we need to calculate the %: (fees paid / pfc), which is
      // 1/30. However, 1/30 = 0.03333... repeating, which cannot be represented in FixedPoint. Normally div() would floor
      // this value to 0.033....33, but divCeil sets this to 0.033...34. A higher `feeAdjustment` causes a lower `adjustment` and ultimately
      // lower `totalPositionCollateral` and `positionAdjustment` values.
      let collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
      assert(toBN(collateralAmount.rawValue).lt(toBN("29")));
      assert.equal(
        (await pricelessPositionManager.cumulativeFeeMultiplier()).toString(),
        toWei("0.966666666666666666").toString()
      );

      // The actual amount of fees paid to the store is as expected = 1 wei.
      // At this point, the store should have +1 wei, the contract should have 29 wei but the position will show 28 wei
      // because `(30 * 0.966666666666666666 = 28.999...98)`. `30` is the rawCollateral and if the fee multiplier were correct,
      // then `totalPositionCollateral` would be `(30 * 0.966666666666666666...) = 29`.
      assert.equal((await collateral.balanceOf(pricelessPositionManager.address)).toString(), "29");
      assert.equal((await pricelessPositionManager.totalPositionCollateral()).toString(), "28");
      assert.equal((await pricelessPositionManager.rawTotalPositionCollateral()).toString(), "30");
    });
    it("settleExpired() returns the same amount of collateral that totalPositionCollateral is decreased by", async () => {
      // Expire the contract
      const expirationTime = await pricelessPositionManager.expirationTimestamp();
      await pricelessPositionManager.setCurrentTime(expirationTime.toNumber());
      await pricelessPositionManager.expire({ from: other });

      // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
      // feed. With 20 units of outstanding tokens this results in a token redemption value of: TRV = 20 * 1.2 = 24 USD.
      const redemptionPrice = 1.2;
      const redemptionPriceWei = toWei(redemptionPrice.toString());
      await mockOracle.pushPrice(priceFeedIdentifier, expirationTime.toNumber(), redemptionPriceWei);

      // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
      const tokenHolderTokens = "10";
      await tokenCurrency.transfer(tokenHolder, tokenHolderTokens, {
        from: sponsor
      });
      await tokenCurrency.approve(pricelessPositionManager.address, tokenHolderTokens, {
        from: tokenHolder
      });

      // The token holder is entitled to the value of their tokens, notated in the underlying.
      // They have 10 tokens settled at a price of 1.2 should yield 12 units of collateral.
      // So, `rawCollateral` is decreased by (`12 / 0.966666666666666666 ~= 12.4`) which gets truncated to 12.
      // Before `settleExpired` is called, `totalPositionCollateral = rawCollateral * cumulativeFeeMultiplier = 30 * 0.966666666666666666 = 28`.
      // After `settleExpired`, `rawCollateral -= 12`, so the new `totalPositionCollateral = `(30-12) * 0.966666666666666666 = 17.4` which is truncated to 17.
      // So, due to precision loss, `totalPositionCollateral` is only decreased by 11, but it should be 12 without errors.
      // From the user's POV, they will see their balance decrease by 11, so we should send them 11 collateral not 12.
      const tokenHolderInitialCollateral = await collateral.balanceOf(tokenHolder);
      await pricelessPositionManager.settleExpired({ from: tokenHolder });
      const tokenHolderFinalCollateral = await collateral.balanceOf(tokenHolder);
      const tokenHolderFinalSynthetic = await tokenCurrency.balanceOf(tokenHolder);

      // The token holder should gain the value of their synthetic tokens in underlying.
      const expectedTokenHolderFinalCollateral = "11";
      assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);
      assert.equal((await collateral.balanceOf(pricelessPositionManager.address)).toString(), "18");
      assert.equal((await pricelessPositionManager.totalPositionCollateral()).toString(), "17");
      assert.equal((await pricelessPositionManager.rawTotalPositionCollateral()).toString(), "18");

      // The token holder should have no synthetic positions left after settlement.
      assert.equal(tokenHolderFinalSynthetic, 0);

      // The sponsor is entitled to the underlying value of their remaining synthetic tokens + the excess collateral
      // in their position at time of settlement - final fees. But we'll see that the "excess" collateral displays error
      // due to precision loss.
      const sponsorInitialCollateral = await collateral.balanceOf(sponsor);
      await pricelessPositionManager.settleExpired({ from: sponsor });
      const sponsorFinalCollateral = await collateral.balanceOf(sponsor);
      const sponsorFinalSynthetic = await tokenCurrency.balanceOf(sponsor);

      // The token Sponsor should gain the value of their synthetics in underlying
      // + their excess collateral from the over collateralization in their position.
      // Excess collateral should be = rawCollateral - fees - tokensOutstanding * price = 30 - 1 - (20 * 1.2) = 5
      // However, recall that `totalPositionCollateral = (30 * 0.966666666666666666 = 28.999...98)` which gets truncated to 28.
      // So, the excess collateral becomes 28 - (20 * 1.2) = 4
      // The value of the remaining synthetic tokens = 10 * 1.2 = 12.
      // So, we will attempt to withdraw (12 + 4) tokens from the contract.
      // We need to decrease `rawCollateral` by `16 / 0.966666666666666666 ~= 16.5`
      // which gets truncated to 16.
      // Recall previously that rawCollateral was last set to 18, so `totalPositionCollateral = (18-16) * 0.966666666666666666 ~= 1.97`
      // which gets truncated to 1.
      // The previous totalPositionCollateral was 17, so we will withdraw (17-1) = 16 tokens instead of the 17 as the user expected.
      assert.equal((await pricelessPositionManager.totalPositionCollateral()).toString(), "1");
      assert.equal((await pricelessPositionManager.rawTotalPositionCollateral()).toString(), "2");
      const expectedSponsorCollateralSynthetic = toBN("11");
      const expectedSponsorCollateralUnderlying = toBN("5");
      const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
        expectedSponsorCollateralSynthetic
      );
      assert.equal(
        sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
        expectedTotalSponsorCollateralReturned.toString()
      );

      // The token Sponsor should have no synthetic positions left after settlement.
      assert.equal(sponsorFinalSynthetic, 0);

      // The contract should have a small remainder of 2 collateral tokens due to rounding errors:
      // We started with 30, paid 1 in final fees, returned 11 to the token holder, and 16 to the sponsor:
      // (30 - 1 - 11 - 16 = 2)
      assert.equal((await collateral.balanceOf(pricelessPositionManager.address)).toString(), "2");
      assert.equal((await pricelessPositionManager.totalPositionCollateral()).toString(), "1");

      // Last check is that after redemption the position in the positions mapping is still removed despite leaving collateral dust.
      const sponsorsPosition = await pricelessPositionManager.positions(sponsor);
      assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
      assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
      assert.equal(sponsorsPosition.requestPassTimestamp.toString(), 0);
      assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
      assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
    });
    it("withdraw() returns the same amount of collateral that totalPositionCollateral is decreased by", async () => {
      // The sponsor requests to withdraw 12 collateral.
      // So, `rawCollateral` is decreased by (`12 / 0.966666666666666666 ~= 12.4`) which gets truncated to 12.
      // Before `withdraw` is called, `totalPositionCollateral = rawCollateral * cumulativeFeeMultiplier = 30 * 0.966666666666666666 = 28`.
      // After `settleExpired`, `rawCollateral -= 12`, so the new `totalPositionCollateral = `(30-12) * 0.966666666666666666 = 17.4` which is truncated to 17.
      // So, due to precision loss, `totalPositionCollateral` is only decreased by 11, but it should be 12 without errors.
      // From the user's POV, they will see their balance decrease by 11, so we should send them 11 collateral not 12.
      const initialCollateral = await collateral.balanceOf(sponsor);
      await pricelessPositionManager.requestWithdrawal({ rawValue: "12" }, { from: sponsor });
      startTime = await pricelessPositionManager.getCurrentTime();
      await pricelessPositionManager.setCurrentTime(startTime.addn(withdrawalLiveness));
      await pricelessPositionManager.withdrawPassedRequest({ from: sponsor });
      const finalCollateral = await collateral.balanceOf(sponsor);

      // The sponsor should gain their requested amount minus precision loss.
      const expectedFinalCollateral = "11";
      assert.equal(finalCollateral.sub(initialCollateral), expectedFinalCollateral);
      assert.equal((await collateral.balanceOf(pricelessPositionManager.address)).toString(), "18");
      assert.equal((await pricelessPositionManager.totalPositionCollateral()).toString(), "17");
      assert.equal((await pricelessPositionManager.rawTotalPositionCollateral()).toString(), "18");
    });
    it("redeem() returns the same amount of collateral that totalPositionCollateral is decreased by", async () => {
      // The sponsor requests to redeem 9 tokens. (9/20 = 0.45) tokens should result in a proportional redemption of the totalPositionCollateral,
      // which as you recall is 28 post-fees. So, we expect to redeem (0.45 * 28 = 12.6) collateral which gets truncated to 12.
      // So, `rawCollateral` is decreased by (`12 / 0.966666666666666666 ~= 12.4`) which gets truncated to 12.
      // Before `withdraw` is called, `totalPositionCollateral = rawCollateral * cumulativeFeeMultiplier = 30 * 0.966666666666666666 = 28`.
      // After `settleExpired`, `rawCollateral -= 12`, so the new `totalPositionCollateral = `(30-12) * 0.966666666666666666 = 17.4` which is truncated to 17.
      // So, due to precision loss, `totalPositionCollateral` is only decreased by 11, but it should be 12 without errors.
      // From the user's POV, they will see their balance decrease by 11, so we should send them 11 collateral not 12.
      const initialCollateral = await collateral.balanceOf(sponsor);
      await pricelessPositionManager.redeem({ rawValue: "9" }, { from: sponsor });
      const finalCollateral = await collateral.balanceOf(sponsor);

      // The sponsor should gain their requested amount minus precision loss.
      assert.equal(finalCollateral.sub(initialCollateral), "11");
      assert.equal((await collateral.balanceOf(pricelessPositionManager.address)).toString(), "18");
      assert.equal((await pricelessPositionManager.totalPositionCollateral()).toString(), "17");
      assert.equal((await pricelessPositionManager.rawTotalPositionCollateral()).toString(), "18");

      // Expected number of synthetic tokens are burned.
      assert.equal((await tokenCurrency.balanceOf(sponsor)).toString(), "11");
    });
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
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber());

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
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber());

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    await pricelessPositionManager.expire({ from: other });

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 200 units of outstanding tokens this results in a token redemption value of: TRV = 200 * 1.2 = 240 USD.
    await mockOracle.pushPrice(priceFeedIdentifier, expirationTime, toWei("1.2"));

    // Token holder should receive 120 collateral tokens for their 100 synthetic tokens.
    let initialCollateral = await collateral.balanceOf(tokenHolder);
    await pricelessPositionManager.settleExpired({ from: tokenHolder });
    let collateralPaid = (await collateral.balanceOf(tokenHolder)).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("120"));

    // Create new oracle, replace it in the finder, and push a different price to it.
    const newMockOracle = await MockOracle.new(finder.address, Timer.address);
    const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
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
    await newMockOracle.requestPrice(priceFeedIdentifier, expirationTime);
    await newMockOracle.pushPrice(priceFeedIdentifier, expirationTime, toWei("0.8"));

    // Second token holder should receive the same payout as the first despite the oracle price being changed.
    initialCollateral = await collateral.balanceOf(other);
    await pricelessPositionManager.settleExpired({ from: other });
    collateralPaid = (await collateral.balanceOf(other)).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("120"));
  });

  it("Undercapitalized contract", async function() {
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: other });
    await tokenCurrency.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await tokenCurrency.approve(pricelessPositionManager.address, toWei("100000"), { from: other });
    await tokenCurrency.approve(pricelessPositionManager.address, toWei("100000"), { from: tokenHolder });

    // Create one undercapitalized sponsor and one overcollateralized sponsor.
    await pricelessPositionManager.create({ rawValue: toWei("50") }, { rawValue: toWei("100") }, { from: sponsor });
    await pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: other });

    // Transfer 150 tokens to the token holder and leave the overcollateralized sponsor with 25.
    await tokenCurrency.transfer(tokenHolder, toWei("75"), { from: other });
    await tokenCurrency.transfer(tokenHolder, toWei("75"), { from: sponsor });

    // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber());
    await pricelessPositionManager.expire({ from: other });

    // Settle the price to 1, meaning the overcollateralized sponsor has 50 units of excess collateral.
    await mockOracle.pushPrice(priceFeedIdentifier, expirationTime, toWei("1"));

    // Token holder is the first to settle -- they should receive the entire value of their tokens (100) because they
    // were first.
    let startingBalance = await collateral.balanceOf(tokenHolder);
    await pricelessPositionManager.settleExpired({ from: tokenHolder });
    assert.equal((await collateral.balanceOf(tokenHolder)).toString(), startingBalance.add(toBN(toWei("150"))));

    // The overcollateralized sponsor should see a haircut because they settled later.
    // The overcollateralized sponsor is owed 75 because of the 50 in excess collateral and the 25 in tokens.
    // But there's only 50 left in the contract, so we should see only 50 paid out.
    startingBalance = await collateral.balanceOf(other);
    await pricelessPositionManager.settleExpired({ from: other });
    assert.equal((await collateral.balanceOf(other)).toString(), startingBalance.add(toBN(toWei("50"))));

    // The undercapitalized sponsor should get nothing even though they have tokens because the contract has no more collateral.
    startingBalance = await collateral.balanceOf(sponsor);
    await pricelessPositionManager.settleExpired({ from: sponsor });
    assert.equal((await collateral.balanceOf(sponsor)).toString(), startingBalance.add(toBN("0")));
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
    assert.equal(await pricelessPositionManager.contractState(), PositionStatesEnum.EXPIRED_PRICE_REQUESTED);

    // Because the emergency shutdown is called by the `financialContractsAdmin`, listening for events can not
    // happen in the standard way as done in other tests. However, we can directly query the `pricelessPositionManager`
    // to see it's past events to ensure that the right parameters were emmited.
    const eventResult = await pricelessPositionManager.getPastEvents("EmergencyShutdown");
    assert.equal(eventResult[0].args.caller, financialContractsAdmin.address);
    assert.equal(eventResult[0].args.originalExpirationTimestamp.toString(), expirationTimestamp.toString());
    assert.equal(eventResult[0].args.shutdownTimestamp.toString(), shutdownTimestamp.toString());

    // Check contract state change correctly to requested oracle price and the contract expiration has updated.
    assert.equal(await pricelessPositionManager.contractState(), PositionStatesEnum.EXPIRED_PRICE_REQUESTED);
    assert.equal((await pricelessPositionManager.expirationTimestamp()).toString(), shutdownTimestamp.toString());

    // Emergency shutdown should not be able to be called a second time.
    assert(await didContractThrow(financialContractsAdmin.callEmergencyShutdown(pricelessPositionManager.address)));

    // Expire should not be able to be called as the contract has been emergency shutdown.
    assert(await didContractThrow(pricelessPositionManager.expire({ from: other })));

    // Before the DVM has resolved a price withdrawals should be disabled (as with settlement at maturity).
    assert(await didContractThrow(pricelessPositionManager.settleExpired({ from: sponsor })));

    // UMA token holders now vote to resolve of the price request to enable the emergency shutdown to continue.
    // Say they resolve to a price of 1.1 USD per synthetic token.
    await mockOracle.pushPrice(priceFeedIdentifier, shutdownTimestamp, toWei("1.1"));

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
    assert.equal(await pricelessPositionManager.contractState(), PositionStatesEnum.EXPIRED_PRICE_RECEIVED);
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
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber());

    // Emergency shutdown should revert as post expiration.
    assert(await didContractThrow(financialContractsAdmin.callEmergencyShutdown(pricelessPositionManager.address)));
  });

  it("Cannot create position smaller than min sponsor size", async function() {
    // Attempt to create position smaller than 5 wei tokens (the min sponsor position size)
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });

    assert(
      await didContractThrow(pricelessPositionManager.create({ rawValue: "40" }, { rawValue: "4" }, { from: sponsor }))
    );
  });

  it("Cannot reduce position size below min sponsor size", async function() {
    // Attempt to redeem a position smaller s.t. the resulting position is less than 5 wei tokens (the min sponsor
    // position size)
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });

    await pricelessPositionManager.create({ rawValue: "40" }, { rawValue: "20" }, { from: sponsor });

    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: "16" }, { from: sponsor })));
  });

  it("Non-standard ERC20 delimitation", async function() {
    // To test non-standard ERC20 token delimitation a new ERC20 token is created which has 6 decimal points of precision.
    // A new priceless position manager is then created and and set to use this token as collateral. To generate values
    // which represent the appropriate scaling for USDC, .muln(1e6) is used over toWei as the latter scaled by 1e18.

    // Create a test net token with non-standard delimitation like USDC (6 decimals) and mint tokens.
    const USDCToken = await TestnetERC20.new("USDC", "USDC", 6);
    await USDCToken.allocateTo(sponsor, toWei("100"));

    let customPricelessPositionManager = await PricelessPositionManager.new(
      expirationTimestamp, // _expirationTimestamp
      withdrawalLiveness, // _withdrawalLiveness
      USDCToken.address, // _collateralAddress
      Finder.address, // _finderAddress
      priceFeedIdentifier, // _priceFeedIdentifier
      syntheticName, // _syntheticName
      syntheticSymbol, // _syntheticSymbol
      TokenFactory.address, // _tokenFactoryAddress
      { rawValue: minSponsorTokens }, // _minSponsorTokens
      Timer.address, // _timerAddress
      { from: contractDeployer }
    );
    tokenCurrency = await SyntheticToken.at(await customPricelessPositionManager.tokenCurrency());
    // Create the initial customPricelessPositionManager position. 100 synthetics backed by 150 collat
    const createTokens = toWei("100"); // the tokens we want to create are still delimited by 1e18

    // however the collateral is now delimited by a different number of decimals. 150 * 1e6
    const createCollateral = toBN("150")
      .muln(1e6)
      .toString();
    let expectedSponsorTokens = toBN(createTokens);
    let expectedContractCollateral = toBN(createCollateral);

    await USDCToken.approve(customPricelessPositionManager.address, createCollateral, { from: sponsor });
    await customPricelessPositionManager.create(
      { rawValue: createCollateral },
      { rawValue: createTokens },
      { from: sponsor }
    );

    // The balances minted should equal that expected from the create function.
    assert.equal(
      (await USDCToken.balanceOf(customPricelessPositionManager.address)).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal((await tokenCurrency.balanceOf(sponsor)).toString(), expectedSponsorTokens.toString());

    // Deposit an additional 50 USDC to the position. Sponsor now has 200 USDC as collateral.
    const depositCollateral = toBN("50")
      .muln(1e6)
      .toString();
    expectedContractCollateral = expectedContractCollateral.add(toBN(depositCollateral));
    await USDCToken.approve(customPricelessPositionManager.address, depositCollateral, { from: sponsor });
    await customPricelessPositionManager.deposit({ rawValue: depositCollateral }, { from: sponsor });

    // The balances should reflect the additional collateral added.
    assert.equal(
      (await USDCToken.balanceOf(customPricelessPositionManager.address)).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal((await tokenCurrency.balanceOf(sponsor)).toString(), expectedSponsorTokens.toString());
    assert.equal(
      (await customPricelessPositionManager.getCollateral(sponsor)).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal(
      (await customPricelessPositionManager.positions(sponsor)).tokensOutstanding.toString(),
      expectedSponsorTokens.toString()
    );
    assert.equal(
      (await customPricelessPositionManager.totalPositionCollateral()).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal(
      (await customPricelessPositionManager.totalTokensOutstanding()).toString(),
      expectedSponsorTokens.toString()
    );

    // The key with non-standard ERC20 delimitation is how the oracle responds to requests.
    // The two cases that need to be tested are responding to dispute requests and settlement.
    // Dispute and liquidation is tested in `Liquidatable.js`. Here we test settlement.

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    // Sponsor now has 50 synthetics and 200 collateral. Note that synthetic tokens are still represented with 1e18 base.
    const tokenHolderTokens = toWei("50");
    await tokenCurrency.transfer(tokenHolder, tokenHolderTokens, {
      from: sponsor
    });

    // Advance time until expiration. Token holders and sponsors should now be able to settle.
    const expirationTime = await customPricelessPositionManager.expirationTimestamp();
    await customPricelessPositionManager.setCurrentTime(expirationTime.toNumber());

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    await customPricelessPositionManager.expire({ from: other });

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
    // Note that due to scaling the price is scaled by 1e6 to accommodate the value of the stock denominated in USDC.
    const redemptionPrice = toBN(1200000); // 1.2*1e6. a price of 1.2 denominated in USD scaling.
    await mockOracle.pushPrice(priceFeedIdentifier, expirationTime.toNumber(), redemptionPrice.toString());

    // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
    // They have 50 tokens settled at a price of 1.2 should yield 60 units of underling (or 60 USD as underlying is Dai).
    const tokenHolderInitialCollateral = await USDCToken.balanceOf(tokenHolder);
    const tokenHolderInitialSynthetic = await tokenCurrency.balanceOf(tokenHolder);
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.approve(customPricelessPositionManager.address, tokenHolderInitialSynthetic, {
      from: tokenHolder
    });
    let settleExpiredResult = await customPricelessPositionManager.settleExpired({ from: tokenHolder });
    const tokenHolderFinalCollateral = await USDCToken.balanceOf(tokenHolder);
    const tokenHolderFinalSynthetic = await tokenCurrency.balanceOf(tokenHolder);

    // The token holder should gain the value of their synthetic tokens in underlying.
    // The value in underlying is the number of tokens they held in the beginning * settlement price as TRV
    // When redeeming 50 tokens at a price of 1.2 we expect to receive 60 collateral tokens (50 * 1.2)
    // This should be denominated in units of USDC and as such again scaled by 1e6
    const expectedTokenHolderFinalCollateral = toBN("60").muln(1e6);
    assert.equal(
      tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral).toString(),
      expectedTokenHolderFinalCollateral.toString()
    );

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
    // in their position at time of settlement. The sponsor had 200 units of collateral in their position and the final TRV
    // of their synthetics they drew is 120 (100*1.2). Their redeemed amount for this excess collateral is the difference between the two.
    // The sponsor also has 50 synthetic tokens that they did not sell valued at 1.2 per token.
    // This makes their expected redemption = 200 (collat) - 100 * 1.2 (debt) + 50 * 1.2 (synth returned) = 140 in e16 USDC
    const sponsorInitialCollateral = await USDCToken.balanceOf(sponsor);
    const sponsorInitialSynthetic = await tokenCurrency.balanceOf(sponsor);

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.approve(customPricelessPositionManager.address, sponsorInitialSynthetic, {
      from: sponsor
    });
    await customPricelessPositionManager.settleExpired({ from: sponsor });
    const sponsorFinalCollateral = await USDCToken.balanceOf(sponsor);
    const sponsorFinalSynthetic = await tokenCurrency.balanceOf(sponsor);

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 200 - 100 * 1.2 = 80
    const expectedSponsorCollateralUnderlying = toBN("80").muln(1e6);
    // Value of remaining synthetic tokens = 50 * 1.2 = 60
    const expectedSponsorCollateralSynthetic = toBN("60").muln(1e6);
    const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
      expectedSponsorCollateralSynthetic
    );
    assert.equal(
      sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
      expectedTotalSponsorCollateralReturned.toString()
    );

    // The token Sponsor should have no synthetic positions left after settlement.
    assert.equal(sponsorFinalSynthetic, 0);

    // Last check is that after redemption the position in the positions mapping has been removed.
    const sponsorsPosition = await customPricelessPositionManager.positions(sponsor);
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.requestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
  });
});
