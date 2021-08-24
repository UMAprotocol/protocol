const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
// Libraries and helpers
const { didContractThrow, interfaceName } = require("@uma/common");
const { assert } = require("chai");

// Contracts to test
const PerpetualPositionManager = getContract("PerpetualPositionManager");

// Other UMA related contracts and mocks
const Store = getContract("Store");
const Finder = getContract("Finder");
const MockOracle = getContract("MockOracle");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const MarginToken = getContract("ExpandedERC20");
const TestnetERC20 = getContract("TestnetERC20");
const SyntheticToken = getContract("SyntheticToken");
const FinancialContractsAdmin = getContract("FinancialContractsAdmin");
const Timer = getContract("Timer");
const ConfigStore = getContract("ConfigStore");
const AddressWhitelist = getContract("AddressWhitelist");

describe("PerpetualPositionManager", function () {
  const { toWei, hexToUtf8, toBN, utf8ToHex } = web3.utils;
  let accounts;
  let contractDeployer;
  let sponsor;
  let tokenHolder;
  let other;
  let collateralOwner;
  let proposer;

  // Contracts
  let collateral;
  let positionManager;
  let tokenCurrency;
  let identifierWhitelist;
  let mockOracle;
  let financialContractsAdmin;
  let timer;
  let finder;
  let store;
  let configStore;
  let collateralWhitelist;

  // Initial constant values
  const initialPositionTokens = toBN(toWei("1000"));
  const initialPositionCollateral = toBN(toWei("1"));
  const syntheticName = "Test Synthetic Token";
  const syntheticSymbol = "SYNTH";
  const withdrawalLiveness = 1000;
  const startTimestamp = Math.floor(Date.now() / 1000);
  const priceFeedIdentifier = utf8ToHex("TEST_IDENTIIFER");
  const fundingRateRewardRate = toWei("0.000001");
  const fundingRateFeedIdentifier = utf8ToHex("TEST_FUNDING"); // example identifier for funding rate.
  const maxFundingRate = toWei("0.00001");
  const minFundingRate = toWei("-0.00001");
  const minSponsorTokens = "5";

  // Conveniently asserts expected collateral and token balances, assuming that
  // there is only one synthetic token holder, the sponsor. Also assumes no
  // precision loss from `getCollateral()` coming from the fee multiplier.
  const checkBalances = async (expectedSponsorTokens, expectedSponsorCollateral) => {
    const expectedTotalTokens = expectedSponsorTokens.add(initialPositionTokens);
    const expectedTotalCollateral = expectedSponsorCollateral.add(initialPositionCollateral);

    const positionData = await positionManager.methods.positions(sponsor).call();
    const sponsorCollateral = await positionManager.methods.getCollateral(sponsor).call();
    assert.equal(sponsorCollateral.toString(), expectedSponsorCollateral.toString());
    // The below assertion only holds if the sponsor holds all of the tokens outstanding.
    assert.equal(positionData.tokensOutstanding.toString(), expectedSponsorTokens.toString());
    assert.equal((await tokenCurrency.methods.balanceOf(sponsor).call()).toString(), expectedSponsorTokens.toString());

    assert.equal(
      (await positionManager.methods.totalPositionCollateral().call()).toString(),
      expectedTotalCollateral.toString()
    );
    assert.equal(
      (await positionManager.methods.totalTokensOutstanding().call()).toString(),
      expectedTotalTokens.toString()
    );
    assert.equal(
      await collateral.methods.balanceOf(positionManager.options.address).call(),
      expectedTotalCollateral.toString()
    );
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [contractDeployer, sponsor, tokenHolder, other, collateralOwner, proposer] = accounts;
    await runDefaultFixture(hre);
    store = await Store.deployed();
    timer = await Timer.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    finder = await Finder.deployed();
    financialContractsAdmin = await FinancialContractsAdmin.deployed();
  });

  beforeEach(async function () {
    // Represents WETH or some other token that the sponsor and contracts don't control.
    collateral = await MarginToken.new("Wrapped Ether", "WETH", 18).send({ from: collateralOwner });
    await collateral.methods.addMember(1, collateralOwner).send({ from: collateralOwner });
    await collateral.methods.mint(sponsor, toWei("1000000")).send({ from: collateralOwner });
    await collateral.methods.mint(other, toWei("1000000")).send({ from: collateralOwner });

    tokenCurrency = await SyntheticToken.new(syntheticName, syntheticSymbol, 18).send({ from: contractDeployer });

    // Force each test to start with a simulated time that's synced to the startTimestamp - 1 (to give the initial
    // funding rate proposal a delay after launch so it won't fail).
    await timer.methods.setCurrentTime(startTimestamp - 1).send({ from: accounts[0] });

    // Register the price tracking tickers.
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: contractDeployer });
    await identifierWhitelist.methods
      .addSupportedIdentifier(fundingRateFeedIdentifier)
      .send({ from: contractDeployer });

    // Add support for the collateral currency.
    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: accounts[0] });

    // Create a mockOracle. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: contractDeployer });
    const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
    await finder.methods
      .changeImplementationAddress(mockOracleInterfaceName, mockOracle.options.address)
      .send({ from: contractDeployer });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: contractDeployer });

    configStore = await ConfigStore.new(
      {
        timelockLiveness: 86400, // 1 day
        rewardRatePerSecond: { rawValue: "0" },
        proposerBondPercentage: { rawValue: "0" },
        maxFundingRate: { rawValue: maxFundingRate },
        minFundingRate: { rawValue: minFundingRate },
        proposalTimePastLimit: 0,
      },
      timer.options.address
    ).send({ from: accounts[0] });

    // Create the instance of the positionManager to test against.
    positionManager = await PerpetualPositionManager.new(
      withdrawalLiveness, // _withdrawalLiveness
      collateral.options.address, // _collateralAddress
      tokenCurrency.options.address, // _tokenAddress
      finder.options.address, // _finderAddress
      priceFeedIdentifier, // _priceFeedIdentifier
      fundingRateFeedIdentifier, // _fundingRateFeedIdentifier
      { rawValue: minSponsorTokens }, // _minSponsorTokens
      configStore.options.address, // _configStoreAddress
      { rawValue: toWei("1") }, // _tokenScaling
      timer.options.address // _timerAddress
    ).send({ from: contractDeployer });

    // Update time to the start timestamp after launch so the first funding rate proposal call succeeds.
    await timer.methods.setCurrentTime(startTimestamp).send({ from: accounts[0] });
    await positionManager.methods.applyFundingRate().send({ from: accounts[0] });

    // Give contract owner permissions.
    await tokenCurrency.methods.addMinter(positionManager.options.address).send({ from: accounts[0] });
    await tokenCurrency.methods.addBurner(positionManager.options.address).send({ from: accounts[0] });

    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });
  });

  // Advances time by 10k seconds.
  const setFundingRateAndAdvanceTime = async (fundingRate) => {
    const currentTime = Number(await positionManager.methods.getCurrentTime().call());
    await positionManager.methods.proposeFundingRate({ rawValue: fundingRate }, currentTime).send({ from: proposer });
    await positionManager.methods.setCurrentTime(currentTime + 10000).send({ from: accounts[0] });
  };

  const setNewConfig = async (config) => {
    const currentTime = parseInt(await positionManager.methods.getCurrentTime().call());
    await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
    await configStore.methods.proposeNewConfig(config).send({ from: accounts[0] });
    await positionManager.methods.setCurrentTime(currentTime + 86400).send({ from: accounts[0] }); // add 1 day.
    await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
  };

  it("If regular fees remove all PfC, then proposer receives no reward", async function () {
    // Create position to give contract PfC = 1.
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }).send({ from: sponsor });
    assert.equal((await positionManager.methods.pfc().call()).toString(), toWei("1"));

    await setNewConfig({
      timelockLiveness: 86400, // 1 day
      rewardRatePerSecond: { rawValue: fundingRateRewardRate },
      proposerBondPercentage: { rawValue: "0" },
      maxFundingRate: { rawValue: maxFundingRate },
      minFundingRate: { rawValue: minFundingRate },
      proposalTimePastLimit: 0,
    });

    // The total time elapsed to publish the proposal is 5 seconds, so let's set the regular fee to 20%/second.
    // This will charge a 100% regular fee tax on the contract's PfC. This will prevent the funding rate store from
    // withdrawing any collateral from the perpetual contract, but it should not revert.
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.2") }).send({ from: accounts[0] });

    // Propose rate and move time forward.
    await setFundingRateAndAdvanceTime("0");

    // Apply the funding rate (pays fees, pulls in the new rate, and pays out rewards).
    await positionManager.methods.applyFundingRate().send({ from: accounts[0] });

    // Applying the funding rate should send all collateral to store and none to the proposer.
    assert.equal((await collateral.methods.balanceOf(store.options.address).call()).toString(), toWei("1"));
    assert.equal((await collateral.methods.balanceOf(proposer).call()).toString(), "0");

    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });
  });

  it("Correct deployment and variable assignment", async function () {
    // PricelessPosition variables
    assert.equal(await positionManager.methods.withdrawalLiveness().call(), withdrawalLiveness);
    assert.equal(await positionManager.methods.collateralCurrency().call(), collateral.options.address);
    assert.equal(await positionManager.methods.tokenCurrency().call(), tokenCurrency.options.address);
    assert.equal(await positionManager.methods.finder().call(), finder.options.address);
    assert.equal(hexToUtf8(await positionManager.methods.priceIdentifier().call()), hexToUtf8(priceFeedIdentifier));
    assert.equal(await positionManager.methods.emergencyShutdownTimestamp().call(), 0);
    assert.equal((await positionManager.methods.emergencyShutdownPrice().call()).toString(), 0);

    // Synthetic token
    assert.equal(await tokenCurrency.methods.name().call(), syntheticName);
    assert.equal(await tokenCurrency.methods.symbol().call(), syntheticSymbol);
  });

  it("Valid constructor params", async function () {
    // Pricefeed identifier must be whitelisted.
    assert(
      await didContractThrow(
        PerpetualPositionManager.new(
          withdrawalLiveness, // _withdrawalLiveness
          collateral.options.address, // _collateralAddress
          tokenCurrency.options.address, // _tokenAddress
          finder.options.address, // _finderAddress
          utf8ToHex("UNREGISTERED"), // _priceFeedIdentifier
          fundingRateFeedIdentifier, // _fundingRateFeedIdentifier
          { rawValue: minSponsorTokens }, // _minSponsorTokens
          configStore.options.address, // _configStoreAddress
          { rawValue: toWei("1") }, // _tokenScaling
          timer.options.address // _timerAddress
        ).send({ from: contractDeployer })
      )
    );
  });

  it("Withdrawal liveness overflow", async function () {
    // Create a contract with a very large withdrawal liveness, i.e., withdrawal requests will never pass.
    tokenCurrency = await SyntheticToken.new(syntheticName, syntheticSymbol, 18).send({ from: accounts[0] });

    const largeLiveness = toBN(2).pow(toBN(256)).subn(10).toString();
    positionManager = await PerpetualPositionManager.new(
      largeLiveness.toString(), // _withdrawalLiveness
      collateral.options.address, // _collateralAddress
      tokenCurrency.options.address, // _tokenAddress
      finder.options.address, // _finderAddress
      priceFeedIdentifier, // _priceFeedIdentifier
      fundingRateFeedIdentifier, // _fundingRateFeedIdentifier
      { rawValue: minSponsorTokens }, // _minSponsorTokens
      configStore.options.address, // _configStoreAddress
      { rawValue: toWei("1") }, // _tokenScaling
      timer.options.address // _timerAddress
    ).send({ from: contractDeployer });
    await tokenCurrency.methods.addMinter(positionManager.options.address).send({ from: accounts[0] });
    await tokenCurrency.methods.addBurner(positionManager.options.address).send({ from: accounts[0] });

    const initialSponsorTokens = toWei("100");
    const initialSponsorCollateral = toWei("150");
    await collateral.methods.approve(positionManager.options.address, initialSponsorCollateral).send({ from: sponsor });
    await positionManager.methods
      .create({ rawValue: initialSponsorCollateral }, { rawValue: initialSponsorTokens })
      .send({ from: sponsor });
    // Withdrawal requests should fail due to overflow.
    assert(
      await didContractThrow(
        positionManager.methods.requestWithdrawal({ rawValue: initialSponsorCollateral }).send({ from: sponsor })
      )
    );
  });

  it("Lifecycle", async function () {
    // Create an initial large and lowly collateralized positionManager.
    await collateral.methods.approve(positionManager.options.address, initialPositionCollateral).send({ from: other });
    await positionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    // Create the initial positionManager.
    const createTokens = toWei("100");
    const createCollateral = toWei("150");
    let expectedSponsorTokens = toBN(createTokens);
    let expectedSponsorCollateral = toBN(createCollateral);
    // Fails without approving collateral.
    assert(
      await didContractThrow(
        positionManager.methods
          .create({ rawValue: createCollateral }, { rawValue: createTokens })
          .send({ from: sponsor })
      )
    );
    await collateral.methods.approve(positionManager.options.address, createCollateral).send({ from: sponsor });
    const createResult = await positionManager.methods
      .create({ rawValue: createCollateral }, { rawValue: createTokens })
      .send({ from: sponsor });
    await assertEventEmitted(createResult, positionManager, "PositionCreated", (ev) => {
      return (
        ev.sponsor == sponsor &&
        ev.collateralAmount == createCollateral.toString() &&
        ev.tokenAmount == createTokens.toString()
      );
    });
    await assertEventEmitted(createResult, positionManager, "NewSponsor", (ev) => {
      return ev.sponsor == sponsor;
    });

    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Deposit.
    const depositCollateral = toWei("50");
    expectedSponsorCollateral = expectedSponsorCollateral.add(toBN(depositCollateral));
    // Fails without approving collateral.
    assert(
      await didContractThrow(positionManager.methods.deposit({ rawValue: depositCollateral }).send({ from: sponsor }))
    );
    await collateral.methods.approve(positionManager.options.address, depositCollateral).send({ from: sponsor });
    // Cannot deposit 0 collateral.
    assert(await didContractThrow(positionManager.methods.deposit({ rawValue: "0" }).send({ from: sponsor })));
    await positionManager.methods.deposit({ rawValue: depositCollateral }).send({ from: sponsor });
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Withdraw.
    const withdrawCollateral = toWei("20");
    expectedSponsorCollateral = expectedSponsorCollateral.sub(toBN(withdrawCollateral));
    let sponsorInitialBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    // Cannot withdraw 0 collateral.
    assert(await didContractThrow(positionManager.methods.withdraw({ rawValue: "0" }).send({ from: sponsor })));
    // Cannot withdraw more than balance. (The position currently has 150 + 50 collateral).
    assert(
      await didContractThrow(positionManager.methods.withdraw({ rawValue: toWei("201") }).send({ from: sponsor }))
    );
    await positionManager.methods.withdraw({ rawValue: withdrawCollateral }).send({ from: sponsor });
    let sponsorFinalBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), withdrawCollateral);
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Redeem 50% of the tokens for 50% of the collateral.
    const redeemTokens = toWei("50");
    expectedSponsorTokens = expectedSponsorTokens.sub(toBN(redeemTokens));
    expectedSponsorCollateral = expectedSponsorCollateral.divn(2);
    // Fails without approving token.
    assert(await didContractThrow(positionManager.methods.redeem({ rawValue: redeemTokens }).send({ from: sponsor })));
    await tokenCurrency.methods.approve(positionManager.options.address, redeemTokens).send({ from: sponsor });
    sponsorInitialBalance = toBN(await collateral.methods.balanceOf(sponsor).call());

    // Check redeem return value and event.
    const redeem = positionManager.methods.redeem;
    const redeemedCollateral = await redeem({ rawValue: redeemTokens }).call({ from: sponsor });
    assert.equal(redeemedCollateral.toString(), expectedSponsorCollateral.toString());
    // Check that redeem fails if missing Burner role.
    await tokenCurrency.methods.removeBurner(positionManager.options.address).send({ from: accounts[0] });
    assert(await didContractThrow(redeem({ rawValue: redeemTokens }).send({ from: sponsor })));
    await tokenCurrency.methods.addBurner(positionManager.options.address).send({ from: accounts[0] });
    let redemptionResult = await redeem({ rawValue: redeemTokens }).send({ from: sponsor });
    await assertEventEmitted(redemptionResult, positionManager, "Redeem", (ev) => {
      return (
        ev.sponsor == sponsor &&
        ev.collateralAmount == expectedSponsorCollateral.toString() &&
        ev.tokenAmount == redeemTokens.toString()
      );
    });

    sponsorFinalBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), expectedSponsorCollateral);
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Create additional.
    const createAdditionalTokens = toWei("10");
    const createAdditionalCollateral = toWei("110");
    expectedSponsorTokens = expectedSponsorTokens.add(toBN(createAdditionalTokens));
    expectedSponsorCollateral = expectedSponsorCollateral.add(toBN(createAdditionalCollateral));
    await collateral.methods
      .approve(positionManager.options.address, createAdditionalCollateral)
      .send({ from: sponsor });
    // Check that create fails if missing Minter role.
    await tokenCurrency.methods.removeMinter(positionManager.options.address).send({ from: accounts[0] });
    assert(
      await didContractThrow(
        positionManager.methods
          .create({ rawValue: createAdditionalCollateral }, { rawValue: createAdditionalTokens })
          .send({ from: sponsor })
      )
    );
    await tokenCurrency.methods.addMinter(positionManager.options.address).send({ from: accounts[0] });
    await positionManager.methods
      .create({ rawValue: createAdditionalCollateral }, { rawValue: createAdditionalTokens })
      .send({ from: sponsor });
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Redeem full.
    const redeemRemainingTokens = toWei("60");
    await tokenCurrency.methods.approve(positionManager.options.address, redeemRemainingTokens).send({ from: sponsor });
    sponsorInitialBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    redemptionResult = await positionManager.methods
      .redeem({ rawValue: redeemRemainingTokens })
      .send({ from: sponsor });
    await assertEventEmitted(redemptionResult, positionManager, "Redeem", (ev) => {
      return (
        ev.sponsor == sponsor &&
        ev.collateralAmount == expectedSponsorCollateral.toString() &&
        ev.tokenAmount == redeemRemainingTokens.toString()
      );
    });
    await assertEventEmitted(redemptionResult, positionManager, "EndedSponsorPosition", (ev) => {
      return ev.sponsor == sponsor;
    });

    sponsorFinalBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), expectedSponsorCollateral);
    await checkBalances(toBN("0"), toBN("0"));

    // Contract state should not have changed.
    assert.equal(await positionManager.methods.emergencyShutdownTimestamp().call(), 0);
    assert.equal((await positionManager.methods.emergencyShutdownPrice().call()).toString(), 0);
  });

  it("Cannot instantly withdraw all of the collateral in the position", async function () {
    // Create an initial large and lowly collateralized positionManager so that we can call `withdraw()`.
    await collateral.methods.approve(positionManager.options.address, initialPositionCollateral).send({ from: other });
    await positionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    // Create the initial positionManager.
    const createTokens = toWei("100");
    const createCollateral = toWei("150");
    await collateral.methods.approve(positionManager.options.address, createCollateral).send({ from: sponsor });
    await positionManager.methods
      .create({ rawValue: createCollateral }, { rawValue: createTokens })
      .send({ from: sponsor });

    // Cannot withdraw full collateral because the GCR check will always fail.
    assert(
      await didContractThrow(positionManager.methods.withdraw({ rawValue: createCollateral }).send({ from: sponsor }))
    );
  });

  it("Withdrawal request", async function () {
    // Create an initial large and lowly collateralized positionManager.
    await collateral.methods.approve(positionManager.options.address, initialPositionCollateral).send({ from: other });
    await positionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    const startTime = await positionManager.methods.getCurrentTime().call();
    // Approve large amounts of token and collateral currencies: this test case isn't checking for that.
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });

    // Create the initial positionManager.
    const initialSponsorTokens = toWei("100");
    const initialSponsorCollateral = toWei("150");
    await positionManager.methods
      .create({ rawValue: initialSponsorCollateral }, { rawValue: initialSponsorTokens })
      .send({ from: sponsor });

    // Must request greater than 0 and less than full position's collateral.
    assert(
      await didContractThrow(positionManager.methods.requestWithdrawal({ rawValue: "0" }).send({ from: sponsor }))
    );
    assert(
      await didContractThrow(
        positionManager.methods.requestWithdrawal({ rawValue: toWei("151") }).send({ from: sponsor })
      )
    );

    // Cannot execute withdrawal request before a request is made.
    assert(await didContractThrow(positionManager.methods.withdrawPassedRequest().send({ from: sponsor })));

    // Request withdrawal. Check event is emitted
    const resultRequestWithdrawal = await positionManager.methods
      .requestWithdrawal({ rawValue: toWei("100") })
      .send({ from: sponsor });
    await assertEventEmitted(resultRequestWithdrawal, positionManager, "RequestWithdrawal", (ev) => {
      return ev.sponsor == sponsor && ev.collateralAmount == toWei("100").toString();
    });

    // All other actions are locked.
    assert(await didContractThrow(positionManager.methods.deposit({ rawValue: toWei("1") }).send({ from: sponsor })));
    assert(await didContractThrow(positionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor })));
    assert(
      await didContractThrow(
        positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }).send({ from: sponsor })
      )
    );
    assert(await didContractThrow(positionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor })));
    assert(
      await didContractThrow(
        positionManager.methods.requestWithdrawal({ rawValue: toWei("1") }).send({ from: sponsor })
      )
    );

    // Can't withdraw before time is up.
    await positionManager.methods.setCurrentTime(parseInt(startTime) + withdrawalLiveness - 1);
    assert(await didContractThrow(positionManager.methods.withdrawPassedRequest().send({ from: sponsor })));

    // The price moved against the sponsor, and they need to cancel. Ensure event is emitted.
    const resultCancelWithdrawal = await positionManager.methods.cancelWithdrawal().send({ from: sponsor });
    await assertEventEmitted(resultCancelWithdrawal, positionManager, "RequestWithdrawalCanceled", (ev) => {
      return ev.sponsor == sponsor && ev.collateralAmount == toWei("100").toString();
    });

    // They can now request again.
    const withdrawalAmount = toWei("25");
    const expectedSponsorCollateral = toBN(initialSponsorCollateral).sub(toBN(withdrawalAmount));
    await positionManager.methods.requestWithdrawal({ rawValue: withdrawalAmount }).send({ from: sponsor });

    // After time is up, execute the withdrawal request. Check event is emitted and return value is correct.
    await positionManager.methods
      .setCurrentTime(parseInt(await positionManager.methods.getCurrentTime().call()) + withdrawalLiveness)
      .send({ from: accounts[0] });
    const sponsorInitialBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    const expectedSponsorFinalBalance = sponsorInitialBalance.add(toBN(withdrawalAmount));
    const withdrawPassedRequest = positionManager.methods.withdrawPassedRequest();
    let amountWithdrawn = await withdrawPassedRequest.call({ from: sponsor });
    assert.equal(amountWithdrawn.toString(), withdrawalAmount.toString());
    let resultWithdrawPassedRequest = await withdrawPassedRequest.send({ from: sponsor });
    await assertEventEmitted(resultWithdrawPassedRequest, positionManager, "RequestWithdrawalExecuted", (ev) => {
      return ev.sponsor == sponsor && ev.collateralAmount == withdrawalAmount.toString();
    });

    // Check that withdrawal-request related parameters in positionManager are reset
    const positionData = await positionManager.methods.positions(sponsor).call();
    assert.equal(positionData.withdrawalRequestPassTimestamp.toString(), 0);
    assert.equal(positionData.withdrawalRequestAmount.toString(), 0);

    // Verify state of positionManager post-withdrawal.
    await checkBalances(toBN(initialSponsorTokens), expectedSponsorCollateral);
    const sponsorFinalBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    assert.equal(sponsorFinalBalance.toString(), expectedSponsorFinalBalance.toString());

    // Methods are now unlocked again.
    await positionManager.methods.deposit({ rawValue: toWei("1") }).send({ from: sponsor });

    // First withdrawal that should pass. Ensure event is emitted and return value is correct.
    const withdraw = positionManager.methods.withdraw;
    amountWithdrawn = await withdraw({ rawValue: toWei("1") }).call({ from: sponsor });
    assert.equal(amountWithdrawn.toString(), toWei("1"));
    const resultWithdraw = await withdraw({ rawValue: toWei("1") }).send({ from: sponsor });
    await assertEventEmitted(resultWithdraw, positionManager, "Withdrawal", (ev) => {
      return ev.sponsor == sponsor && ev.collateralAmount.toString() == toWei("1");
    });

    await positionManager.methods
      .create({ rawValue: toWei("125") }, { rawValue: toWei("100") })
      .send({ from: sponsor });
    await positionManager.methods.redeem({ rawValue: toWei("100") }).send({ from: sponsor });
    await checkBalances(toBN(initialSponsorTokens), expectedSponsorCollateral);

    // Can't cancel if no withdrawals pending.
    assert(await didContractThrow(positionManager.methods.cancelWithdrawal().send({ from: sponsor })));

    // Request to withdraw remaining collateral. Post-fees, this amount should get reduced to the remaining collateral.
    await positionManager.methods.requestWithdrawal({ rawValue: toWei("125") }).send({ from: sponsor });
    // Setting fees to 0.00001 per second will charge (0.00001 * 1000) = 0.01 or 1 % of the collateral.
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.00001") }).send({ from: accounts[0] });
    await positionManager.methods
      .setCurrentTime(parseInt(await positionManager.methods.getCurrentTime().call()) + withdrawalLiveness)
      .send({ from: accounts[0] });
    resultWithdrawPassedRequest = await positionManager.methods.withdrawPassedRequest().send({ from: sponsor });
    await assertEventEmitted(resultWithdrawPassedRequest, positionManager, "RequestWithdrawalExecuted", (ev) => {
      return ev.sponsor == sponsor && ev.collateralAmount == toWei("123.75").toString();
    });
    // @dev: Can't easily call `checkBalances(initialSponsorTokens, 0)` here because of the fee charged, which is also
    // charged on the lowly-collateralized collateral (whose sponsor is `other`).

    // Contract state should not have changed.
    assert.equal(await positionManager.methods.emergencyShutdownTimestamp().call(), 0);
    assert.equal((await positionManager.methods.emergencyShutdownPrice().call()).toString(), 0);

    // Reset store state.
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });
  });

  it("Global collateralization ratio checks", async function () {
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: other });

    // Create the initial positionManager, with a 150% collateralization ratio.
    await positionManager.methods
      .create({ rawValue: toWei("150") }, { rawValue: toWei("100") })
      .send({ from: sponsor });

    // Any withdrawal requests should fail, because withdrawals would reduce the global collateralization ratio.
    assert(await didContractThrow(positionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor })));

    // Because there is only 1 sponsor, neither the sponsor nor potential new sponsors can create below the global ratio.
    assert(
      await didContractThrow(
        positionManager.methods.create({ rawValue: toWei("150") }, { rawValue: toWei("101") }).send({ from: sponsor })
      )
    );
    assert(
      await didContractThrow(
        positionManager.methods.create({ rawValue: toWei("150") }, { rawValue: toWei("101") }).send({ from: other })
      )
    );

    // Because there is only 1 sponsor, both the sponsor and potential new sponsors must create equal to or above the global ratio.
    await positionManager.methods.create({ rawValue: toWei("15") }, { rawValue: toWei("10") }).send({ from: sponsor });
    await positionManager.methods.create({ rawValue: toWei("25") }, { rawValue: toWei("10") }).send({ from: other });

    // At this point the GCR is (150 + 15 + 25) / (100 + 10 + 10) = 158.3%.

    // Since the smaller sponsor is well above the GCR at 250%, they can create new tokens with 0 collateral. Let's say they want
    // to create 5 tokens with 0 collateral. Their new position CR will be 25/10+5 = 166.7%.
    // Therefore, their resultant CR > GCR and this creation is valid. However, if they instead created 6 tokens with 0 collateral, then their
    // resultant CR would be 25/10+6 = 156.3%.
    assert(
      await didContractThrow(
        positionManager.methods.create({ rawValue: toWei("0") }, { rawValue: toWei("6") }).send({ from: other })
      )
    );
    await positionManager.methods.create({ rawValue: toWei("0") }, { rawValue: toWei("5") }).send({ from: other });

    // The new GCR is (190 / 120+5) = 152%. The large sponsor's CR is (165/110) = 150%, so they cannot withdraw
    // any tokens.
    assert(await didContractThrow(positionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor })));

    // Additionally, the large sponsor cannot create any tokens UNLESS their created tokens to deposited collateral ratio > GCR.
    // If the large sponsor wants to create 0.1 more tokens, then they would need to deposit at least 0.152 collateral.
    // This would make their position CR (165+0.152/110+0.1) slightly > 150%, still below the GCR, but the new create ratio > GCR.
    assert(
      await didContractThrow(
        positionManager.methods.create({ rawValue: toWei("0.151") }, { rawValue: toWei("0.1") }).send({ from: sponsor })
      )
    );
    await positionManager.methods
      .create({ rawValue: toWei("0.152") }, { rawValue: toWei("0.1") })
      .send({ from: sponsor });

    // For the "other" Position:
    // global collateralization ratio = (190.152) / (125.1) = 1.52
    // To maintain 15 tokens, need at least 22.8 collateral => e.g. can withdraw from 25 down to 23 but not to 22.
    assert(await didContractThrow(positionManager.methods.withdraw({ rawValue: toWei("3") }).send({ from: other })));
    await positionManager.methods.withdraw({ rawValue: toWei("2") }).send({ from: other });
  });

  it("Non sponsor can use depositTo", async function () {
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });

    const numTokens = toWei("1");
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: numTokens }).send({ from: sponsor });

    // Other makes a deposit to the sponsor's account.
    await positionManager.methods.depositTo(sponsor, { rawValue: toWei("1") }).send({ from: other });

    assert.equal((await positionManager.methods.getCollateral(sponsor).call()).toString(), toWei("2"));
    assert.equal((await positionManager.methods.getCollateral(other).call()).toString(), "0");
  });

  it("Non sponsor can't deposit, redeem, or withdraw", async function () {
    // Create an initial large and lowly collateralized positionManager.
    await collateral.methods.approve(positionManager.options.address, initialPositionCollateral).send({ from: other });
    await positionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });

    // Can't deposit without first creating a positionManager.
    assert(await didContractThrow(positionManager.methods.deposit({ rawValue: toWei("1") }).send({ from: sponsor })));

    // Can't request a withdrawal without first creating a positionManager.
    assert(
      await didContractThrow(
        positionManager.methods.requestWithdrawal({ rawValue: toWei("0") }).send({ from: sponsor })
      )
    );

    // Even if the "sponsor" acquires a token somehow, they can't redeem.
    await tokenCurrency.methods.transfer(sponsor, toWei("1")).send({ from: other });
    assert(await didContractThrow(positionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor })));
  });

  it("Can't redeem more than position size", async function () {
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });

    const numTokens = toWei("1");
    const numCombinedTokens = toWei("2");
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: numTokens }).send({ from: other });
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: numTokens }).send({ from: sponsor });

    await tokenCurrency.methods.transfer(sponsor, numTokens).send({ from: other });
    assert(
      await didContractThrow(positionManager.methods.redeem({ rawValue: numCombinedTokens }).send({ from: sponsor }))
    );
    await positionManager.methods.redeem({ rawValue: numTokens }).send({ from: sponsor });
    assert(await didContractThrow(positionManager.methods.redeem({ rawValue: numTokens }).send({ from: sponsor })));
  });

  it("Existing sponsor can use depositTo on other account", async function () {
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });

    const numTokens = toWei("1");
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: numTokens }).send({ from: other });
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: numTokens }).send({ from: sponsor });

    // Other makes a deposit to the sponsor's account despite having their own position.
    await positionManager.methods.depositTo(sponsor, { rawValue: toWei("1") }).send({ from: other });

    assert.equal((await positionManager.methods.getCollateral(sponsor).call()).toString(), toWei("2"));
    assert.equal((await positionManager.methods.getCollateral(other).call()).toString(), toWei("1"));
  });

  it("Sponsor use depositTo on own account", async function () {
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });

    const numTokens = toWei("1");
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: numTokens }).send({ from: sponsor });

    // Sponsor makes a deposit to their own account.
    await positionManager.methods.depositTo(sponsor, { rawValue: toWei("1") }).send({ from: sponsor });

    assert.equal((await positionManager.methods.getCollateral(sponsor).call()).toString(), toWei("2"));
  });

  it("Sponsor can use repay to decrease their debt", async function () {
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });

    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: toWei("100") }).send({ from: sponsor });

    const initialSponsorTokens = toBN(await tokenCurrency.methods.balanceOf(sponsor).call());
    const initialSponsorTokenDebt = toBN(
      (await positionManager.methods.positions(sponsor).call()).tokensOutstanding.rawValue
    );
    const initialTotalTokensOutstanding = toBN(await positionManager.methods.totalTokensOutstanding().call());

    // Check that repay fails if missing Burner role.
    await tokenCurrency.methods.removeBurner(positionManager.options.address).send({ from: accounts[0] });
    assert(await didContractThrow(positionManager.methods.repay({ rawValue: toWei("40") }).send({ from: sponsor })));
    await tokenCurrency.methods.addBurner(positionManager.options.address).send({ from: accounts[0] });
    const repayResult = await positionManager.methods.repay({ rawValue: toWei("40") }).send({ from: sponsor });

    // Event is correctly emitted.
    await assertEventEmitted(repayResult, positionManager, "Repay", (ev) => {
      return (
        ev.sponsor == sponsor &&
        ev.numTokensRepaid.toString() == toWei("40") &&
        ev.newTokenCount.toString() === toWei("60")
      );
    });

    const tokensPaid = initialSponsorTokens.sub(toBN(await tokenCurrency.methods.balanceOf(sponsor).call()));
    const tokenDebtDecreased = initialSponsorTokenDebt.sub(
      toBN((await positionManager.methods.positions(sponsor).call()).tokensOutstanding.rawValue)
    );
    const totalTokensOutstandingDecreased = initialTotalTokensOutstanding.sub(
      toBN(await positionManager.methods.totalTokensOutstanding().call())
    );

    // Tokens paid back to contract,the token debt decrease and decrease in outstanding should all equal 40 tokens.
    assert.equal(tokensPaid.toString(), toWei("40"));
    assert.equal(tokenDebtDecreased.toString(), toWei("40"));
    assert.equal(totalTokensOutstandingDecreased.toString(), toWei("40"));

    // Can not request to repay more than their token balance. Sponsor has remaining 60. max they can repay is 60
    assert.equal((await positionManager.methods.positions(sponsor).call()).tokensOutstanding.rawValue, toWei("60"));
    assert(await didContractThrow(positionManager.methods.repay({ rawValue: toWei("65") }).send({ from: sponsor })));

    // Can not repay to position less than minimum sponsor size. Minimum sponsor size is 5 wei. Repaying 60 - 3 wei
    // would leave the position at a size of 2 wei, which is less than acceptable minimum.
    assert(
      await didContractThrow(
        positionManager.methods.repay({ rawValue: toBN(toWei("60")).subn(3).toString() }).send({ from: sponsor })
      )
    );

    // Caller needs to set allowance in order to repay.
    await tokenCurrency.methods.approve(positionManager.options.address, "0").send({ from: sponsor });
    assert(
      await didContractThrow(
        positionManager.methods
          .repay({ rawValue: toBN(toWei("60")).sub(toBN(minSponsorTokens)).toString() })
          .send({ from: sponsor })
      )
    );
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("60")).send({ from: sponsor });

    // Can repay up to the minimum sponsor size
    await positionManager.methods
      .repay({ rawValue: toBN(toWei("60")).sub(toBN(minSponsorTokens)).toString() })
      .send({ from: sponsor });

    assert.equal(
      (await positionManager.methods.positions(sponsor).call()).tokensOutstanding.rawValue,
      minSponsorTokens
    );

    // As at the minimum sponsor size even removing 1 wei wll revert.
    assert(await didContractThrow(positionManager.methods.repay({ rawValue: "1" }).send({ from: sponsor })));
  });

  it("Basic funding rate fees", async function () {
    // Approvals.
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });

    // Does nothing when PfC is 0.
    await setNewConfig({
      timelockLiveness: 86400, // 1 day
      rewardRatePerSecond: { rawValue: fundingRateRewardRate },
      proposerBondPercentage: { rawValue: "0" },
      maxFundingRate: { rawValue: maxFundingRate },
      minFundingRate: { rawValue: minFundingRate },
      proposalTimePastLimit: 0,
    });
    await setFundingRateAndAdvanceTime("0");
    await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
    assert.equal((await positionManager.methods.cumulativeFeeMultiplier().call()).toString(), toWei("1"));

    // Initialize positions.
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: toWei("100000") }).send({ from: other });
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }).send({ from: sponsor });

    await setFundingRateAndAdvanceTime("0");
    await positionManager.methods.applyFundingRate().send({ from: accounts[0] });

    // Clock has been advanced during the proposal by 10k seconds. The reward rate is one one-thousandth of a percent.
    // This means the expected hit to the cumulativeFeeMultiplier is 1%.
    assert.equal((await positionManager.methods.cumulativeFeeMultiplier().call()).toString(), toWei("0.99"));
    assert.equal((await positionManager.methods.pfc().call()).toString(), toWei("1.98"));
    assert.equal(
      (await collateral.methods.balanceOf(positionManager.options.address).call()).toString(),
      toWei("1.98")
    );
    assert.equal((await collateral.methods.balanceOf(proposer).call()).toString(), toWei("0.02"));
  });

  it("Basic oracle fees", async function () {
    // Set up position.
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });

    // Set up another position that is less collateralized so sponsor can withdraw freely.
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: toWei("100000") }).send({ from: other });
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }).send({ from: sponsor });

    // Set store fees to 1% per second.
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.01") }).send({ from: accounts[0] });

    // Move time in the contract forward by 1 second to capture a 1% fee.
    const startTime = toBN(await positionManager.methods.getCurrentTime().call());
    await positionManager.methods.setCurrentTime(startTime.addn(1)).send({ from: accounts[0] });

    // getCollateral for a given sponsor should correctly reflect the pending regular fee that has not yet been paid.
    // As no function calls have been made after incrementing time, the fees are still in a "pending" state.
    // Sponsor has a position with 1e18 collateral in it. After a 1% fee is applied they should have 0.99e18.
    assert.equal((await positionManager.methods.getCollateral(sponsor).call()).toString(), toWei("0.99"));

    // Equally, the totalPositionCollateral should be decremented accordingly. The total collateral is 2e18. After
    // the pending regular fee is applied this should be set to 1.98.
    assert.equal((await positionManager.methods.totalPositionCollateral().call()).toString(), toWei("1.98"));

    // Determine the expected store balance by adding 1% of the sponsor balance to the starting store balance.
    // Multiply by 2 because there are two active positions
    const expectedStoreBalance = toBN(await collateral.methods.balanceOf(store.options.address).call()).add(
      toBN(toWei("0.02"))
    );

    // Pay the fees, check the return value, and then check the collateral and the store balance.
    const payRegularFees = positionManager.methods.payRegularFees();
    const feesPaid = await payRegularFees.call();
    assert.equal(feesPaid.toString(), toWei("0.02"));
    const payFeesResult = await payRegularFees.send({ from: accounts[0] });
    await assertEventEmitted(payFeesResult, positionManager, "RegularFeesPaid", (ev) => {
      return ev.regularFee.toString() === toWei("0.02") && ev.lateFee.toString() === "0";
    });
    let collateralAmount = await positionManager.methods.getCollateral(sponsor).call();
    assert.equal(collateralAmount.rawValue.toString(), toWei("0.99"));
    assert.equal(
      (await collateral.methods.balanceOf(store.options.address).call()).toString(),
      expectedStoreBalance.toString()
    );

    // Calling `payRegularFees()` more than once in the same block does not emit a RegularFeesPaid event.
    const feesPaidRepeat = await payRegularFees.call();
    assert.equal(feesPaidRepeat.toString(), "0");
    const payFeesRepeatResult = await payRegularFees.send({ from: accounts[0] });
    await assertEventNotEmitted(payFeesRepeatResult, positionManager, "RegularFeesPaid");

    // Ensure that fees are not applied to new collateral.
    // TODO: value chosen specifically to avoid rounding errors -- see #873.
    await positionManager.methods.deposit({ rawValue: toWei("99") }).send({ from: sponsor });
    collateralAmount = await positionManager.methods.getCollateral(sponsor).call();
    assert.equal(collateralAmount.rawValue.toString(), toWei("99.99"));

    // Ensure that the conversion works correctly for withdrawals.
    const expectedSponsorBalance = toBN(await collateral.methods.balanceOf(sponsor).call()).add(toBN(toWei("1")));
    await positionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor });
    assert.equal((await collateral.methods.balanceOf(sponsor).call()).toString(), expectedSponsorBalance.toString());
    assert.equal((await positionManager.methods.getCollateral(sponsor).call()).toString(), toWei("98.99"));

    // Test that regular fees accrue after an emergency shutdown is triggered.
    await financialContractsAdmin.methods
      .callEmergencyShutdown(positionManager.options.address)
      .send({ from: accounts[0] });

    // Ensure that the maximum fee % of pfc charged is 100%. Advance > 100 seconds from the last payment time to attempt to
    // pay > 100% fees on the PfC. This should pay a maximum of 100% of the PfC without reverting.
    const pfc = await positionManager.methods.pfc().call();
    const feesOwed = (
      await store.methods.computeRegularFee(startTime.addn(1), startTime.addn(102), { rawValue: pfc.toString() }).call()
    ).regularFee;
    assert.isTrue(Number(pfc.toString()) < Number(feesOwed.toString()));
    const farIntoTheFutureSeconds = 502;
    await positionManager.methods.setCurrentTime(startTime.addn(farIntoTheFutureSeconds)).send({ from: accounts[0] });
    const payTooManyFeesResult = await positionManager.methods.payRegularFees().send({ from: accounts[0] });
    await assertEventEmitted(payTooManyFeesResult, positionManager, "RegularFeesPaid", (ev) => {
      // There should be 98.99 + 0.99 = 99.98 collateral remaining in the contract.
      return ev.regularFee.toString() === toWei("99.98") && ev.lateFee.toString() === "0";
    });
    assert.equal((await positionManager.methods.getCollateral(sponsor).call()).toString(), "0");

    // TODO: Add unit tests for when the latePenalty > 0 but (latePenalty + regularFee > pfc). The component fees need to be reduced properly.

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });

    // Check that no event is fired if the fees owed are 0.
    await positionManager.methods
      .setCurrentTime(startTime.addn(farIntoTheFutureSeconds + 1))
      .send({ from: accounts[0] });
    const payZeroFeesResult = await payRegularFees.send({ from: accounts[0] });
    await assertEventNotEmitted(payZeroFeesResult, positionManager, "RegularFeesPaid");
  });

  it("Gulps non-PfC collateral into PfC", async function () {
    // Set up position.
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(positionManager.options.address, toWei("1000")).send({ from: sponsor });

    // Set up another position that is less collateralized so sponsor can withdraw freely.
    await positionManager.methods.create({ rawValue: toWei("3") }, { rawValue: toWei("100000") }).send({ from: other });
    await positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }).send({ from: sponsor });

    // Verify the current PfC:
    assert.equal((await positionManager.methods.pfc().call()).toString(), toWei("4"));

    // Send collateral to the contract so that its collateral balance is greater than its PfC.
    await collateral.methods.mint(positionManager.options.address, toWei("0.5")).send({ from: collateralOwner });

    // Gulp and check that (1) the contract's PfC adjusted and (2) each sponsor's locked collateral increased.
    // Ratio of total-collateral / PfC = (4.5/4) = 1.125
    // New fee multiplier = 1 * 1.125 = 1.125
    // Sponsor's collateral should now be multiplied by 1.125
    await positionManager.methods.gulp().send({ from: accounts[0] });
    assert.equal((await positionManager.methods.pfc().call()).toString(), toWei("4.5"));
    // Gulping twice does nothing.
    await positionManager.methods.gulp().send({ from: accounts[0] });
    assert.equal((await positionManager.methods.getCollateral(other).call()).toString(), toWei("3.375"));
    assert.equal((await positionManager.methods.getCollateral(sponsor).call()).toString(), toWei("1.125"));
    assert.equal((await collateral.methods.balanceOf(positionManager.options.address).call()).toString(), toWei("4.5"));
  });

  it("Emergency shutdown: lifecycle", async function () {
    // Create one position with 100 synthetic tokens to mint with 150 tokens of collateral. For this test say the
    // collateral is WETH with a value of 1USD and the synthetic is some fictional stock or commodity.
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await positionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = toWei("50");
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

    // Some time passes and the UMA token holders decide that Emergency shutdown needs to occur.
    const shutdownTimestamp = Number(await positionManager.methods.getCurrentTime().call()) + 1000;
    await positionManager.methods.setCurrentTime(shutdownTimestamp).send({ from: accounts[0] });

    // Should revert if emergency shutdown initialized by non-FinancialContractsAdmin (governor).
    assert(await didContractThrow(positionManager.methods.emergencyShutdown().send({ from: other })));

    // FinancialContractAdmin can initiate emergency shutdown.
    await financialContractsAdmin.methods
      .callEmergencyShutdown(positionManager.options.address)
      .send({ from: accounts[0] });
    assert.equal(await positionManager.methods.emergencyShutdownTimestamp().call(), shutdownTimestamp);
    assert.equal((await positionManager.methods.emergencyShutdownPrice().call()).toString(), 0);

    // Because the emergency shutdown is called by the `financialContractsAdmin`, listening for events can not
    // happen in the standard way as done in other tests. However, we can directly query the `positionManager`
    // to see it's past events to ensure that the right parameters were emmited.
    const eventResult = await positionManager.getPastEvents("EmergencyShutdown");
    assert.equal(eventResult[0].returnValues.caller, financialContractsAdmin.options.address);
    assert.equal(eventResult[0].returnValues.shutdownTimestamp.toString(), shutdownTimestamp.toString());

    // Emergency shutdown should not be able to be called a second time.
    assert(
      await didContractThrow(
        financialContractsAdmin.methods
          .callEmergencyShutdown(positionManager.options.address)
          .send({ from: accounts[0] })
      )
    );

    // Before the DVM has resolved a price withdrawals should be disabled (as with settlement at maturity).
    assert(await didContractThrow(positionManager.methods.settleEmergencyShutdown().send({ from: sponsor })));

    // All contract functions should also blocked as emergency shutdown.
    assert(
      await didContractThrow(
        positionManager.methods.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }).send({ from: sponsor })
      )
    );
    assert(await didContractThrow(positionManager.methods.deposit({ rawValue: toWei("1") }).send({ from: sponsor })));
    assert(await didContractThrow(positionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor })));
    assert(await didContractThrow(positionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor })));
    assert(
      await didContractThrow(
        positionManager.methods.requestWithdrawal({ rawValue: toWei("1") }).send({ from: sponsor })
      )
    );
    assert(await didContractThrow(positionManager.methods.withdrawPassedRequest().send({ from: sponsor })));

    // UMA token holders now vote to resolve of the price request to enable the emergency shutdown to continue.
    // Say they resolve to a price of 1.1 USD per synthetic token.
    await mockOracle.methods
      .pushPrice(priceFeedIdentifier, shutdownTimestamp, toWei("1.1"))
      .send({ from: accounts[0] });

    // Token holders (`sponsor` and `tokenHolder`) should now be able to withdraw post emergency shutdown.
    // From the token holder's perspective, they are entitled to the value of their tokens, notated in the underlying.
    // They have 50 tokens settled at a price of 1.1 should yield 55 units of underling (or 55 USD as underlying is WETH).
    const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderInitialSynthetic = toBN(await tokenCurrency.methods.balanceOf(tokenHolder).call());
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(positionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    // Check that settlement fails if missing Burner role.
    await tokenCurrency.methods.removeBurner(positionManager.options.address).send({ from: accounts[0] });
    assert(await didContractThrow(positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder })));
    await tokenCurrency.methods.addBurner(positionManager.options.address).send({ from: accounts[0] });
    await positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder });
    assert.equal((await positionManager.methods.emergencyShutdownPrice().call()).toString(), toWei("1.1"));
    const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderFinalSynthetic = toBN(await tokenCurrency.methods.balanceOf(tokenHolder).call());
    const expectedTokenHolderFinalCollateral = toWei("55");
    assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // If the tokenHolder tries to withdraw again they should get no additional tokens; all have been withdrawn (same as normal expiratory).
    const tokenHolderInitialCollateral_secondWithdrawal = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderInitialSynthetic_secondWithdrawal = toBN(
      await tokenCurrency.methods.balanceOf(tokenHolder).call()
    );
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);
    await tokenCurrency.methods
      .approve(positionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    await positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder });
    const tokenHolderFinalCollateral_secondWithdrawal = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderFinalSynthetic_secondWithdrawal = toBN(await tokenCurrency.methods.balanceOf(tokenHolder).call());
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
    const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorInitialSynthetic = toBN(await tokenCurrency.methods.balanceOf(sponsor).call());

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(positionManager.options.address, sponsorInitialSynthetic)
      .send({ from: sponsor });
    await positionManager.methods.settleEmergencyShutdown().send({ from: sponsor });
    const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorFinalSynthetic = toBN(await tokenCurrency.methods.balanceOf(sponsor).call());

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 150 - 100 * 1.1 = 40
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

  it("Funding rate is correctly updated on all contract function calls", async function () {
    // Initially cumulativeFundingRateMultiplier is set to 1e18
    assert.equal((await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(), toWei("1"));

    // Set a positive funding rate of 0.000005 in the store and apply it for a period of 10k seconds. New funding rate should
    // be 1 * (1 + 0.01 * 5) = 1.05
    await setFundingRateAndAdvanceTime(toWei("0.000005"));

    // Call a function on the emp, such as creating a position, should apply the funding rate.
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: other });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: other });
    await positionManager.methods
      .create({ rawValue: toWei("150") }, { rawValue: toWei("100") })
      .send({ from: sponsor });

    assert.equal((await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(), toWei("1.05"));

    // Set the funding rate to a negative funding rate of -0.000001 in the store and apply it for 10k seconds. New funding rate
    // should be 1.05 * (1 - -0.000001 * 10k) = 1.0395
    await setFundingRateAndAdvanceTime(toWei("-0.000001"));
    // Requesting withdraw should not update funding multipler
    await positionManager.methods.requestWithdrawal({ rawValue: toWei("10") }).send({ from: sponsor });
    assert.equal((await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(), toWei("1.05"));

    // Apply the update
    await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
    assert.equal((await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(), toWei("1.0395"));

    // Setting the funding rate to zero (no payments made, synth trading at parity) should not change the cumulativeFundingRateMultiplier.
    await setFundingRateAndAdvanceTime(toWei("0"));
    await positionManager.methods.withdrawPassedRequest().send({ from: sponsor }); // call another function on the contract.
    assert.equal((await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(), toWei("1.0395"));

    await setFundingRateAndAdvanceTime(toWei("0.000001"));

    // depositTo
    await positionManager.methods.depositTo(sponsor, { rawValue: toWei("1") }).send({ from: other });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.049895")
    ); // 1.0395 * 1.01 = 1.049895

    // deposit
    await timer.methods
      .setCurrentTime(
        toBN(await timer.methods.getCurrentTime().call())
          .add(toBN(10000))
          .toString()
      )
      .send({ from: accounts[0] });
    await positionManager.methods.deposit({ rawValue: toWei("1") }).send({ from: sponsor });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.06039395")
    ); // 1.049895 * 1.01 = 1.06039395

    // withdraw. To do a "fast" withdraw need to have the position above the GCR.
    await positionManager.methods.create({ rawValue: toWei("200") }, { rawValue: toWei("100") }).send({ from: other }); // position above GCR
    await timer.methods
      .setCurrentTime(
        toBN(await timer.methods.getCurrentTime().call())
          .add(toBN(10000))
          .toString()
      )
      .send({ from: accounts[0] });
    await positionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: other });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.0709978895")
    ); // 1.06039395 * 1.01 = 1.0709978895

    // cancelWithdrawal
    await positionManager.methods.requestWithdrawal({ rawValue: toWei("1") }).send({ from: other });
    await timer.methods
      .setCurrentTime(
        toBN(await timer.methods.getCurrentTime().call())
          .add(toBN(10000))
          .toString()
      )
      .send({ from: accounts[0] });
    await positionManager.methods.cancelWithdrawal().send({ from: other });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.0709978895")
    ); // NO CHANGE -- withdraw requests do not affect.

    // Apply the funding rate to see the change.
    await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.081707868395")
    ); // 1.0709978895 * 1.01 = 1.081707868395

    // redeem
    await timer.methods
      .setCurrentTime(
        toBN(await timer.methods.getCurrentTime().call())
          .add(toBN(10000))
          .toString()
      )
      .send({ from: accounts[0] });
    await positionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.09252494707895")
    ); // 1.081707868395 * 1.01 = 1.09252494707895

    // repay
    await timer.methods
      .setCurrentTime(
        toBN(await timer.methods.getCurrentTime().call())
          .add(toBN(10000))
          .toString()
      )
      .send({ from: accounts[0] });
    await positionManager.methods.repay({ rawValue: toWei("1") }).send({ from: sponsor });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.1034501965497395")
    ); // 1.09252494707895 * 1.01 = 1.1034501965497395

    // can directly call applyFundingRate
    await timer.methods
      .setCurrentTime(
        toBN(await timer.methods.getCurrentTime().call())
          .add(toBN(10000))
          .toString()
      )
      .send({ from: accounts[0] });
    await positionManager.methods.applyFundingRate().send({ from: other });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.114484698515236895")
    ); // 1.1034501965497395 * 1.01 = 1.114484698515236895

    // emergencyShutdown
    await timer.methods
      .setCurrentTime(
        toBN(await timer.methods.getCurrentTime().call())
          .add(toBN(10000))
          .toString()
      )
      .send({ from: accounts[0] });
    await financialContractsAdmin.methods
      .callEmergencyShutdown(positionManager.options.address)
      .send({ from: accounts[0] });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.125629545500389263")
    ); // 1.114484698515236895 * 1.01 = 1.125629545500389263(954) truncated

    // settleEmergencyShutdown SHOULD NOT update the cumulativeFundingRateMultiplier as emergency shutdown locks all state variables.
    const shutdownTimestamp = Number(await positionManager.methods.getCurrentTime().call());
    await timer.methods
      .setCurrentTime(
        toBN(await timer.methods.getCurrentTime().call())
          .add(toBN(10000))
          .toString()
      )
      .send({ from: accounts[0] });
    await mockOracle.methods
      .pushPrice(priceFeedIdentifier, shutdownTimestamp, toWei("1.1"))
      .send({ from: accounts[0] });
    await positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder });
    assert.equal(
      (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
      toWei("1.125629545500389263")
    ); // same as previous assert
  });

  it("cumulativeFundingRateMultiplier is correctly applied to emergency shutdown settlement price", async function () {
    // Create one position with 100 synthetic tokens to mint with 200 tokens of collateral. For this test say the
    // collateral is WETH with a value of 1USD and the synthetic is some fictional stock or commodity.
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });

    await positionManager.methods
      .create({ rawValue: toWei("200") }, { rawValue: toWei("100") })
      .send({ from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = toWei("50");
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

    // Add a funding rate to the fundingRateStore. let's say a value of 0.0005% per second. This advances time by 10k seconds.
    await setFundingRateAndAdvanceTime(toWei("0.000005"));

    // Some time passes and the UMA token holders decide that Emergency shutdown needs to occur.
    const shutdownTimestamp = Number(await positionManager.methods.getCurrentTime().call());
    await positionManager.methods.setCurrentTime(shutdownTimestamp).send({ from: accounts[0] });

    // FinancialContractAdmin can initiate emergency shutdown.
    await financialContractsAdmin.methods
      .callEmergencyShutdown(positionManager.options.address)
      .send({ from: accounts[0] });

    // Cumulative funding rate multiplier should have been updated accordingly.
    assert.equal((await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(), toWei("1.05")); // 1 * (1 + (0.000005 * 10000)) = 1.05

    // UMA token holders now vote to resolve of the price request to enable the emergency shutdown to continue.
    // Say they resolve to a price of 1.1 USD per synthetic token.
    await mockOracle.methods
      .pushPrice(priceFeedIdentifier, shutdownTimestamp, toWei("1.1"))
      .send({ from: accounts[0] });

    // Token holders (`sponsor` and `tokenHolder`) should now be able to withdraw post emergency shutdown.
    // From the token holder's perspective, they are entitled to the value of their tokens, notated in the underlying.
    // Their token debt value is effectively multiplied by the cumulativeFundingRateMultiplier to give the funding rate
    // adjusted value of their debt. They have 50 tokens settled at a price of 1.1 should yield with a funding multiplier of 1.05
    // TRV =  50 * 1.1 * 1.05 = 57.75
    const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderInitialSynthetic = toBN(await tokenCurrency.methods.balanceOf(tokenHolder).call());
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(positionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    await positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder });
    assert.equal((await positionManager.methods.emergencyShutdownPrice().call()).toString(), toWei("1.1"));
    const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderFinalSynthetic = toBN(await tokenCurrency.methods.balanceOf(tokenHolder).call());
    const expectedTokenHolderFinalCollateral = toWei("57.75");
    assert.equal(
      tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral).toString(),
      expectedTokenHolderFinalCollateral.toString()
    );

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // If the tokenHolder tries to withdraw again they should get no additional tokens; all have been withdrawn (same as normal expiratory).
    const tokenHolderInitialCollateral_secondWithdrawal = await collateral.methods.balanceOf(tokenHolder).call();
    const tokenHolderInitialSynthetic_secondWithdrawal = await tokenCurrency.methods.balanceOf(tokenHolder).call();
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);
    await tokenCurrency.methods
      .approve(positionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    await positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder });
    const tokenHolderFinalCollateral_secondWithdrawal = await collateral.methods.balanceOf(tokenHolder).call();
    const tokenHolderFinalSynthetic_secondWithdrawal = await tokenCurrency.methods.balanceOf(tokenHolder).call();
    assert.equal(
      tokenHolderInitialCollateral_secondWithdrawal.toString(),
      tokenHolderFinalCollateral_secondWithdrawal.toString()
    );
    assert.equal(
      tokenHolderInitialSynthetic_secondWithdrawal.toString(),
      tokenHolderFinalSynthetic_secondWithdrawal.toString()
    );

    // For the sponsor, they are entitled to the underlying value of their remaining synthetic tokens scaled by the
    // funding rate multiplier + the excess collateral in their position at time of settlement. The sponsor had 150 units
    // of collateral in their position and the final TRV of their synthetic debt is 100 * 1.1 * 1.05 (debt * price * funding rate multiplier).
    // Their redeemed amount for this excess collateral is the difference between the two. The sponsor also has 50 synthetic
    // tokens that they did not sell which will be redeemed.This makes their expected redemption:
    // = 200 - (100 - 50) * 1.1 * 1.05 = 142.25
    const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorInitialSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(positionManager.options.address, sponsorInitialSynthetic)
      .send({ from: sponsor });
    await positionManager.methods.settleEmergencyShutdown().send({ from: sponsor });
    const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 200 - 100 * 1.1 * 1.05 = 84.5
    const expectedSponsorCollateralUnderlying = toBN(toWei("84.5"));
    // Value of remaining synthetic tokens = 50 * 1.1 * 1.05 = 57.75
    const expectedSponsorCollateralSynthetic = toBN(toWei("57.75"));
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

  describe("Precision loss as a result of regular fees is handled as expected", () => {
    beforeEach(async () => {
      // Create a new position with:
      // - 30 collateral
      // - 20 synthetic tokens (10 held by token holder, 10 by sponsor)
      await collateral.methods.approve(positionManager.options.address, "100000").send({ from: sponsor });
      const numTokens = "20";
      const amountCollateral = "30";
      await positionManager.methods
        .create({ rawValue: amountCollateral }, { rawValue: numTokens })
        .send({ from: sponsor });
      await tokenCurrency.methods.approve(positionManager.options.address, numTokens).send({ from: sponsor });

      // Setting the regular fee to 4 % per second will result in a miscalculated cumulativeFeeMultiplier after 1 second
      // because of the intermediate calculation in `payRegularFees()` for calculating the `feeAdjustment`: ( fees paid ) / (total collateral)
      // = 0.033... repeating, which cannot be represented precisely by a fixed point.
      // --> 0.04 * 30 wei = 1.2 wei, which gets truncated to 1 wei, so 1 wei of fees are paid
      const regularFee = toWei("0.04");
      await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: regularFee }).send({ from: accounts[0] });

      // Advance the contract one second and make the contract pay its regular fees
      let startTime = parseInt(await positionManager.methods.getCurrentTime().call());
      await positionManager.methods.setCurrentTime(startTime + 1).send({ from: accounts[0] });
      await positionManager.methods.payRegularFees().send({ from: accounts[0] });

      // Set the store fees back to 0 to prevent fee multiplier from changing for remainder of the test.
      await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });
    });
    it("Fee multiplier is set properly with precision loss, and fees are paid as expected", async () => {
      // Absent any rounding errors, `getCollateral` should return (initial-collateral - final-fees) = 30 wei - 1 wei = 29 wei.
      // But, because of the use of mul and div in payRegularFees(), getCollateral() will return slightly less
      // collateral than expected. When calculating the new `feeAdjustment`, we need to calculate the %: (fees paid / pfc), which is
      // 1/30. However, 1/30 = 0.03333... repeating, which cannot be represented in FixedPoint. Normally div() would floor
      // this value to 0.033....33, but divCeil sets this to 0.033...34. A higher `feeAdjustment` causes a lower `adjustment` and ultimately
      // lower `totalPositionCollateral` and `positionAdjustment` values.
      let collateralAmount = await positionManager.methods.getCollateral(sponsor).call();
      assert.isTrue(toBN(collateralAmount.rawValue).lt(toBN("29")));
      assert.equal(
        (await positionManager.methods.cumulativeFeeMultiplier().call()).toString(),
        toWei("0.966666666666666666").toString()
      );

      // The actual amount of fees paid to the store is as expected = 1 wei.
      // At this point, the store should have +1 wei, the contract should have 29 wei but the position will show 28 wei
      // because `(30 * 0.966666666666666666 = 28.999...98)`. `30` is the rawCollateral and if the fee multiplier were correct, {       // then `totalPositionCollateral` would be `(30 * 0.966666666666666666...) = 29`.
      assert.equal((await collateral.methods.balanceOf(positionManager.options.address).call()).toString(), "29");
      assert.equal((await positionManager.methods.totalPositionCollateral().call()).toString(), "28");
      assert.equal((await positionManager.methods.rawTotalPositionCollateral().call()).toString(), "30");
    });
    it("settleEmergencyShutdown() returns the same amount of collateral that totalPositionCollateral is decreased by", async () => {
      // Emergency shutdown the contract
      const emergencyShutdownTime = await positionManager.methods.getCurrentTime().call();
      await financialContractsAdmin.methods
        .callEmergencyShutdown(positionManager.options.address)
        .send({ from: accounts[0] });

      // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
      // feed. With 20 units of outstanding tokens this results in a token redemption value of: TRV = 20 * 1.2 = 24 USD.
      const redemptionPrice = 1.2;
      const redemptionPriceWei = toWei(redemptionPrice.toString());
      await mockOracle.methods
        .pushPrice(priceFeedIdentifier, parseInt(emergencyShutdownTime), redemptionPriceWei)
        .send({ from: accounts[0] });

      // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
      const tokenHolderTokens = "10";
      await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });
      await tokenCurrency.methods
        .approve(positionManager.options.address, tokenHolderTokens)
        .send({ from: tokenHolder });

      // The token holder is entitled to the value of their tokens, notated in the underlying.
      // They have 10 tokens settled at a price of 1.2 should yield 12 units of collateral.
      // So, `rawCollateral` is decreased by (`12 / 0.966666666666666666 ~= 12.4`) which gets truncated to 12.
      // Before `settleEmergencyShutdown` is called, `totalPositionCollateral = rawCollateral * cumulativeFeeMultiplier = 30 * 0.966666666666666666 = 28`.
      // After `settleEmergencyShutdown`, `rawCollateral -= 12`, so the new `totalPositionCollateral = `(30-12) * 0.966666666666666666 = 17.4` which is truncated to 17.
      // So, due to precision loss, `totalPositionCollateral` is only decreased by 11, but it should be 12 without errors.
      // From the user's POV, they will see their balance decrease by 11, so we should send them 11 collateral not 12.
      const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      await positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder });
      const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      const tokenHolderFinalSynthetic = toBN(await tokenCurrency.methods.balanceOf(tokenHolder).call());

      // The token holder should gain the value of their synthetic tokens in underlying.
      const expectedTokenHolderFinalCollateral = "11";
      assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);
      assert.equal((await collateral.methods.balanceOf(positionManager.options.address).call()).toString(), "18");
      assert.equal((await positionManager.methods.totalPositionCollateral().call()).toString(), "17");
      assert.equal((await positionManager.methods.rawTotalPositionCollateral().call()).toString(), "18");

      // The token holder should have no synthetic positions left after settlement.
      assert.equal(tokenHolderFinalSynthetic, 0);

      // The sponsor is entitled to the underlying value of their remaining synthetic tokens + the excess collateral
      // in their position at time of settlement - final fees. But we'll see that the "excess" collateral displays error
      // due to precision loss.
      const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      await positionManager.methods.settleEmergencyShutdown().send({ from: sponsor });
      const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      const sponsorFinalSynthetic = toBN(await tokenCurrency.methods.balanceOf(sponsor).call());

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
      assert.equal((await positionManager.methods.totalPositionCollateral().call()).toString(), "1");
      assert.equal((await positionManager.methods.rawTotalPositionCollateral().call()).toString(), "2");
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
      assert.equal((await collateral.methods.balanceOf(positionManager.options.address).call()).toString(), "2");
      assert.equal((await positionManager.methods.totalPositionCollateral().call()).toString(), "1");

      // Last check is that after redemption the position in the positions mapping is still removed despite leaving collateral dust.
      const sponsorsPosition = await positionManager.methods.positions(sponsor).call();
      assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
      assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
      assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
      assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
    });
    it("withdraw() returns the same amount of collateral that totalPositionCollateral is decreased by", async () => {
      // The sponsor requests to withdraw 12 collateral.
      // So, `rawCollateral` is decreased by (`12 / 0.966666666666666666 ~= 12.4`) which gets truncated to 12.
      // Before `withdraw` is called, `totalPositionCollateral = rawCollateral * cumulativeFeeMultiplier = 30 * 0.966666666666666666 = 28`.
      // After `settleEmergencyShutdown`, `rawCollateral -= 12`, so the new `totalPositionCollateral = `(30-12) * 0.966666666666666666 = 17.4` which is truncated to 17.
      // So, due to precision loss, `totalPositionCollateral` is only decreased by 11, but it should be 12 without errors.
      // From the user's POV, they will see their balance decrease by 11, so we should send them 11 collateral not 12.
      const initialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      await positionManager.methods.requestWithdrawal({ rawValue: "12" }).send({ from: sponsor });
      let startTime = parseInt(await positionManager.methods.getCurrentTime().call());
      await positionManager.methods.setCurrentTime(startTime + withdrawalLiveness).send({ from: accounts[0] });
      await positionManager.methods.withdrawPassedRequest().send({ from: sponsor });
      const finalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());

      // The sponsor should gain their requested amount minus precision loss.
      const expectedFinalCollateral = "11";
      assert.equal(finalCollateral.sub(initialCollateral), expectedFinalCollateral);
      assert.equal((await collateral.methods.balanceOf(positionManager.options.address).call()).toString(), "18");
      assert.equal((await positionManager.methods.totalPositionCollateral().call()).toString(), "17");
      assert.equal((await positionManager.methods.rawTotalPositionCollateral().call()).toString(), "18");
    });
    it("redeem() returns the same amount of collateral that totalPositionCollateral is decreased by", async () => {
      // The sponsor requests to redeem 9 tokens. (9/20 = 0.45) tokens should result in a proportional redemption of the totalPositionCollateral, {       // which as you recall is 28 post-fees. So, we expect to redeem (0.45 * 28 = 12.6) collateral which gets truncated to 12.
      // So, `rawCollateral` is decreased by (`12 / 0.966666666666666666 ~= 12.4`) which gets truncated to 12.
      // Before `withdraw` is called, `totalPositionCollateral = rawCollateral * cumulativeFeeMultiplier = 30 * 0.966666666666666666 = 28`.
      // After `settleEmergencyShutdown`, `rawCollateral -= 12`, so the new `totalPositionCollateral = `(30-12) * 0.966666666666666666 = 17.4` which is truncated to 17.
      // So, due to precision loss, `totalPositionCollateral` is only decreased by 11, but it should be 12 without errors.
      // From the user's POV, they will see their balance decrease by 11, so we should send them 11 collateral not 12.
      const initialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      await positionManager.methods.redeem({ rawValue: "9" }).send({ from: sponsor });
      const finalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());

      // The sponsor should gain their requested amount minus precision loss.
      assert.equal(finalCollateral.sub(initialCollateral), "11");
      assert.equal((await collateral.methods.balanceOf(positionManager.options.address).call()).toString(), "18");
      assert.equal((await positionManager.methods.totalPositionCollateral().call()).toString(), "17");
      assert.equal((await positionManager.methods.rawTotalPositionCollateral().call()).toString(), "18");

      // Expected number of synthetic tokens are burned.
      assert.equal((await tokenCurrency.methods.balanceOf(sponsor).call()).toString(), "11");
    });
  });

  describe("Precision loss as a result of the funding rate multiplier is handled as expected", () => {
    beforeEach(async () => {
      // Create a new position with:
      // - any amount of collateral
      // - 30 wei synthetic tokens
      await collateral.methods.approve(positionManager.options.address, "100000").send({ from: sponsor });
      const numTokens = "30";
      const amountCollateral = "1";
      await positionManager.methods
        .create({ rawValue: amountCollateral }, { rawValue: numTokens })
        .send({ from: sponsor });
      await tokenCurrency.methods.approve(positionManager.options.address, numTokens).send({ from: sponsor });
    });
    it("Funding rate multiplier updates shows precision loss", async function () {
      // Set the funding rate multiplier to 1 wei for 10k seconds.
      await setFundingRateAndAdvanceTime("1");

      // Apply the funding rate and check that the multiplier is set correctly.
      await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
      assert.equal(
        (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
        toWei("1.000000000000010000")
      );

      // Advance by 1 second and check precision loss.
      await timer.methods
        .setCurrentTime(
          toBN(await timer.methods.getCurrentTime().call())
            .add(toBN(1))
            .toString()
        )
        .send({ from: accounts[0] });
      await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
      assert.equal(
        (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
        toWei("1.000000000000010001")
      );

      // Set the funding rate multiplier to -1 wei for 10k seconds.
      await setFundingRateAndAdvanceTime("-1");

      // Apply the funding rate and check that the multiplier is set correctly.
      await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
      assert.equal((await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(), toWei("1"));

      // Advance by 1 second and check precision loss.
      await timer.methods
        .setCurrentTime(
          toBN(await timer.methods.getCurrentTime().call())
            .add(toBN(1))
            .toString()
        )
        .send({ from: accounts[0] });
      await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
      assert.equal(
        (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
        toWei("0.999999999999999999")
      );

      // Advance by another second and check precision loss (i.e. the lower decimals don't affect the outcome).
      await timer.methods
        .setCurrentTime(parseInt(await timer.methods.getCurrentTime().call()) + 1)
        .send({ from: accounts[0] });
      await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
      assert.equal(
        (await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(),
        toWei("0.999999999999999998")
      );
    });
    it("Funding-Rate-Adjusted sponsor debt shows precision loss", async function () {
      // Set the funding rate multiplier to 0.95 after 1 second.
      // After 1 second, the adjusted token debt will be 30 * 0.95 = 28.5 wei, which will be truncated to 28.
      await setFundingRateAndAdvanceTime(toWei("-0.000005"));

      // Apply the funding rate and check that the multiplier is set correctly.
      await positionManager.methods.applyFundingRate().send({ from: accounts[0] });
      assert.equal((await positionManager.methods.fundingRate().call()).cumulativeMultiplier.toString(), toWei("0.95"));

      // Query adjusted debt.
      const rawDebt = (await positionManager.methods.positions(sponsor).call()).tokensOutstanding;
      const adjustedDebt = await positionManager.methods.getFundingRateAppliedTokenDebt(rawDebt).call();

      // Without precision loss the adjusted debt would be 28.5
      assert.equal(adjustedDebt.toString(), "28");

      // However, this does not result in inconsistencies because the contract only deals with
      // adjusted, not raw debt.

      // If the sponsor redeems all of their tokens they will still receive 100% of their collateral.
      const initialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      await positionManager.methods.redeem({ rawValue: "30" }).send({ from: sponsor });
      const finalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      assert.equal(finalCollateral.sub(initialCollateral), "1");
      const positionDebt = (await positionManager.methods.positions(sponsor).call()).tokensOutstanding;
      assert.equal(positionDebt.toString(), "0");
      const positionCollateral = (await positionManager.methods.positions(sponsor).call()).rawCollateral;
      assert.equal(positionCollateral.toString(), "0");
    });
  });

  it("Oracle swap post shutdown", async function () {
    // Approvals
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: tokenHolder });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: other });

    // Create one position with 200 synthetic tokens to mint with 300 tokens of collateral. For this test say the
    // collateral is WETH with a value of 1USD and the synthetic is some fictional stock or commodity.
    const amountCollateral = toWei("300");
    const numTokens = toWei("200");
    await positionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Transfer 100 the tokens from the sponsor to two separate holders. IRL this happens through the sponsor selling
    // tokens.
    const tokenHolderTokens = toWei("100");
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });
    await tokenCurrency.methods.transfer(other, tokenHolderTokens).send({ from: sponsor });

    // Emergency shutdown contract to enable settlement.
    const emergencyShutdownTime = await positionManager.methods.getCurrentTime().call();
    await financialContractsAdmin.methods
      .callEmergencyShutdown(positionManager.options.address)
      .send({ from: accounts[0] });

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 200 units of outstanding tokens this results in a token redemption value of: TRV = 200 * 1.2 = 240 USD.
    await mockOracle.methods
      .pushPrice(priceFeedIdentifier, emergencyShutdownTime, toWei("1.2"))
      .send({ from: accounts[0] });

    // Token holder should receive 120 collateral tokens for their 100 synthetic tokens.
    let initialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    await positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder });
    let collateralPaid = toBN(await collateral.methods.balanceOf(tokenHolder).call()).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("120"));

    // Create new oracle, replace it in the finder, and push a different price to it.
    const newMockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({
      from: accounts[0],
    });
    const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
    await finder.methods
      .changeImplementationAddress(mockOracleInterfaceName, newMockOracle.options.address)
      .send({ from: contractDeployer });

    // Settle emergency shutdown should still work even if the new oracle has no price.
    initialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    await positionManager.methods.settleEmergencyShutdown().send({ from: sponsor });
    collateralPaid = toBN(await collateral.methods.balanceOf(sponsor).call()).sub(initialCollateral);

    // Sponsor should have received 300 - 240 = 60 collateral tokens.
    assert.equal(collateralPaid, toWei("60"));

    // Push a different price to the new oracle to ensure the contract still uses the old price.
    await newMockOracle.methods.requestPrice(priceFeedIdentifier, emergencyShutdownTime).send({ from: accounts[0] });
    await newMockOracle.methods
      .pushPrice(priceFeedIdentifier, emergencyShutdownTime, toWei("0.8"))
      .send({ from: accounts[0] });

    // Second token holder should receive the same payout as the first despite the oracle price being changed.
    initialCollateral = toBN(await collateral.methods.balanceOf(other).call());
    await positionManager.methods.settleEmergencyShutdown().send({ from: other });
    collateralPaid = toBN(await collateral.methods.balanceOf(other).call()).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("120"));
  });

  it("Oracle price can resolve to 0", async function () {
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: tokenHolder });

    // For the price to resolve to 0 the outcome is likely a binary event (1 for true, 0 for false.)
    await positionManager.methods
      .create({ rawValue: toWei("300") }, { rawValue: toWei("200") })
      .send({ from: sponsor });
    await tokenCurrency.methods.transfer(tokenHolder, toWei("100")).send({ from: sponsor });

    // Emergency shutdown contract to enable settlement.
    const emergencyShutdownTime = await positionManager.methods.getCurrentTime().call();
    await financialContractsAdmin.methods
      .callEmergencyShutdown(positionManager.options.address)
      .send({ from: accounts[0] });

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 0. This means that
    // each token debt is worth 0 and the sponsor should get back their full collateral, even though they dont have all
    // the tokens. The token holder should get nothing.
    await mockOracle.methods
      .pushPrice(priceFeedIdentifier, emergencyShutdownTime, toWei("0"))
      .send({ from: accounts[0] });

    // Token holder should receive 0 collateral tokens for their 100 synthetic tokens as the price is 0.
    let initialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    await positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder });
    let collateralPaid = toBN(await collateral.methods.balanceOf(tokenHolder).call()).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("0"));

    // Settle emergency from the sponsor should give them back all their collateral, as token debt is worth 0.
    initialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    await positionManager.methods.settleEmergencyShutdown().send({ from: sponsor });
    collateralPaid = toBN(await collateral.methods.balanceOf(sponsor).call()).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("300"));
  });

  it("Undercapitalized contract", async function () {
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: other });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: other });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: tokenHolder });

    // Create one undercapitalized sponsor and one overcollateralized sponsor.
    await positionManager.methods.create({ rawValue: toWei("50") }, { rawValue: toWei("100") }).send({ from: sponsor });
    await positionManager.methods.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }).send({ from: other });

    // Transfer 150 tokens to the token holder and leave the overcollateralized sponsor with 25.
    await tokenCurrency.methods.transfer(tokenHolder, toWei("75")).send({ from: other });
    await tokenCurrency.methods.transfer(tokenHolder, toWei("75")).send({ from: sponsor });

    // Emergency shutdown contract to enable settlement.
    const emergencyShutdownTime = await positionManager.methods.getCurrentTime().call();
    await financialContractsAdmin.methods
      .callEmergencyShutdown(positionManager.options.address)
      .send({ from: accounts[0] });

    // Settle the price to 1, meaning the overcollateralized sponsor has 50 units of excess collateral.
    await mockOracle.methods
      .pushPrice(priceFeedIdentifier, emergencyShutdownTime, toWei("1"))
      .send({ from: accounts[0] });

    // Token holder is the first to settle -- they should receive the entire value of their tokens (100) because they
    // were first.
    let startingBalance = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    await positionManager.methods.settleEmergencyShutdown().send({ from: tokenHolder });
    assert.equal(
      (await collateral.methods.balanceOf(tokenHolder).call()).toString(),
      startingBalance.add(toBN(toWei("150")))
    );

    // The overcollateralized sponsor should see a haircut because they settled later.
    // The overcollateralized sponsor is owed 75 because of the 50 in excess collateral and the 25 in tokens.
    // But there's only 50 left in the contract, so we should see only 50 paid out.
    startingBalance = toBN(await collateral.methods.balanceOf(other).call());
    await positionManager.methods.settleEmergencyShutdown().send({ from: other });
    assert.equal((await collateral.methods.balanceOf(other).call()).toString(), startingBalance.add(toBN(toWei("50"))));

    // The undercapitalized sponsor should get nothing even though they have tokens because the contract has no more collateral.
    startingBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    await positionManager.methods.settleEmergencyShutdown().send({ from: sponsor });
    assert.equal((await collateral.methods.balanceOf(sponsor).call()).toString(), startingBalance.add(toBN("0")));
  });

  it("Cannot create position smaller than min sponsor size", async function () {
    // Attempt to create position smaller than 5 wei tokens (the min sponsor position size)
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });

    assert(
      await didContractThrow(
        positionManager.methods.create({ rawValue: "40" }, { rawValue: "4" }).send({ from: sponsor })
      )
    );
  });

  it("Cannot reduce position size below min sponsor size", async function () {
    // Attempt to redeem a position smaller s.t. the resulting position is less than 5 wei tokens (the min sponsor
    // position size)
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });

    await positionManager.methods.create({ rawValue: "40" }, { rawValue: "20" }).send({ from: sponsor });

    assert(await didContractThrow(positionManager.methods.redeem({ rawValue: "16" }).send({ from: sponsor })));
  });

  it("Gulp edge cases", async function () {
    // Gulp does not revert if PfC and collateral balance are both 0
    await positionManager.methods.gulp().send({ from: accounts[0] });

    // Send 1 wei of excess collateral to the contract.
    await collateral.methods.transfer(positionManager.options.address, "1").send({ from: sponsor });

    // Gulp reverts if PfC is 0 but collateral balance is > 0.
    assert(await didContractThrow(positionManager.methods.gulp().send({ from: accounts[0] })));

    // Create a position to gulp.
    await collateral.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods.approve(positionManager.options.address, toWei("100000")).send({ from: sponsor });
    await positionManager.methods.create({ rawValue: toWei("10") }, { rawValue: "20" }).send({ from: sponsor });

    // Gulp does not do anything if the intermediate calculation (collateral balance / PfC) has precision loss.
    // For example:
    // - collateral balance = 10e18 + 1
    // - PfC = 10e18
    // - Gulp ratio = (10e18 + 1) / 10e18 =  1.0000000000000000001, which is 1e18 + 1e-19, which gets truncated to 1e18
    // - Therefore, the multiplier remains at 1e18.
    await positionManager.methods.gulp().send({ from: accounts[0] });
    assert.equal((await positionManager.methods.cumulativeFeeMultiplier().call()).toString(), web3.utils.toWei("1"));

    // Gulp will shift the multiplier if enough excess collateral builds up in the contract to negate precision loss.
    await collateral.methods.transfer(positionManager.options.address, "9").send({ from: sponsor });
    await positionManager.methods.gulp().send({ from: accounts[0] });
    assert.equal(
      (await positionManager.methods.cumulativeFeeMultiplier().call()).toString(),
      web3.utils.toWei("1.000000000000000001")
    );
  });

  it("Non-standard ERC20 delimitation", async function () {
    // To test non-standard ERC20 token delimitation a new ERC20 token is created which has 6 decimal points of precision.
    // A new priceless position manager is then created and and set to use this token as collateral. To generate values
    // which represent the appropriate scaling for USDC, .muln(1e6) is used over toWei as the latter scaled by 1e18.

    // Create a test net token with non-standard delimitation like USDC (6 decimals) and mint tokens.
    const USDCToken = await TestnetERC20.new("USDC", "USDC", 6).send({ from: accounts[0] });
    await USDCToken.methods.allocateTo(sponsor, toWei("100")).send({ from: accounts[0] });

    const nonStandardToken = await SyntheticToken.new(syntheticName, syntheticSymbol, 6).send({ from: accounts[0] });
    let custompositionManager = await PerpetualPositionManager.new(
      withdrawalLiveness, // _withdrawalLiveness
      USDCToken.options.address, // _collateralAddress
      nonStandardToken.options.address, // _tokenAddress
      finder.options.address, // _finderAddress
      priceFeedIdentifier, // _priceFeedIdentifier
      fundingRateFeedIdentifier, // _fundingRateFeedIdentifier
      { rawValue: minSponsorTokens }, // _minSponsorTokens
      configStore.options.address, // _configStoreAddress
      { rawValue: toWei("1") }, // _tokenScaling
      timer.options.address // _timerAddress
    ).send({ from: contractDeployer });
    tokenCurrency = await SyntheticToken.at(await custompositionManager.methods.tokenCurrency().call());
    await tokenCurrency.methods.addMinter(custompositionManager.options.address).send({ from: accounts[0] });
    await tokenCurrency.methods.addBurner(custompositionManager.options.address).send({ from: accounts[0] });

    // Token currency and collateral have same # of decimals.
    assert.equal(await tokenCurrency.methods.decimals().call(), 6);

    // Create the initial custom positionManager position. 100 synthetics backed by 150 collat
    const createTokens = toBN("100").muln(1e6).toString();
    // The collateral is delimited by the same number of decimals. 150 * 1e6
    const createCollateral = toBN("150").muln(1e6).toString();
    let expectedSponsorTokens = toBN(createTokens);
    let expectedContractCollateral = toBN(createCollateral);

    await USDCToken.methods.approve(custompositionManager.options.address, createCollateral).send({ from: sponsor });
    await custompositionManager.methods
      .create({ rawValue: createCollateral }, { rawValue: createTokens })
      .send({ from: sponsor });

    // The balances minted should equal that expected from the create function.
    assert.equal(
      (await USDCToken.methods.balanceOf(custompositionManager.options.address).call()).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal((await tokenCurrency.methods.balanceOf(sponsor).call()).toString(), expectedSponsorTokens.toString());

    // Deposit an additional 50 USDC to the position. Sponsor now has 200 USDC as collateral.
    const depositCollateral = toBN("50").muln(1e6).toString();
    expectedContractCollateral = expectedContractCollateral.add(toBN(depositCollateral));
    await USDCToken.methods.approve(custompositionManager.options.address, depositCollateral).send({ from: sponsor });
    await custompositionManager.methods.deposit({ rawValue: depositCollateral }).send({ from: sponsor });

    // The balances should reflect the additional collateral added.
    assert.equal(
      (await USDCToken.methods.balanceOf(custompositionManager.options.address).call()).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal((await tokenCurrency.methods.balanceOf(sponsor).call()).toString(), expectedSponsorTokens.toString());
    assert.equal(
      (await custompositionManager.methods.getCollateral(sponsor).call()).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal(
      (await custompositionManager.methods.positions(sponsor).call()).tokensOutstanding.toString(),
      expectedSponsorTokens.toString()
    );
    assert.equal(
      (await custompositionManager.methods.totalPositionCollateral().call()).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal(
      (await custompositionManager.methods.totalTokensOutstanding().call()).toString(),
      expectedSponsorTokens.toString()
    );

    // By matching collateral and synthetic precision, we can assume that oracle price requests will always resolve to 18 decimals.
    // The two cases that need to be tested are responding to dispute requests and settlement.
    // Dispute and liquidation is tested in `Liquidatable.js`. Here we test settlement.

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    // Sponsor now has 50 synthetics and 200 collateral. Note that synthetic tokens are still represented with 1e18 base.
    const tokenHolderTokens = toBN("50").muln(1e6).toString();
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    const emergencyShutdownTime = await positionManager.methods.getCurrentTime().call();
    await financialContractsAdmin.methods
      .callEmergencyShutdown(custompositionManager.options.address)
      .send({ from: accounts[0] });

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
    const redemptionPrice = toBN(toWei("1.2")); // 1.2*1e18
    await mockOracle.methods
      .pushPrice(priceFeedIdentifier, emergencyShutdownTime, redemptionPrice.toString())
      .send({ from: accounts[0] });

    // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
    // They have 50 tokens settled at a price of 1.2 should yield 60 units of underling (or 60 USD as underlying is WETH).
    const tokenHolderInitialCollateral = toBN(await USDCToken.methods.balanceOf(tokenHolder).call());
    const tokenHolderInitialSynthetic = toBN(await tokenCurrency.methods.balanceOf(tokenHolder).call());
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(custompositionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    let settleEmergencyShutdownResult = await custompositionManager.methods
      .settleEmergencyShutdown()
      .send({ from: tokenHolder });
    const tokenHolderFinalCollateral = toBN(await USDCToken.methods.balanceOf(tokenHolder).call());
    const tokenHolderFinalSynthetic = toBN(await tokenCurrency.methods.balanceOf(tokenHolder).call());

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
    await assertEventEmitted(settleEmergencyShutdownResult, custompositionManager, "SettleEmergencyShutdown", (ev) => {
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
    const sponsorInitialCollateral = toBN(await USDCToken.methods.balanceOf(sponsor).call());
    const sponsorInitialSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(custompositionManager.options.address, sponsorInitialSynthetic)
      .send({ from: sponsor });
    await custompositionManager.methods.settleEmergencyShutdown().send({ from: sponsor });
    const sponsorFinalCollateral = toBN(await USDCToken.methods.balanceOf(sponsor).call());
    const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

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
    const sponsorsPosition = await custompositionManager.methods.positions(sponsor).call();
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
  });
});
