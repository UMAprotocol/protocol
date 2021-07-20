const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
// Libraries and helpers
const { PositionStatesEnum, didContractThrow, OptimisticOracleRequestStatesEnum } = require("@uma/common");
const { interfaceName, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Contracts to test
const PricelessPositionManager = getContract("PricelessPositionManager");

// Other UMA related contracts and mocks
const Store = getContract("Store");
const Finder = getContract("Finder");
const OptimisticOracle = getContract("OptimisticOracle");
const MockOracle = getContract("MockOracleAncillary");
const AddressWhitelist = getContract("AddressWhitelist");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const MarginToken = getContract("ExpandedERC20");
const TestnetERC20 = getContract("TestnetERC20");
const SyntheticToken = getContract("SyntheticToken");
const FinancialContractsAdmin = getContract("FinancialContractsAdmin");
const FinancialProductLibraryTest = getContract("FinancialProductLibraryTest");
const Timer = getContract("Timer");

describe("PricelessPositionManager", function () {
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
  let pricelessPositionManager;
  let tokenCurrency;
  let identifierWhitelist;
  let collateralWhitelist;
  let optimisticOracle;
  let mockOracle;
  let financialContractsAdmin;
  let timer;
  let finder;
  let store;
  let ancillaryData;

  // Initial constant values
  const initialPositionTokens = toBN(toWei("1000"));
  const initialPositionCollateral = toBN(toWei("1"));
  const syntheticName = "Test Synthetic Token";
  const syntheticSymbol = "SYNTH";
  const withdrawalLiveness = 1000;
  const startTimestamp = Math.floor(Date.now() / 1000);
  const expirationTimestamp = startTimestamp + 10000;
  const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
  const minSponsorTokens = "5";
  const optimisticOracleLiveness = 7200;

  // Conveniently asserts expected collateral and token balances, assuming that
  // there is only one synthetic token holder, the sponsor. Also assumes no
  // precision loss from `getCollateral()` coming from the fee multiplier.
  const checkBalances = async (expectedSponsorTokens, expectedSponsorCollateral) => {
    const expectedTotalTokens = expectedSponsorTokens.add(initialPositionTokens);
    const expectedTotalCollateral = expectedSponsorCollateral.add(initialPositionCollateral);

    const positionData = await pricelessPositionManager.methods.positions(sponsor).call();
    const sponsorCollateral = await pricelessPositionManager.methods.getCollateral(sponsor).call();
    assert.equal(sponsorCollateral.toString(), expectedSponsorCollateral.toString());
    // The below assertion only holds if the sponsor holds all of the tokens outstanding.
    assert.equal(positionData.tokensOutstanding.toString(), expectedSponsorTokens.toString());
    assert.equal((await tokenCurrency.methods.balanceOf(sponsor).call()).toString(), expectedSponsorTokens.toString());

    assert.equal(
      (await pricelessPositionManager.methods.totalPositionCollateral().call()).toString(),
      expectedTotalCollateral.toString()
    );
    assert.equal(
      (await pricelessPositionManager.methods.totalTokensOutstanding().call()).toString(),
      expectedTotalTokens.toString()
    );
    assert.equal(
      await collateral.methods.balanceOf(pricelessPositionManager.options.address).call(),
      expectedTotalCollateral.toString()
    );
  };

  const proposeAndSettleOptimisticOraclePrice = async (priceFeedIdentifier, requestTime, price) => {
    await collateral.methods.approve(optimisticOracle.options.address, toWei("1000000")).send({ from: proposer });
    const proposalTime = await optimisticOracle.methods.getCurrentTime().call();
    await optimisticOracle.methods
      .proposePrice(pricelessPositionManager.options.address, priceFeedIdentifier, requestTime, ancillaryData, price)
      .send({ from: proposer });
    await optimisticOracle.methods.setCurrentTime(proposalTime + optimisticOracleLiveness).send({ from: accounts[0] });
    await optimisticOracle.methods
      .settle(pricelessPositionManager.options.address, priceFeedIdentifier, requestTime, ancillaryData)
      .send({ from: accounts[0] });
  };

  const verifyState = async (priceFeedIdentifier, requestTime, state) => {
    assert.equal(
      (
        await optimisticOracle.methods
          .getState(pricelessPositionManager.options.address, priceFeedIdentifier, requestTime, ancillaryData)
          .call()
      ).toString(),
      state
    );
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [contractDeployer, sponsor, tokenHolder, other, collateralOwner, proposer] = accounts;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
    store = await Store.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    financialContractsAdmin = await FinancialContractsAdmin.deployed();

    // Register the price tracking ticker.
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: contractDeployer });
  });

  beforeEach(async () => {
    // Represents WETH or some other token that the sponsor and contracts don't control.
    collateral = await MarginToken.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    await collateral.methods.addMember(1, collateralOwner).send({ from: accounts[0] });
    await collateral.methods.mint(sponsor, toWei("1000000")).send({ from: collateralOwner });
    await collateral.methods.mint(other, toWei("1000000")).send({ from: collateralOwner });
    await collateral.methods.mint(proposer, toWei("1000000")).send({ from: collateralOwner });

    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: accounts[0] });

    tokenCurrency = await SyntheticToken.new(syntheticName, syntheticSymbol, 18).send({ from: accounts[0] });

    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.methods.setCurrentTime(startTimestamp).send({ from: accounts[0] });

    // Create a mockOracle and finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: accounts[0] });
    const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
    await finder.methods
      .changeImplementationAddress(mockOracleInterfaceName, mockOracle.options.address)
      .send({ from: contractDeployer });

    // Set up a fresh optimistic oracle in the finder.
    optimisticOracle = await OptimisticOracle.new(
      optimisticOracleLiveness,
      finder.options.address,
      timer.options.address
    ).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: contractDeployer });

    // Create the instance of the PricelessPositionManager to test against.
    // The contract expires 10k seconds in the future -> will not expire during this test case.
    pricelessPositionManager = await PricelessPositionManager.new(
      expirationTimestamp, // _expirationTimestamp
      withdrawalLiveness, // _withdrawalLiveness
      collateral.options.address, // _collateralAddress
      tokenCurrency.options.address, // _tokenAddress
      finder.options.address, // _finderAddress
      priceFeedIdentifier, // _priceFeedIdentifier
      { rawValue: minSponsorTokens }, // _minSponsorTokens
      timer.options.address, // _timerAddress
      ZERO_ADDRESS // _financialProductLibraryAddress
    ).send({ from: contractDeployer });
    // Give contract owner permissions.
    await tokenCurrency.methods.addMinter(pricelessPositionManager.options.address).send({ from: accounts[0] });
    await tokenCurrency.methods.addBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });

    ancillaryData = tokenCurrency.options.address;
  });
  it("Valid constructor params", async function () {
    // Expiration timestamp must be greater than contract current time.
    assert(
      await didContractThrow(
        PricelessPositionManager.new(
          startTimestamp, // _expirationTimestamp
          withdrawalLiveness, // _withdrawalLiveness
          collateral.options.address, // _collateralAddress
          tokenCurrency.options.address, // _tokenAddress
          finder.options.address, // _finderAddress
          priceFeedIdentifier, // _priceFeedIdentifier
          { rawValue: minSponsorTokens }, // _minSponsorTokens
          timer.options.address, // _timerAddress
          ZERO_ADDRESS // _financialProductLibraryAddress
        ).send({ from: contractDeployer })
      )
    );

    // Pricefeed identifier must be whitelisted.
    assert(
      await didContractThrow(
        PricelessPositionManager.new(
          expirationTimestamp, // _expirationTimestamp
          withdrawalLiveness, // _withdrawalLiveness
          collateral.options.address, // _collateralAddress
          tokenCurrency.options.address, // _tokenAddress
          finder.options.address, // _finderAddress
          utf8ToHex("UNREGISTERED"), // _priceFeedIdentifier
          { rawValue: minSponsorTokens }, // _minSponsorTokens
          timer.options.address, // _timerAddress
          ZERO_ADDRESS // _financialProductLibraryAddress
        ).send({ from: contractDeployer })
      )
    );
  });

  it("Correct deployment and variable assignment", async function () {
    // PricelessPosition variables
    assert.equal(await pricelessPositionManager.methods.expirationTimestamp().call(), expirationTimestamp);
    assert.equal(await pricelessPositionManager.methods.withdrawalLiveness().call(), withdrawalLiveness);
    assert.equal(await pricelessPositionManager.methods.collateralCurrency().call(), collateral.options.address);
    assert.equal(await pricelessPositionManager.methods.tokenCurrency().call(), tokenCurrency.options.address);
    assert.equal(await pricelessPositionManager.methods.finder().call(), finder.options.address);
    assert.equal(
      hexToUtf8(await pricelessPositionManager.methods.priceIdentifier().call()),
      hexToUtf8(priceFeedIdentifier)
    );
    assert.equal(await pricelessPositionManager.methods.contractState().call(), PositionStatesEnum.OPEN);

    // Synthetic token
    assert.equal(await tokenCurrency.methods.name().call(), syntheticName);
    assert.equal(await tokenCurrency.methods.symbol().call(), syntheticSymbol);

    // Reverts on bad constructor input (unknown identifier)
    assert(
      await didContractThrow(
        PricelessPositionManager.new(
          expirationTimestamp, // _expirationTimestamp (unchanged)
          withdrawalLiveness, // _withdrawalLiveness (unchanged)
          collateral.options.address, // _collateralAddress (unchanged)
          tokenCurrency.options.address, // _tokenAddress (unchanged)
          finder.options.address, // _finderAddress (unchanged)
          utf8ToHex("UNKNOWN"), // Some identifier that the whitelist tracker does not know
          { rawValue: minSponsorTokens }, // _minSponsorTokens (unchanged)
          timer.options.address, // _timerAddress (unchanged)
          ZERO_ADDRESS // _financialProductLibraryAddress (unchanged)
        ).send({ from: contractDeployer })
      )
    );
  });

  it("Withdrawal/Transfer liveness overflow", async function () {
    // Create a contract with a very large withdrawal liveness, i.e., withdrawal requests will never pass.
    tokenCurrency = await SyntheticToken.new(syntheticName, syntheticSymbol, 18).send({ from: accounts[0] });

    const largeLiveness = toBN(2).pow(toBN(256)).subn(10).toString();
    pricelessPositionManager = await PricelessPositionManager.new(
      expirationTimestamp, // _expirationTimestamp
      largeLiveness.toString(), // _withdrawalLiveness
      collateral.options.address, // _collateralAddress
      tokenCurrency.options.address, // _tokenAddress
      finder.options.address, // _finderAddress
      priceFeedIdentifier, // _priceFeedIdentifier
      { rawValue: minSponsorTokens }, // _minSponsorTokens
      timer.options.address, // _timerAddress
      ZERO_ADDRESS // _financialProductLibraryAddress
    ).send({ from: contractDeployer });
    await tokenCurrency.methods.addMinter(pricelessPositionManager.options.address).send({ from: accounts[0] });
    await tokenCurrency.methods.addBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });

    const initialSponsorTokens = toWei("100");
    const initialSponsorCollateral = toWei("150");
    await collateral.methods
      .approve(pricelessPositionManager.options.address, initialSponsorCollateral)
      .send({ from: sponsor });
    await pricelessPositionManager.methods
      .create({ rawValue: initialSponsorCollateral }, { rawValue: initialSponsorTokens })
      .send({ from: sponsor });
    // Withdrawal/Transfer requests should fail due to overflow.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .requestWithdrawal({ rawValue: initialSponsorCollateral })
          .send({ from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.methods.requestTransferPosition().send({ from: sponsor })));
  });

  it("Lifecycle", async function () {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.methods
      .approve(pricelessPositionManager.options.address, initialPositionCollateral)
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    // Create the initial pricelessPositionManager.
    const createTokens = toWei("100");
    const createCollateral = toWei("150");
    let expectedSponsorTokens = toBN(createTokens);
    let expectedSponsorCollateral = toBN(createCollateral);
    // Fails without approving collateral.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .create({ rawValue: createCollateral }, { rawValue: createTokens })
          .send({ from: sponsor })
      )
    );
    await collateral.methods
      .approve(pricelessPositionManager.options.address, createCollateral)
      .send({ from: sponsor });
    const createResult = await pricelessPositionManager.methods
      .create({ rawValue: createCollateral }, { rawValue: createTokens })
      .send({ from: sponsor });
    await assertEventEmitted(createResult, pricelessPositionManager, "PositionCreated", (ev) => {
      return (
        ev.sponsor == sponsor &&
        ev.collateralAmount == createCollateral.toString() &&
        ev.tokenAmount == createTokens.toString()
      );
    });
    await assertEventEmitted(createResult, pricelessPositionManager, "NewSponsor", (ev) => {
      return ev.sponsor == sponsor;
    });

    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Deposit.
    const depositCollateral = toWei("50");
    expectedSponsorCollateral = expectedSponsorCollateral.add(toBN(depositCollateral));
    // Fails without approving collateral.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.deposit({ rawValue: depositCollateral }).send({ from: sponsor })
      )
    );
    await collateral.methods
      .approve(pricelessPositionManager.options.address, depositCollateral)
      .send({ from: sponsor });
    // Cannot deposit 0 collateral.
    assert(await didContractThrow(pricelessPositionManager.methods.deposit({ rawValue: "0" }).send({ from: sponsor })));
    await pricelessPositionManager.methods.deposit({ rawValue: depositCollateral }).send({ from: sponsor });
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Withdraw.
    const withdrawCollateral = toWei("20");
    expectedSponsorCollateral = expectedSponsorCollateral.sub(toBN(withdrawCollateral));
    let sponsorInitialBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    // Cannot withdraw 0 collateral.
    assert(
      await didContractThrow(pricelessPositionManager.methods.withdraw({ rawValue: "0" }).send({ from: sponsor }))
    );
    // Cannot withdraw more than balance. (The position currently has 150 + 50 collateral).
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.withdraw({ rawValue: toWei("201") }).send({ from: sponsor })
      )
    );
    await pricelessPositionManager.methods.withdraw({ rawValue: withdrawCollateral }).send({ from: sponsor });
    let sponsorFinalBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), withdrawCollateral);
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Redeem 50% of the tokens for 50% of the collateral.
    const redeemTokens = toWei("50");
    expectedSponsorTokens = expectedSponsorTokens.sub(toBN(redeemTokens));
    expectedSponsorCollateral = expectedSponsorCollateral.divn(2);
    // Fails without approving token.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.redeem({ rawValue: redeemTokens }).send({ from: sponsor })
      )
    );
    await tokenCurrency.methods.approve(pricelessPositionManager.options.address, redeemTokens).send({ from: sponsor });
    sponsorInitialBalance = toBN(await collateral.methods.balanceOf(sponsor).call());

    // Check redeem return value and event.
    const redeem = pricelessPositionManager.methods.redeem;
    const redeemedCollateral = await redeem({ rawValue: redeemTokens }).call({ from: sponsor });
    assert.equal(redeemedCollateral.toString(), expectedSponsorCollateral.toString());
    // Check that redeem fails if missing Burner role.
    await tokenCurrency.methods.removeBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });
    assert(await didContractThrow(redeem({ rawValue: redeemTokens }).send({ from: sponsor })));
    await tokenCurrency.methods.addBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });
    let redemptionResult = await redeem({ rawValue: redeemTokens }).send({ from: sponsor });
    await assertEventEmitted(redemptionResult, pricelessPositionManager, "Redeem", (ev) => {
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
    // Check that create fails if missing Minter role.
    await tokenCurrency.methods.removeMinter(pricelessPositionManager.options.address).send({ from: accounts[0] });
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .create({ rawValue: createAdditionalCollateral }, { rawValue: createAdditionalTokens })
          .send({ from: sponsor })
      )
    );
    await tokenCurrency.methods.addMinter(pricelessPositionManager.options.address).send({ from: accounts[0] });
    await collateral.methods
      .approve(pricelessPositionManager.options.address, createAdditionalCollateral)
      .send({ from: sponsor });
    await pricelessPositionManager.methods
      .create({ rawValue: createAdditionalCollateral }, { rawValue: createAdditionalTokens })
      .send({ from: sponsor });
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Redeem full.
    const redeemRemainingTokens = toWei("60");
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, redeemRemainingTokens)
      .send({ from: sponsor });
    sponsorInitialBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    redemptionResult = await pricelessPositionManager.methods
      .redeem({ rawValue: redeemRemainingTokens })
      .send({ from: sponsor });
    await assertEventEmitted(redemptionResult, pricelessPositionManager, "Redeem", (ev) => {
      return (
        ev.sponsor == sponsor &&
        ev.collateralAmount == expectedSponsorCollateral.toString() &&
        ev.tokenAmount == redeemRemainingTokens.toString()
      );
    });
    await assertEventEmitted(redemptionResult, pricelessPositionManager, "EndedSponsorPosition", (ev) => {
      return ev.sponsor == sponsor;
    });

    sponsorFinalBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), expectedSponsorCollateral);
    await checkBalances(toBN("0"), toBN("0"));

    // Contract state should not have changed.
    assert.equal(await pricelessPositionManager.methods.contractState().call(), PositionStatesEnum.OPEN);
  });

  it("Cannot instantly withdraw all of the collateral in the position", async function () {
    // Create an initial large and lowly collateralized pricelessPositionManager so that we can call `withdraw()`.
    await collateral.methods
      .approve(pricelessPositionManager.options.address, initialPositionCollateral)
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    // Create the initial pricelessPositionManager.
    const createTokens = toWei("100");
    const createCollateral = toWei("150");
    await collateral.methods
      .approve(pricelessPositionManager.options.address, createCollateral)
      .send({ from: sponsor });
    await pricelessPositionManager.methods
      .create({ rawValue: createCollateral }, { rawValue: createTokens })
      .send({ from: sponsor });

    // Cannot withdraw full collateral because the GCR check will always fail.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.withdraw({ rawValue: createCollateral }).send({ from: sponsor })
      )
    );
  });

  it("Withdrawal request", async function () {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.methods
      .approve(pricelessPositionManager.options.address, initialPositionCollateral)
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    const startTime = await pricelessPositionManager.methods.getCurrentTime().call();
    // Approve large amounts of token and collateral currencies: this test case isn't checking for that.
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("100000"))
      .send({ from: sponsor });

    // Create the initial pricelessPositionManager.
    const initialSponsorTokens = toWei("100");
    const initialSponsorCollateral = toWei("150");
    await pricelessPositionManager.methods
      .create({ rawValue: initialSponsorCollateral }, { rawValue: initialSponsorTokens })
      .send({ from: sponsor });

    // Must request greater than 0 and less than full position's collateral.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.requestWithdrawal({ rawValue: "0" }).send({ from: sponsor })
      )
    );
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.requestWithdrawal({ rawValue: toWei("151") }).send({ from: sponsor })
      )
    );

    // Cannot execute withdrawal request before a request is made.
    assert(await didContractThrow(pricelessPositionManager.methods.withdrawPassedRequest().send({ from: sponsor })));

    // Request withdrawal. Check event is emitted
    const resultRequestWithdrawal = await pricelessPositionManager.methods
      .requestWithdrawal({ rawValue: toWei("100") })
      .send({ from: sponsor });
    await assertEventEmitted(resultRequestWithdrawal, pricelessPositionManager, "RequestWithdrawal", (ev) => {
      return ev.sponsor == sponsor && ev.collateralAmount == toWei("100").toString();
    });

    // All other actions are locked.
    assert(
      await didContractThrow(pricelessPositionManager.methods.deposit({ rawValue: toWei("1") }).send({ from: sponsor }))
    );
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor })
      )
    );
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .create({ rawValue: toWei("1") }, { rawValue: toWei("1") })
          .send({ from: sponsor })
      )
    );
    assert(
      await didContractThrow(pricelessPositionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor }))
    );
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.requestWithdrawal({ rawValue: toWei("1") }).send({ from: sponsor })
      )
    );

    // Can't withdraw before time is up.
    await pricelessPositionManager.methods
      .setCurrentTime(parseInt(startTime) + withdrawalLiveness - 1)
      .send({ from: accounts[0] });
    assert(await didContractThrow(pricelessPositionManager.methods.withdrawPassedRequest().send({ from: sponsor })));

    // The price moved against the sponsor, and they need to cancel. Ensure event is emitted.
    const resultCancelWithdrawal = await pricelessPositionManager.methods.cancelWithdrawal().send({ from: sponsor });
    await assertEventEmitted(resultCancelWithdrawal, pricelessPositionManager, "RequestWithdrawalCanceled", (ev) => {
      return ev.sponsor == sponsor && ev.collateralAmount == toWei("100").toString();
    });

    // They can now request again.
    const withdrawalAmount = toWei("25");
    const expectedSponsorCollateral = toBN(initialSponsorCollateral).sub(toBN(withdrawalAmount));
    await pricelessPositionManager.methods.requestWithdrawal({ rawValue: withdrawalAmount }).send({ from: sponsor });

    // After time is up, execute the withdrawal request. Check event is emitted and return value is correct.
    await pricelessPositionManager.methods
      .setCurrentTime(parseInt(await pricelessPositionManager.methods.getCurrentTime().call()) + withdrawalLiveness)
      .send({ from: accounts[0] });
    const sponsorInitialBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    const expectedSponsorFinalBalance = sponsorInitialBalance.add(toBN(withdrawalAmount));
    const withdrawPassedRequest = pricelessPositionManager.methods.withdrawPassedRequest();
    let amountWithdrawn = await withdrawPassedRequest.call({ from: sponsor });
    assert.equal(amountWithdrawn.toString(), withdrawalAmount.toString());
    let resultWithdrawPassedRequest = await withdrawPassedRequest.send({ from: sponsor });
    await assertEventEmitted(
      resultWithdrawPassedRequest,
      pricelessPositionManager,
      "RequestWithdrawalExecuted",
      (ev) => {
        return ev.sponsor == sponsor && ev.collateralAmount == withdrawalAmount.toString();
      }
    );

    // Check that withdrawal-request related parameters in pricelessPositionManager are reset
    const positionData = await pricelessPositionManager.methods.positions(sponsor).call();
    assert.equal(positionData.withdrawalRequestPassTimestamp.toString(), 0);
    assert.equal(positionData.withdrawalRequestAmount.toString(), 0);

    // Verify state of pricelessPositionManager post-withdrawal.
    await checkBalances(toBN(initialSponsorTokens), expectedSponsorCollateral);
    const sponsorFinalBalance = await collateral.methods.balanceOf(sponsor).call();
    assert.equal(sponsorFinalBalance.toString(), expectedSponsorFinalBalance.toString());

    // Methods are now unlocked again.
    await pricelessPositionManager.methods.deposit({ rawValue: toWei("1") }).send({ from: sponsor });

    // First withdrawal that should pass. Ensure event is emitted and return value is correct.
    const withdraw = pricelessPositionManager.methods.withdraw;
    amountWithdrawn = await withdraw({ rawValue: toWei("1") }).call({ from: sponsor });
    assert.equal(amountWithdrawn.toString(), toWei("1"));
    const resultWithdraw = await withdraw({ rawValue: toWei("1") }).send({ from: sponsor });
    await assertEventEmitted(resultWithdraw, pricelessPositionManager, "Withdrawal", (ev) => {
      return ev.sponsor == sponsor && ev.collateralAmount.toString() == toWei("1");
    });

    await pricelessPositionManager.methods
      .create({ rawValue: toWei("125") }, { rawValue: toWei("100") })
      .send({ from: sponsor });
    await pricelessPositionManager.methods.redeem({ rawValue: toWei("100") }).send({ from: sponsor });
    await checkBalances(toBN(initialSponsorTokens), expectedSponsorCollateral);

    // Can't cancel if no withdrawals pending.
    assert(await didContractThrow(pricelessPositionManager.methods.cancelWithdrawal().send({ from: sponsor })));

    // Request to withdraw remaining collateral. Post-fees, this amount should get reduced to the remaining collateral.
    await pricelessPositionManager.methods.requestWithdrawal({ rawValue: toWei("125") }).send({ from: sponsor });
    // Setting fees to 0.00001 per second will charge (0.00001 * 1000) = 0.01 or 1 % of the collateral.
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.00001") }).send({ from: accounts[0] });
    await pricelessPositionManager.methods
      .setCurrentTime(parseInt(await pricelessPositionManager.methods.getCurrentTime().call()) + withdrawalLiveness)
      .send({ from: accounts[0] });
    resultWithdrawPassedRequest = await pricelessPositionManager.methods
      .withdrawPassedRequest()
      .send({ from: sponsor });
    await assertEventEmitted(
      resultWithdrawPassedRequest,
      pricelessPositionManager,
      "RequestWithdrawalExecuted",
      (ev) => {
        return ev.sponsor == sponsor && ev.collateralAmount == toWei("123.75").toString();
      }
    );
    // @dev: Can't easily call `checkBalances(initialSponsorTokens, 0)` here because of the fee charged, which is also
    // charged on the lowly-collateralized collateral (whose sponsor is `other`).

    // Contract state should not have changed.
    assert.equal(await pricelessPositionManager.methods.contractState().call(), PositionStatesEnum.OPEN);

    // Reset store state.
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });
  });

  it("Global collateralization ratio checks", async function () {
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: other });

    // Create the initial pricelessPositionManager, with a 150% collateralization ratio.
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("150") }, { rawValue: toWei("100") })
      .send({ from: sponsor });

    // Any withdrawal requests should fail, because withdrawals would reduce the global collateralization ratio.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor })
      )
    );

    // Because there is only 1 sponsor, neither the sponsor nor potential new sponsors can create below the global ratio.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .create({ rawValue: toWei("150") }, { rawValue: toWei("101") })
          .send({ from: sponsor })
      )
    );
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .create({ rawValue: toWei("150") }, { rawValue: toWei("101") })
          .send({ from: other })
      )
    );

    // Because there is only 1 sponsor, both the sponsor and potential new sponsors must create equal to or above the global ratio.
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("15") }, { rawValue: toWei("10") })
      .send({ from: sponsor });
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("25") }, { rawValue: toWei("10") })
      .send({ from: other });

    // At this point the GCR is (150 + 15 + 25) / (100 + 10 + 10) = 158.3%.

    // Since the smaller sponsor is well above the GCR at 250%, they can create new tokens with 0 collateral. Let's say they want
    // to create 5 tokens with 0 collateral. Their new position CR will be 25/10+5 = 166.7%.
    // Therefore, their resultant CR > GCR and this creation is valid. However, if they instead created 6 tokens with 0 collateral, then their
    // resultant CR would be 25/10+6 = 156.3%.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .create({ rawValue: toWei("0") }, { rawValue: toWei("6") })
          .send({ from: other })
      )
    );
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("0") }, { rawValue: toWei("5") })
      .send({ from: other });

    // The new GCR is (190 / 120+5) = 152%. The large sponsor's CR is (165/110) = 150%, so they cannot withdraw
    // any tokens.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor })
      )
    );

    // Additionally, the large sponsor cannot create any tokens UNLESS their created tokens to deposited collateral ratio > GCR.
    // If the large sponsor wants to create 0.1 more tokens, then they would need to deposit at least 0.152 collateral.
    // This would make their position CR (165+0.152/110+0.1) slightly > 150%, still below the GCR, but the new create ratio > GCR.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .create({ rawValue: toWei("0.151") }, { rawValue: toWei("0.1") })
          .send({ from: sponsor })
      )
    );
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("0.152") }, { rawValue: toWei("0.1") })
      .send({ from: sponsor });

    // For the "other" Position:
    // global collateralization ratio = (190.152) / (125.1) = 1.52
    // To maintain 15 tokens, need at least 22.8 collateral => e.g. can withdraw from 25 down to 23 but not to 22.
    assert(
      await didContractThrow(pricelessPositionManager.methods.withdraw({ rawValue: toWei("3") }).send({ from: other }))
    );
    await pricelessPositionManager.methods.withdraw({ rawValue: toWei("2") }).send({ from: other });
  });

  it("Transfer position request", async function () {
    const startTime = await pricelessPositionManager.methods.getCurrentTime().call();

    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.methods
      .approve(pricelessPositionManager.options.address, initialPositionCollateral)
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    // Create the initial pricelessPositionManager.
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });
    assert.equal((await pricelessPositionManager.methods.getCollateral(sponsor).call()).toString(), amountCollateral);
    assert.equal(
      (await pricelessPositionManager.methods.positions(other).call()).rawCollateral.toString(),
      initialPositionCollateral.toString()
    );
    assert.equal((await pricelessPositionManager.methods.positions(tokenHolder).call()).rawCollateral.toString(), "0");

    // Cannot execute or cancel a transfer before requesting one.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.transferPositionPassedRequest(other).send({ from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.methods.cancelTransferPosition().send({ from: sponsor })));

    // Request transfer. Check event is emitted.
    const resultRequest = await pricelessPositionManager.methods.requestTransferPosition().send({ from: sponsor });
    await assertEventEmitted(resultRequest, pricelessPositionManager, "RequestTransferPosition", (ev) => {
      return ev.oldSponsor == sponsor;
    });

    // Cannot request another transfer while one is pending.
    assert(await didContractThrow(pricelessPositionManager.methods.requestTransferPosition().send({ from: sponsor })));

    // Can't transfer before time is up.
    await pricelessPositionManager.methods
      .setCurrentTime(parseInt(startTime) + withdrawalLiveness - 1)
      .send({ from: accounts[0] });
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.transferPositionPassedRequest(tokenHolder).send({ from: sponsor })
      )
    );

    // Sponsor can cancel transfer. Ensure that event is emitted.
    const resultCancel = await pricelessPositionManager.methods.cancelTransferPosition().send({ from: sponsor });
    await assertEventEmitted(resultCancel, pricelessPositionManager, "RequestTransferPositionCanceled", (ev) => {
      return ev.oldSponsor == sponsor;
    });

    // They can now request again.
    await pricelessPositionManager.methods.requestTransferPosition().send({ from: sponsor });

    // Advance time through liveness.
    await pricelessPositionManager.methods
      .setCurrentTime(parseInt(await pricelessPositionManager.methods.getCurrentTime().call()) + withdrawalLiveness)
      .send({ from: accounts[0] });

    // Can't transfer if the target already has a pricelessPositionManager.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.transferPositionPassedRequest(other).send({ from: sponsor })
      )
    );

    // Can't transfer if there is a pending withdrawal request.
    await pricelessPositionManager.methods.requestWithdrawal({ rawValue: toWei("1") }).send({ from: sponsor });
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.transferPositionPassedRequest(other).send({ from: sponsor })
      )
    );
    await pricelessPositionManager.methods.cancelWithdrawal().send({ from: sponsor });

    // Execute transfer to new sponsor. Check event is emitted.
    const result = await pricelessPositionManager.methods
      .transferPositionPassedRequest(tokenHolder)
      .send({ from: sponsor });
    await assertEventEmitted(result, pricelessPositionManager, "RequestTransferPositionExecuted", (ev) => {
      return ev.oldSponsor == sponsor && ev.newSponsor == tokenHolder;
    });
    await assertEventEmitted(result, pricelessPositionManager, "NewSponsor", (ev) => {
      return ev.sponsor == tokenHolder;
    });
    assert.equal(
      (await pricelessPositionManager.methods.positions(sponsor).call()).rawCollateral.toString(),
      toWei("0")
    );
    assert.equal(
      (await pricelessPositionManager.methods.getCollateral(tokenHolder).call()).toString(),
      amountCollateral
    );

    // Check that transfer-request related parameters in pricelessPositionManager are reset.
    const positionData = await pricelessPositionManager.methods.positions(sponsor).call();
    assert.equal(positionData.transferPositionRequestPassTimestamp.toString(), 0);

    // Contract state should not have changed.
    assert.equal(await pricelessPositionManager.methods.contractState().call(), PositionStatesEnum.OPEN);
  });

  it("Frozen when post expiry", async function () {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.methods
      .approve(pricelessPositionManager.options.address, initialPositionCollateral)
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("100000"))
      .send({ from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Start a withdrawal request to show that it can be canceled after expiry.
    await pricelessPositionManager.methods.requestWithdrawal({ rawValue: toWei("1") }).send({ from: sponsor });

    const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
    await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime) - 1).send({ from: accounts[0] });

    // Even though the contract isn't expired yet, can't issue a withdrawal or transfer request that would expire beyond the position expiry time.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.requestWithdrawal({ rawValue: toWei("1") }).send({ from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.methods.requestTransferPosition().send({ from: sponsor })));

    await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

    // All method calls should revert except for redeem and cancel withdraw request.

    // Cancel the withdraw request before attempting to call other methods. This should be allowed post-expiry.
    await pricelessPositionManager.methods.cancelWithdrawal().send({ from: sponsor });
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .create({ rawValue: amountCollateral }, { rawValue: numTokens })
          .send({ from: sponsor })
      )
    );
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor })
      )
    );
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.requestWithdrawal({ rawValue: toWei("1") }).send({ from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.methods.requestTransferPosition().send({ from: sponsor })));
    assert(
      await didContractThrow(pricelessPositionManager.methods.deposit({ rawValue: toWei("1") }).send({ from: sponsor }))
    );

    // Redemption should be possible post expiry.
    await pricelessPositionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor });
  });

  it("Settlement post expiry", async function () {
    // Create one position with 100 synthetic tokens to mint with 150 tokens of collateral. For this test say the
    // collateral is WETH with a value of 1USD and the synthetic is some fictional stock or commodity.
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = toWei("50");
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

    // Should revert if before contract expiration.
    assert(await didContractThrow(pricelessPositionManager.methods.settleExpired().send({ from: accounts[0] })));
    assert(await didContractThrow(pricelessPositionManager.methods.expire().send({ from: accounts[0] })));

    // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
    const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
    await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    const expireResult = await pricelessPositionManager.methods.expire().send({ from: other });
    assert.equal(
      await pricelessPositionManager.methods.contractState().call(),
      PositionStatesEnum.EXPIRED_PRICE_REQUESTED
    );
    await assertEventEmitted(expireResult, pricelessPositionManager, "ContractExpired", (ev) => {
      return ev.caller == other;
    });

    // Settling an expired position should revert if the contract has expired but the DVM has not yet returned a price.
    assert(await didContractThrow(pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder })));

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
    const redemptionPrice = 1.2;
    const redemptionPriceWei = toWei(redemptionPrice.toString());

    await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, parseInt(expirationTime), redemptionPriceWei);

    // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
    // They have 50 tokens settled at a price of 1.2 should yield 60 units of underling (or 60 USD as underlying is WETH).
    const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderInitialSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    let settleExpiredResult = await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
    assert.equal(
      await pricelessPositionManager.methods.contractState().call(),
      PositionStatesEnum.EXPIRED_PRICE_RECEIVED
    );
    const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderFinalSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();

    // The token holder should gain the value of their synthetic tokens in underlying.
    // The value in underlying is the number of tokens they held in the beginning * settlement price as TRV
    // When redeeming 50 tokens at a price of 1.2 we expect to receive 60 collateral tokens (50 * 1.2)
    const expectedTokenHolderFinalCollateral = toWei("60");
    assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // Check the event returned the correct values
    await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "SettleExpiredPosition", (ev) => {
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
    const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorInitialSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, sponsorInitialSynthetic)
      .send({ from: sponsor });

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 150 - 100 * 1.2 = 30
    const expectedSponsorCollateralUnderlying = toBN(toWei("30"));
    // Value of remaining synthetic tokens = 50 * 1.2 = 60
    const expectedSponsorCollateralSynthetic = toBN(toWei("60"));
    const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
      expectedSponsorCollateralSynthetic
    );

    // Redeem and settleExpired should give the same result as just settleExpired.
    const settleExpired = pricelessPositionManager.methods.settleExpired();

    // Get the amount as if we only settleExpired.
    const settleExpiredOnlyAmount = await settleExpired.call({ from: sponsor });

    // Partially redeem and partially settleExpired.
    const partialRedemptionAmount = await pricelessPositionManager.methods
      .redeem({ rawValue: toWei("1") })
      .call({ from: sponsor });
    await pricelessPositionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor });
    const partialSettleExpiredAmount = await settleExpired.call({ from: sponsor });
    settleExpiredResult = await settleExpired.send({ from: sponsor });

    // Compare the two paths' results.
    assert.equal(
      settleExpiredOnlyAmount.toString(),
      toBN(partialRedemptionAmount.toString()).add(toBN(partialSettleExpiredAmount.toString())).toString()
    );

    // Compare the amount to the expected return value.
    assert.equal(settleExpiredOnlyAmount.toString(), expectedTotalSponsorCollateralReturned.toString());

    // Check balances.
    const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();
    assert.equal(
      sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
      expectedTotalSponsorCollateralReturned
    );

    // Check events.
    await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "EndedSponsorPosition", (ev) => {
      return ev.sponsor == sponsor;
    });

    // The token Sponsor should have no synthetic positions left after settlement.
    assert.equal(sponsorFinalSynthetic, 0);

    // Last check is that after redemption the position in the positions mapping has been removed.
    const sponsorsPosition = await pricelessPositionManager.methods.positions(sponsor).call();
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
  });
  describe("Financial Product Library", () => {
    it("Custom price transformation", async function () {
      // Create a sample FinancialProductLibraryTest that simply doubles the settlement price. This test shows that the
      // oracle price can be overriden with the transformPrice from the library.
      const financialProductLibraryTest = await FinancialProductLibraryTest.new(
        { rawValue: toWei("2") }, // _priceTransformationScalar. Set to 2 to adjust the oracle price.
        { rawValue: toWei("1") }, // _collateralRequirementTransformationScalar. Set to 1 to not scale the contract CR.
        priceFeedIdentifier // _transformedPriceIdentifier. Set to the original priceFeedIdentifier to apply no transformation.
      ).send({ from: accounts[0] });

      assert.equal(
        (await financialProductLibraryTest.methods.priceTransformationScalar().call()).toString(),
        toWei("2")
      );
      assert.equal(
        (await financialProductLibraryTest.methods.transformPrice({ rawValue: "5" }, "0").call()).toString(),
        "10"
      ); // should scale prices by scalar. 5 * 2 = 10. Note the time(second param) does not matter in this test library

      pricelessPositionManager = await PricelessPositionManager.new(
        expirationTimestamp, // _expirationTimestamp
        withdrawalLiveness, // _withdrawalLiveness
        collateral.options.address, // _collateralAddress
        tokenCurrency.options.address, // _tokenAddress
        finder.options.address, // _finderAddress
        priceFeedIdentifier, // _priceFeedIdentifier
        { rawValue: minSponsorTokens }, // _minSponsorTokens
        timer.options.address, // _timerAddress
        financialProductLibraryTest.options.address // _financialProductLibraryAddress
      ).send({ from: contractDeployer });

      // Transform price function in pricelessPositionManager correctly scales input prices
      assert.equal(
        (await pricelessPositionManager.methods.transformPrice({ rawValue: "5" }, "0").call()).toString(),
        "10"
      );

      // Give contract owner permissions.
      await tokenCurrency.methods.addMinter(pricelessPositionManager.options.address).send({ from: accounts[0] });
      await tokenCurrency.methods.addBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });

      // collateral is Dai with a value of 1USD and the synthetic is some fictional stock or commodity.
      await collateral.methods
        .approve(pricelessPositionManager.options.address, toWei("100000"))
        .send({ from: sponsor });
      const numTokens = toWei("100");
      const amountCollateral = toWei("150");
      await pricelessPositionManager.methods
        .create({ rawValue: amountCollateral }, { rawValue: numTokens })
        .send({ from: sponsor });

      // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
      const tokenHolderTokens = toWei("50");
      await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

      // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
      const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
      await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

      // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
      await pricelessPositionManager.methods.expire().send({ from: other });

      // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for
      // the price feed. However, the scaler value of 0.6 was chosen in the financial product library. This means that the
      // EMP will scale the price reported by the DVM by 2, resulting in 0.6 bing intepreted as 1.2 by the settlement
      // logic. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
      const redemptionPrice = 0.6;
      const redemptionPriceWei = toWei(redemptionPrice.toString());
      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, parseInt(expirationTime), redemptionPriceWei);

      // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
      // They have 50 tokens settled at a price of 1.2 should yield 60 units of underling (or 60 USD as underlying is Dai).
      const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      const tokenHolderInitialSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();
      assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

      // Approve the tokens to be moved by the contract and execute the settlement.
      await tokenCurrency.methods
        .approve(pricelessPositionManager.options.address, tokenHolderInitialSynthetic)
        .send({ from: tokenHolder });
      let settleExpiredResult = await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
      assert.equal(
        await pricelessPositionManager.methods.contractState().call(),
        PositionStatesEnum.EXPIRED_PRICE_RECEIVED
      );
      const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      const tokenHolderFinalSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();

      // The token holder should gain the value of their synthetic tokens in underlying.
      // The value in underlying is the number of tokens they held in the beginning * settlement price as TRV
      // When redeeming 50 tokens at a price of 1.2 we expect to receive 60 collateral tokens (50 * 0.6 * 2)
      const expectedTokenHolderFinalCollateral = toWei("60");
      assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

      // The token holder should have no synthetic positions left after settlement.
      assert.equal(tokenHolderFinalSynthetic, 0);

      // Check the event returned the correct values
      await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "SettleExpiredPosition", (ev) => {
        return (
          ev.caller == tokenHolder &&
          ev.collateralReturned == tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral).toString() &&
          ev.tokensBurned == tokenHolderInitialSynthetic.toString()
        );
      });

      // For the sponsor, they are entitled to the underlying value of their remaining synthetic tokens + the excess collateral
      // in their position at time of settlement. The sponsor had 150 units of collateral in their position and the final TRV
      // of their synthetics they sold is 120. Their redeemed amount for this excess collateral is the difference between the two.
      // The sponsor also has 50 synthetic tokens that they did not sell. This makes their expected redemption = 150 - 120 + 50 * 0.6 * 2 = 90
      const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      const sponsorInitialSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

      // Approve tokens to be moved by the contract and execute the settlement.
      await tokenCurrency.methods
        .approve(pricelessPositionManager.options.address, sponsorInitialSynthetic)
        .send({ from: sponsor });

      // The token Sponsor should gain the value of their synthetics in underlying
      // + their excess collateral from the over collateralization in their position
      // Excess collateral = 150 - 100 * 0.6 * 2 = 30
      const expectedSponsorCollateralUnderlying = toBN(toWei("30"));
      // Value of remaining synthetic tokens = 50 * 0.6 * 2 = 60
      const expectedSponsorCollateralSynthetic = toBN(toWei("60"));
      const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
        expectedSponsorCollateralSynthetic
      );

      // Redeem and settleExpired should give the same result as just settleExpired.
      const settleExpired = pricelessPositionManager.methods.settleExpired();

      // Get the amount as if we only settleExpired.
      const settleExpiredOnlyAmount = await settleExpired.call({ from: sponsor });

      // Partially redeem and partially settleExpired.
      const partialRedemptionAmount = await pricelessPositionManager.methods
        .redeem({ rawValue: toWei("1") })
        .call({ from: sponsor });
      await pricelessPositionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor });
      const partialSettleExpiredAmount = await settleExpired.call({ from: sponsor });
      settleExpiredResult = await settleExpired.send({ from: sponsor });

      // Compare the two paths' results.
      assert.equal(
        settleExpiredOnlyAmount.toString(),
        toBN(partialRedemptionAmount.toString()).add(toBN(partialSettleExpiredAmount.toString())).toString()
      );

      // Compare the amount to the expected return value.
      assert.equal(settleExpiredOnlyAmount.toString(), expectedTotalSponsorCollateralReturned.toString());

      // Check balances.
      const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();
      assert.equal(
        sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
        expectedTotalSponsorCollateralReturned
      );

      // Check events.
      await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "EndedSponsorPosition", (ev) => {
        return ev.sponsor == sponsor;
      });

      // The token Sponsor should have no synthetic positions left after settlement.
      assert.equal(sponsorFinalSynthetic, 0);

      // Last check is that after redemption the position in the positions mapping has been removed.
      const sponsorsPosition = await pricelessPositionManager.methods.positions(sponsor).call();
      assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
      assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
      assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
      assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
      assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
    });

    it("Correctly handles reverting price transformation function ", async function () {
      // Create a sample FinancialProductLibraryTest that simply doubles the settlement price. However, we will set
      // the libary to revert on calls to test the PricelessPositionManager correctly deals with a "broken" library.
      const financialProductLibraryTest = await FinancialProductLibraryTest.new(
        { rawValue: toWei("2") }, // _priceTransformationScalar. Set to 2 to adjust the oracle price.
        { rawValue: toWei("1") }, // _collateralRequirementTransformationScalar. Set to 1 to not scale the contract CR.
        priceFeedIdentifier // _transformedPriceIdentifier. Set to the original priceFeedIdentifier to apply no transformation.
      ).send({ from: accounts[0] });

      await financialProductLibraryTest.methods.setShouldRevert(true).send({ from: accounts[0] });

      // calling the library directly should revert
      assert(
        await didContractThrow(
          financialProductLibraryTest.methods.transformPrice({ rawValue: "5" }, "0").send({ from: accounts[0] })
        )
      );

      pricelessPositionManager = await PricelessPositionManager.new(
        expirationTimestamp, // _expirationTimestamp
        withdrawalLiveness, // _withdrawalLiveness
        collateral.options.address, // _collateralAddress
        tokenCurrency.options.address, // _tokenAddress
        finder.options.address, // _finderAddress
        priceFeedIdentifier, // _priceFeedIdentifier
        { rawValue: minSponsorTokens }, // _minSponsorTokens
        timer.options.address, // _timerAddress
        financialProductLibraryTest.options.address // _financialProductLibraryAddress
      ).send({ from: contractDeployer });

      // Transform price function in pricelessPositionManager should apply NO transformation as library is reverting.
      assert.equal(
        (await pricelessPositionManager.methods.transformPrice({ rawValue: "5" }, "0").call()).toString(),
        "5"
      );
    });

    it("Custom price identifier transformation", async function () {
      // Create a sample FinancialProductLibraryTest that simply returns the transformed price identifier instead of the
      // provided priceFeedIdentifier. This should be used when calling the DVM and all associated functions.
      const transformedPriceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER_TRANSFORMED");

      const financialProductLibraryTest = await FinancialProductLibraryTest.new(
        { rawValue: toWei("1") }, // _priceTransformationScalar. Set to 1 to not scale the oracle price.
        { rawValue: toWei("1") }, // _collateralRequirementTransformationScalar. Set to 1 to not scale the contract CR.
        transformedPriceFeedIdentifier // _transformedPriceIdentifier. Set to a transformed value to test transformation logic.
      ).send({ from: accounts[0] });

      // The transformation identifier should be set correctly.
      assert.equal(
        hexToUtf8(await financialProductLibraryTest.methods.transformedPriceIdentifier().call()),
        hexToUtf8(transformedPriceFeedIdentifier)
      );

      // The input identifier should be transformed correctly. Note the "0" is the request time, which is not important with this test financial product library.
      assert.equal(
        hexToUtf8(await financialProductLibraryTest.methods.transformPriceIdentifier(priceFeedIdentifier, "0").call()),
        hexToUtf8(transformedPriceFeedIdentifier)
      ); // should scale prices by scalar. 5 * 2 = 10. Note the time(second param) does not matter in this test library.

      // Register the transformed price identifier with the identifier whitelist.
      identifierWhitelist = await IdentifierWhitelist.deployed();
      await identifierWhitelist.methods
        .addSupportedIdentifier(transformedPriceFeedIdentifier)
        .send({ from: contractDeployer });

      pricelessPositionManager = await PricelessPositionManager.new(
        expirationTimestamp, // _expirationTimestamp
        withdrawalLiveness, // _withdrawalLiveness
        collateral.options.address, // _collateralAddress
        tokenCurrency.options.address, // _tokenAddress
        finder.options.address, // _finderAddress
        priceFeedIdentifier, // _priceFeedIdentifier
        { rawValue: minSponsorTokens }, // _minSponsorTokens
        timer.options.address, // _timerAddress
        financialProductLibraryTest.options.address // _financialProductLibraryAddress
      ).send({ from: contractDeployer });

      // Price identifier transformation function correctly transforms the price identifier.
      assert.equal(
        hexToUtf8(await pricelessPositionManager.methods.transformPriceIdentifier("0").call()),
        hexToUtf8(transformedPriceFeedIdentifier)
      );

      // Give contract owner permissions.
      await tokenCurrency.methods.addMinter(pricelessPositionManager.options.address).send({ from: accounts[0] });
      await tokenCurrency.methods.addBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });

      await collateral.methods
        .approve(pricelessPositionManager.options.address, toWei("100000"))
        .send({ from: sponsor });
      const numTokens = toWei("100");
      const amountCollateral = toWei("150");
      await pricelessPositionManager.methods
        .create({ rawValue: amountCollateral }, { rawValue: numTokens })
        .send({ from: sponsor });

      const tokenHolderTokens = toWei("50");
      await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

      // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
      const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
      await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

      // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
      await pricelessPositionManager.methods.expire().send({ from: other });

      assert.equal(
        (
          await optimisticOracle.methods
            .getState(
              pricelessPositionManager.options.address,
              transformedPriceFeedIdentifier,
              expirationTime,
              ancillaryData
            )
            .call()
        ).toString(),
        OptimisticOracleRequestStatesEnum.REQUESTED
      );

      // Check that the enquire price request with the DVM is for the transformed price identifier.
      const priceRequest = await optimisticOracle.methods
        .getRequest(
          pricelessPositionManager.options.address,
          transformedPriceFeedIdentifier,
          expirationTime,
          ancillaryData
        )
        .call();
      assert.equal(priceRequest.settled, false);
      assert.equal(priceRequest.currency, collateral.options.address);
      assert.equal(priceRequest.proposedPrice, "0");

      // settlement should occur as per normal on the transformed identifier.
      const redemptionPrice = 1.2;
      const redemptionPriceWei = toWei(redemptionPrice.toString());
      await proposeAndSettleOptimisticOraclePrice(
        transformedPriceFeedIdentifier,
        parseInt(expirationTime),
        redemptionPriceWei
      );

      // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
      // They have 50 tokens settled at a price of 1.2 should yield 60 units of underling.
      const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      const tokenHolderInitialSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();
      assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

      // Approve the tokens to be moved by the contract and execute the settlement.
      await tokenCurrency.methods
        .approve(pricelessPositionManager.options.address, tokenHolderInitialSynthetic)
        .send({ from: tokenHolder });
      let settleExpiredResult = await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
      assert.equal(
        await pricelessPositionManager.methods.contractState().call(),
        PositionStatesEnum.EXPIRED_PRICE_RECEIVED
      );
      const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      const tokenHolderFinalSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();

      // The token holder should gain the value of their synthetic tokens in underlying.
      // The value in underlying is the number of tokens they held in the beginning * settlement price as TRV
      // When redeeming 50 tokens at a price of 1.2 we expect to receive 60 collateral tokens (50 * 1.2)
      const expectedTokenHolderFinalCollateral = toWei("60");
      assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

      // The token holder should have no synthetic positions left after settlement.
      assert.equal(tokenHolderFinalSynthetic, 0);

      // Check the event returned the correct values
      await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "SettleExpiredPosition", (ev) => {
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
      const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      const sponsorInitialSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

      // Approve tokens to be moved by the contract and execute the settlement.
      await tokenCurrency.methods
        .approve(pricelessPositionManager.options.address, sponsorInitialSynthetic)
        .send({ from: sponsor });

      // The token Sponsor should gain the value of their synthetics in underlying
      // + their excess collateral from the over collateralization in their position
      // Excess collateral = 150 - 100 * 1.2 = 30
      const expectedSponsorCollateralUnderlying = toBN(toWei("30"));
      // Value of remaining synthetic tokens = 50 * 1.2 = 60
      const expectedSponsorCollateralSynthetic = toBN(toWei("60"));
      const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
        expectedSponsorCollateralSynthetic
      );

      // Redeem and settleExpired should give the same result as just settleExpired.
      const settleExpired = pricelessPositionManager.methods.settleExpired();

      // Get the amount as if we only settleExpired.
      const settleExpiredOnlyAmount = await settleExpired.call({ from: sponsor });

      // Partially redeem and partially settleExpired.
      const partialRedemptionAmount = await pricelessPositionManager.methods
        .redeem({ rawValue: toWei("1") })
        .call({ from: sponsor });
      await pricelessPositionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor });
      const partialSettleExpiredAmount = await settleExpired.call({ from: sponsor });
      settleExpiredResult = await settleExpired.send({ from: sponsor });

      // Compare the two paths' results.
      assert.equal(
        settleExpiredOnlyAmount.toString(),
        toBN(partialRedemptionAmount.toString()).add(toBN(partialSettleExpiredAmount.toString())).toString()
      );

      // Compare the amount to the expected return value.
      assert.equal(settleExpiredOnlyAmount.toString(), expectedTotalSponsorCollateralReturned.toString());

      // Check balances.
      const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();
      assert.equal(
        sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
        expectedTotalSponsorCollateralReturned
      );

      // Check events.
      await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "EndedSponsorPosition", (ev) => {
        return ev.sponsor == sponsor;
      });

      // The token Sponsor should have no synthetic positions left after settlement.
      assert.equal(sponsorFinalSynthetic, 0);

      // Last check is that after redemption the position in the positions mapping has been removed.
      const sponsorsPosition = await pricelessPositionManager.methods.positions(sponsor).call();
      assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
      assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
      assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
      assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
      assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
    });
    it("Correctly handles invalid financial product library", async function () {
      // Set the financial product library to a contract that is NOT a valid financial contract library, such as the
      // mock oracle.

      pricelessPositionManager = await PricelessPositionManager.new(
        expirationTimestamp, // _expirationTimestamp
        withdrawalLiveness, // _withdrawalLiveness
        collateral.options.address, // _collateralAddress
        tokenCurrency.options.address, // _tokenAddress
        finder.options.address, // _finderAddress
        priceFeedIdentifier, // _priceFeedIdentifier
        { rawValue: minSponsorTokens }, // _minSponsorTokens
        timer.options.address, // _timerAddress
        mockOracle.options.address // _financialProductLibraryAddress
      ).send({ from: contractDeployer });

      // Price identifier transformation function correctly transforms the price identifier.
      assert.equal(
        hexToUtf8(await pricelessPositionManager.methods.transformPriceIdentifier("0").call()),
        hexToUtf8(priceFeedIdentifier)
      );

      // Give contract owner permissions.
      await tokenCurrency.methods.addMinter(pricelessPositionManager.options.address).send({ from: accounts[0] });
      await tokenCurrency.methods.addBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });

      await collateral.methods
        .approve(pricelessPositionManager.options.address, toWei("100000"))
        .send({ from: sponsor });
      const numTokens = toWei("100");
      const amountCollateral = toWei("150");
      await pricelessPositionManager.methods
        .create({ rawValue: amountCollateral }, { rawValue: numTokens })
        .send({ from: sponsor });

      const tokenHolderTokens = toWei("50");
      await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

      // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
      const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
      await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

      // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
      await pricelessPositionManager.methods.expire().send({ from: other });

      assert.equal(
        (
          await optimisticOracle.methods
            .getState(pricelessPositionManager.options.address, priceFeedIdentifier, expirationTime, ancillaryData)
            .call()
        ).toString(),
        OptimisticOracleRequestStatesEnum.REQUESTED
      );

      const priceRequest = await optimisticOracle.methods
        .getRequest(pricelessPositionManager.options.address, priceFeedIdentifier, expirationTime, ancillaryData)
        .call();
      assert.equal(priceRequest.settled, false);
      assert.equal(priceRequest.currency, collateral.options.address);
      assert.equal(priceRequest.proposedPrice, "0");

      // settlement should occur as per normal on the transformed identifier.
      const redemptionPrice = 1.2;
      const redemptionPriceWei = toWei(redemptionPrice.toString());
      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, parseInt(expirationTime), redemptionPriceWei);

      // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
      // They have 50 tokens settled at a price of 1.2 should yield 60 units of underling.
      const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      const tokenHolderInitialSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();
      assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

      // Approve the tokens to be moved by the contract and execute the settlement.
      await tokenCurrency.methods
        .approve(pricelessPositionManager.options.address, tokenHolderInitialSynthetic)
        .send({ from: tokenHolder });
      let settleExpiredResult = await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
      assert.equal(
        await pricelessPositionManager.methods.contractState().call(),
        PositionStatesEnum.EXPIRED_PRICE_RECEIVED
      );
      const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      const tokenHolderFinalSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();

      // The token holder should gain the value of their synthetic tokens in underlying.
      // The value in underlying is the number of tokens they held in the beginning * settlement price as TRV
      // When redeeming 50 tokens at a price of 1.2 we expect to receive 60 collateral tokens (50 * 1.2)
      const expectedTokenHolderFinalCollateral = toWei("60");
      assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

      // The token holder should have no synthetic positions left after settlement.
      assert.equal(tokenHolderFinalSynthetic, 0);

      // Check the event returned the correct values
      await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "SettleExpiredPosition", (ev) => {
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
      const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      const sponsorInitialSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

      // Approve tokens to be moved by the contract and execute the settlement.
      await tokenCurrency.methods
        .approve(pricelessPositionManager.options.address, sponsorInitialSynthetic)
        .send({ from: sponsor });

      // The token Sponsor should gain the value of their synthetics in underlying
      // + their excess collateral from the over collateralization in their position
      // Excess collateral = 150 - 100 * 1.2 = 30
      const expectedSponsorCollateralUnderlying = toBN(toWei("30"));
      // Value of remaining synthetic tokens = 50 * 1.2 = 60
      const expectedSponsorCollateralSynthetic = toBN(toWei("60"));
      const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
        expectedSponsorCollateralSynthetic
      );

      // Redeem and settleExpired should give the same result as just settleExpired.
      const settleExpired = pricelessPositionManager.methods.settleExpired();

      // Get the amount as if we only settleExpired.
      const settleExpiredOnlyAmount = await settleExpired.call({ from: sponsor });

      // Partially redeem and partially settleExpired.
      const partialRedemptionAmount = await pricelessPositionManager.methods
        .redeem({ rawValue: toWei("1") })
        .call({ from: sponsor });
      await pricelessPositionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor });
      const partialSettleExpiredAmount = await settleExpired.call({ from: sponsor });
      settleExpiredResult = await settleExpired.send({ from: sponsor });

      // Compare the two paths' results.
      assert.equal(
        settleExpiredOnlyAmount.toString(),
        toBN(partialRedemptionAmount.toString()).add(toBN(partialSettleExpiredAmount.toString())).toString()
      );

      // Compare the amount to the expected return value.
      assert.equal(settleExpiredOnlyAmount.toString(), expectedTotalSponsorCollateralReturned.toString());

      // Check balances.
      const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();
      assert.equal(
        sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
        expectedTotalSponsorCollateralReturned
      );

      // Check events.
      await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "EndedSponsorPosition", (ev) => {
        return ev.sponsor == sponsor;
      });

      // The token Sponsor should have no synthetic positions left after settlement.
      assert.equal(sponsorFinalSynthetic, 0);

      // Last check is that after redemption the position in the positions mapping has been removed.
      const sponsorsPosition = await pricelessPositionManager.methods.positions(sponsor).call();
      assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
      assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
      assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
      assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
      assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
    });

    it("Correctly handles reverting identifier transformation", async function () {
      // Create a sample FinancialProductLibraryTest that simply replaces the price identifier with a transformed one.
      //  However, we will set the library to revert on calls to test the PricelessPositionManager correctly deals with a "broken" library.
      const transformedPriceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER_TRANSFORMED");
      const financialProductLibraryTest = await FinancialProductLibraryTest.new(
        { rawValue: toWei("2") }, // _priceTransformationScalar. Set to 2 to adjust the oracle price.
        { rawValue: toWei("1") }, // _collateralRequirementTransformationScalar. Set to 1 to not scale the contract CR.
        transformedPriceFeedIdentifier // _transformedPriceIdentifier. Set to a transformed value to test transformation logic.
      ).send({ from: accounts[0] });

      await financialProductLibraryTest.methods.setShouldRevert(true).send({ from: accounts[0] });

      // calling the library directly should revert.
      assert(
        await didContractThrow(
          financialProductLibraryTest.methods
            .transformPriceIdentifier(priceFeedIdentifier, "0")
            .send({ from: accounts[0] })
        )
      );

      // Transform price function in pricelessPositionManager should apply NO transformation as library is reverting.
      assert.equal(
        (await pricelessPositionManager.methods.transformPrice({ rawValue: "5" }, "0").call()).toString(),
        "5"
      );
    });

    it("Correctly handles EOA financial product library", async function () {
      // Set the financial product library to a contract that is NOT a valid financial contract library, such as the
      // mock oracle.

      pricelessPositionManager = await PricelessPositionManager.new(
        expirationTimestamp, // _expirationTimestamp
        withdrawalLiveness, // _withdrawalLiveness
        collateral.options.address, // _collateralAddress
        tokenCurrency.options.address, // _tokenAddress
        finder.options.address, // _finderAddress
        priceFeedIdentifier, // _priceFeedIdentifier
        { rawValue: minSponsorTokens }, // _minSponsorTokens
        timer.options.address, // _timerAddress
        other // _financialProductLibraryAddress
      ).send({ from: contractDeployer });

      // Transform price function in pricelessPositionManager should apply NO transformation as library is reverting.
      assert.equal(
        (await pricelessPositionManager.methods.transformPrice({ rawValue: "5" }, "0").call()).toString(),
        "5"
      );

      // Transform identifier function in pricelessPositionManager should apply NO transformation as library is reverting.
      assert.equal(
        hexToUtf8(await pricelessPositionManager.methods.transformPriceIdentifier("0").call()),
        hexToUtf8(priceFeedIdentifier)
      );
    });
  });

  it("Non sponsor can't deposit, redeem, withdraw, or transfer", async function () {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.methods
      .approve(pricelessPositionManager.options.address, initialPositionCollateral)
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: initialPositionCollateral.toString() }, { rawValue: initialPositionTokens.toString() })
      .send({ from: other });

    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("100000"))
      .send({ from: sponsor });
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });

    // Can't deposit without first creating a pricelessPositionManager.
    assert(
      await didContractThrow(pricelessPositionManager.methods.deposit({ rawValue: toWei("1") }).send({ from: sponsor }))
    );

    // Can't request a withdrawal or transfer without first creating a pricelessPositionManager.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.requestWithdrawal({ rawValue: toWei("0") }).send({ from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.methods.requestTransferPosition().send({ from: sponsor })));

    // Even if the "sponsor" acquires a token somehow, they can't redeem.
    await tokenCurrency.methods.transfer(sponsor, toWei("1")).send({ from: other });
    assert(
      await didContractThrow(pricelessPositionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor }))
    );
  });

  it("Can't redeem more than position size", async function () {
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("1000"))
      .send({ from: sponsor });
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: sponsor });

    const numTokens = toWei("1");
    const numCombinedTokens = toWei("2");
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: numTokens })
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: numTokens })
      .send({ from: sponsor });

    await tokenCurrency.methods.transfer(sponsor, numTokens).send({ from: other });
    assert(
      await didContractThrow(
        pricelessPositionManager.methods.redeem({ rawValue: numCombinedTokens }).send({ from: sponsor })
      )
    );
    await pricelessPositionManager.methods.redeem({ rawValue: numTokens }).send({ from: sponsor });
    assert(
      await didContractThrow(pricelessPositionManager.methods.redeem({ rawValue: numTokens }).send({ from: sponsor }))
    );
  });

  it("Non sponsor can use depositTo", async function () {
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: sponsor });

    const numTokens = toWei("1");
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Other makes a deposit to the sponsor's account.
    await pricelessPositionManager.methods.depositTo(sponsor, { rawValue: toWei("1") }).send({ from: other });

    assert.equal((await pricelessPositionManager.methods.getCollateral(sponsor).call()).toString(), toWei("2"));
    assert.equal((await pricelessPositionManager.methods.getCollateral(other).call()).toString(), "0");
  });

  it("Existing sponsor can use depositTo on other account", async function () {
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: sponsor });

    const numTokens = toWei("1");
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: numTokens })
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Other makes a deposit to the sponsor's account despite having their own position.
    await pricelessPositionManager.methods.depositTo(sponsor, { rawValue: toWei("1") }).send({ from: other });

    assert.equal((await pricelessPositionManager.methods.getCollateral(sponsor).call()).toString(), toWei("2"));
    assert.equal((await pricelessPositionManager.methods.getCollateral(other).call()).toString(), toWei("1"));
  });

  it("Sponsor use depositTo on own account", async function () {
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: sponsor });

    const numTokens = toWei("1");
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Sponsor makes a deposit to their own account.
    await pricelessPositionManager.methods.depositTo(sponsor, { rawValue: toWei("1") }).send({ from: sponsor });

    assert.equal((await pricelessPositionManager.methods.getCollateral(sponsor).call()).toString(), toWei("2"));
  });

  it("Sponsor can use repay to decrease their debt", async function () {
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: sponsor });
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("1000"))
      .send({ from: sponsor });

    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: toWei("100") })
      .send({ from: sponsor });

    const initialSponsorTokens = toBN(await tokenCurrency.methods.balanceOf(sponsor).call());
    const initialSponsorTokenDebt = toBN(
      (await pricelessPositionManager.methods.positions(sponsor).call()).tokensOutstanding.rawValue
    );
    const initialTotalTokensOutstanding = toBN(await pricelessPositionManager.methods.totalTokensOutstanding().call());

    // Check that repay fails if missing Burner role.
    await tokenCurrency.methods.removeBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });
    assert(
      await didContractThrow(pricelessPositionManager.methods.repay({ rawValue: toWei("40") }).send({ from: sponsor }))
    );
    await tokenCurrency.methods.addBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });
    const repayResult = await pricelessPositionManager.methods.repay({ rawValue: toWei("40") }).send({ from: sponsor });

    // Event is correctly emitted.
    await assertEventEmitted(repayResult, pricelessPositionManager, "Repay", (ev) => {
      return (
        ev.sponsor == sponsor &&
        ev.numTokensRepaid.toString() == toWei("40") &&
        ev.newTokenCount.toString() === toWei("60")
      );
    });

    const tokensPaid = initialSponsorTokens.sub(toBN(await tokenCurrency.methods.balanceOf(sponsor).call()));
    const tokenDebtDecreased = initialSponsorTokenDebt.sub(
      toBN((await pricelessPositionManager.methods.positions(sponsor).call()).tokensOutstanding.rawValue)
    );
    const totalTokensOutstandingDecreased = initialTotalTokensOutstanding.sub(
      toBN(await pricelessPositionManager.methods.totalTokensOutstanding().call())
    );

    // Tokens paid back to contract,the token debt decrease and decrease in outstanding should all equal 40 tokens.
    assert.equal(tokensPaid.toString(), toWei("40"));
    assert.equal(tokenDebtDecreased.toString(), toWei("40"));
    assert.equal(totalTokensOutstandingDecreased.toString(), toWei("40"));

    // Can not request to repay more than their token balance. Sponsor has remaining 60. max they can repay is 60
    assert.equal(
      (await pricelessPositionManager.methods.positions(sponsor).call()).tokensOutstanding.rawValue,
      toWei("60")
    );
    assert(
      await didContractThrow(pricelessPositionManager.methods.repay({ rawValue: toWei("65") }).send({ from: sponsor }))
    );

    // Can not repay to position less than minimum sponsor size. Minimum sponsor size is 5 wei. Repaying 60 - 3 wei
    // would leave the position at a size of 2 wei, which is less than acceptable minimum.
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .repay({ rawValue: toBN(toWei("60")).subn(3).toString() })
          .send({ from: sponsor })
      )
    );

    // Caller needs to set allowance in order to repay.
    await tokenCurrency.methods.approve(pricelessPositionManager.options.address, "0").send({ from: sponsor });
    assert(
      await didContractThrow(
        pricelessPositionManager.methods
          .repay({ rawValue: toBN(toWei("60")).sub(toBN(minSponsorTokens)).toString() })
          .send({ from: sponsor })
      )
    );
    await tokenCurrency.methods.approve(pricelessPositionManager.options.address, toWei("60")).send({ from: sponsor });

    // Can repay up to the minimum sponsor size
    await pricelessPositionManager.methods
      .repay({ rawValue: toBN(toWei("60")).sub(toBN(minSponsorTokens)).toString() })
      .send({ from: sponsor });

    assert.equal(
      (await pricelessPositionManager.methods.positions(sponsor).call()).tokensOutstanding.rawValue,
      minSponsorTokens
    );

    // As at the minimum sponsor size even removing 1 wei wll revert.
    assert(await didContractThrow(pricelessPositionManager.methods.repay({ rawValue: "1" }).send({ from: sponsor })));
  });

  it("Basic fees", async function () {
    // Set up position.
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: sponsor });

    // Set up another position that is less collateralized so sponsor can withdraw freely.
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: toWei("100000") })
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: toWei("1") })
      .send({ from: sponsor });

    // Set store fees to 1% per second.
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.01") }).send({ from: accounts[0] });

    // Move time in the contract forward by 1 second to capture a 1% fee.

    const startTime = parseInt(await pricelessPositionManager.methods.getCurrentTime().call());
    await pricelessPositionManager.methods.setCurrentTime(startTime + 1).send({ from: accounts[0] });

    // getCollateral for a given sponsor should correctly reflect the pending regular fee that has not yet been paid.
    // As no function calls have been made after incrementing time, the fees are still in a "pending" state.
    // Sponsor has a position with 1e18 collateral in it. After a 1% fee is applied they should have 0.99e18.
    assert.equal((await pricelessPositionManager.methods.getCollateral(sponsor).call()).toString(), toWei("0.99"));

    // Equally, the totalPositionCollateral should be decremented accordingly. The total collateral is 2e18. After
    // the pending regular fee is applied this should be set to 1.98.
    assert.equal((await pricelessPositionManager.methods.totalPositionCollateral().call()).toString(), toWei("1.98"));

    // Determine the expected store balance by adding 1% of the sponsor balance to the starting store balance.
    // Multiply by 2 because there are two active positions
    const expectedStoreBalance = toBN(await collateral.methods.balanceOf(store.options.address).call()).add(
      toBN(toWei("0.02"))
    );

    // Pay the fees, check the return value, and then check the collateral and the store balance.
    const payRegularFees = pricelessPositionManager.methods.payRegularFees();
    const feesPaid = await payRegularFees.call();
    assert.equal(feesPaid.toString(), toWei("0.02"));
    const payFeesResult = await payRegularFees.send({ from: accounts[0] });
    await assertEventEmitted(payFeesResult, pricelessPositionManager, "RegularFeesPaid", (ev) => {
      return ev.regularFee.toString() === toWei("0.02") && ev.lateFee.toString() === "0";
    });
    let collateralAmount = await pricelessPositionManager.methods.getCollateral(sponsor).call();
    assert.equal(collateralAmount.rawValue.toString(), toWei("0.99"));
    assert.equal(
      (await collateral.methods.balanceOf(store.options.address).call()).toString(),
      expectedStoreBalance.toString()
    );

    // Calling `payRegularFees()` more than once in the same block does not emit a RegularFeesPaid event.
    const feesPaidRepeat = await payRegularFees.call();
    assert.equal(feesPaidRepeat.toString(), "0");
    const payFeesRepeatResult = await payRegularFees.send({ from: accounts[0] });
    await assertEventNotEmitted(payFeesRepeatResult, pricelessPositionManager, "RegularFeesPaid");

    // Ensure that fees are not applied to new collateral.
    // TODO: value chosen specifically to avoid rounding errors -- see #873.
    await pricelessPositionManager.methods.deposit({ rawValue: toWei("99") }).send({ from: sponsor });
    collateralAmount = await pricelessPositionManager.methods.getCollateral(sponsor).call();
    assert.equal(collateralAmount.rawValue.toString(), toWei("99.99"));

    // Ensure that the conversion works correctly for withdrawals.
    const expectedSponsorBalance = toBN(await collateral.methods.balanceOf(sponsor).call()).add(toBN(toWei("1")));
    await pricelessPositionManager.methods.withdraw({ rawValue: toWei("1") }).send({ from: sponsor });
    assert.equal((await collateral.methods.balanceOf(sponsor).call()).toString(), expectedSponsorBalance.toString());
    assert.equal((await pricelessPositionManager.methods.getCollateral(sponsor).call()).toString(), toWei("98.99"));

    // Test that regular fees accrue after an emergency shutdown is triggered.
    await financialContractsAdmin.methods
      .callEmergencyShutdown(pricelessPositionManager.options.address)
      .send({ from: accounts[0] });

    // Ensure that the maximum fee % of pfc charged is 100%. Advance > 100 seconds from the last payment time to attempt to
    // pay > 100% fees on the PfC. This should pay a maximum of 100% of the PfC without reverting.
    const pfc = await pricelessPositionManager.methods.pfc().call();
    const feesOwed = (
      await store.methods.computeRegularFee(startTime + 1, startTime + 102, { rawValue: pfc.toString() }).call()
    ).regularFee;
    assert.isTrue(Number(pfc.toString()) < Number(feesOwed.toString()));
    const farIntoTheFutureSeconds = 502;
    await pricelessPositionManager.methods
      .setCurrentTime(startTime + farIntoTheFutureSeconds)
      .send({ from: accounts[0] });
    const payTooManyFeesResult = await pricelessPositionManager.methods.payRegularFees().send({ from: accounts[0] });
    await assertEventEmitted(payTooManyFeesResult, pricelessPositionManager, "RegularFeesPaid", (ev) => {
      // There should be 98.99 + 0.99 = 99.98 collateral remaining in the contract.
      return ev.regularFee.toString() === toWei("99.98") && ev.lateFee.toString() === "0";
    });
    assert.equal((await pricelessPositionManager.methods.getCollateral(sponsor).call()).toString(), "0");

    // TODO: Add unit tests for when the latePenalty > 0 but (latePenalty + regularFee > pfc). The component fees need to be reduced properly.

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });

    // Check that no event is fired if the fees owed are 0.
    await pricelessPositionManager.methods
      .setCurrentTime(startTime + farIntoTheFutureSeconds + 1)
      .send({ from: accounts[0] });
    const payZeroFeesResult = await payRegularFees.send({ from: accounts[0] });
    await assertEventNotEmitted(payZeroFeesResult, pricelessPositionManager, "RegularFeesPaid");
  });

  it("Gulps non-PfC collateral into PfC", async function () {
    // Set up position.
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: other });
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("1000")).send({ from: sponsor });

    // Set up another position that is less collateralized so sponsor can withdraw freely.
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("3") }, { rawValue: toWei("100000") })
      .send({ from: other });
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("1") }, { rawValue: toWei("1") })
      .send({ from: sponsor });

    // Verify the current PfC:
    assert.equal((await pricelessPositionManager.methods.pfc().call()).toString(), toWei("4"));

    // Send collateral to the contract so that its collateral balance is greater than its PfC.
    await collateral.methods
      .mint(pricelessPositionManager.options.address, toWei("0.5"))
      .send({ from: collateralOwner });

    // Gulp and check that (1) the contract's PfC adjusted and (2) each sponsor's locked collateral increased.
    // Ratio of total-collateral / PfC = (4.5/4) = 1.125
    // New fee multiplier = 1 * 1.125 = 1.125
    // Sponsor's collateral should now be multiplied by 1.125
    await pricelessPositionManager.methods.gulp().send({ from: accounts[0] });
    assert.equal((await pricelessPositionManager.methods.pfc().call()).toString(), toWei("4.5"));
    // Gulping twice does nothing.
    await pricelessPositionManager.methods.gulp().send({ from: accounts[0] });
    assert.equal((await pricelessPositionManager.methods.getCollateral(other).call()).toString(), toWei("3.375"));
    assert.equal((await pricelessPositionManager.methods.getCollateral(sponsor).call()).toString(), toWei("1.125"));
    assert.equal(
      (await collateral.methods.balanceOf(pricelessPositionManager.options.address).call()).toString(),
      toWei("4.5")
    );
  });

  it("Final fees", async function () {
    // Create a new position
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    const numTokens = toWei("50");
    const amountCollateral = toWei("100");
    await pricelessPositionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = toWei("25");
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

    // Set store final fees to 1 collateral token.
    const finalFeePaid = toWei("1");
    await store.methods.setFinalFee(collateral.options.address, { rawValue: finalFeePaid }).send({ from: accounts[0] });

    // Advance time until after expiration. Token holders and sponsors should now be able to to settle.
    const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
    await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime) + 1).send({ from: accounts[0] });

    // Determine the expected store balance by adding 1% of the sponsor balance to the starting store balance.
    const expectedOptimisticOracleBalance = toBN(
      await collateral.methods.balanceOf(optimisticOracle.options.address).call()
    ).add(toBN(finalFeePaid));

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    const expirationResult = await pricelessPositionManager.methods.expire().send({ from: other });

    // Final fees should not be paid. Instead, a reward should have been sent to the optimistic oracle.
    await assertEventNotEmitted(expirationResult, pricelessPositionManager, "FinalFeesPaid");
    let collateralAmount = await pricelessPositionManager.methods.getCollateral(sponsor).call();
    assert.equal(collateralAmount.rawValue.toString(), toWei("99"));
    assert.equal(
      (await collateral.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
      expectedOptimisticOracleBalance.toString()
    );

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
    const redemptionPrice = 1.2;
    const redemptionPriceWei = toWei(redemptionPrice.toString());
    await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, parseInt(expirationTime), redemptionPriceWei);

    // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
    // They have 25 tokens settled at a price of 1.2 should yield 30 units of underling (or 60 USD as underlying is WETH).
    const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderInitialSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();

    // Approve the tokens to be moved by the contract and execute the settlement for the token holder.
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    let settleExpiredResult = await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
    const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderFinalSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();

    // The token holder should gain the value of their synthetic tokens in underlying.
    // The value in underlying is the number of tokens they held in the beginning * settlement price as TRV
    // When redeeming 25 tokens at a price of 1.2 we expect to receive 30 collateral tokens (25 * 1.2)
    const expectedTokenHolderFinalCollateral = toWei("30");
    assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // Check the event returned the correct values
    await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "SettleExpiredPosition", (ev) => {
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
    const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorInitialSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, sponsorInitialSynthetic)
      .send({ from: sponsor });
    await pricelessPositionManager.methods.settleExpired().send({ from: sponsor });
    const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

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
      expectedTotalSponsorCollateralReturned.toString()
    );

    // The token Sponsor should have no synthetic positions left after settlement.
    assert.equal(sponsorFinalSynthetic, 0);

    // The contract should have no more collateral tokens
    assert.equal((await collateral.methods.balanceOf(pricelessPositionManager.options.address).call()).toString(), 0);

    // Last check is that after redemption the position in the positions mapping has been removed.
    const sponsorsPosition = await pricelessPositionManager.methods.positions(sponsor).call();
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.methods.setFinalFee(collateral.options.address, { rawValue: "0" }).send({ from: accounts[0] });
  });

  describe("Precision loss is handled as expected", () => {
    beforeEach(async () => {
      // Create a new position with:
      // - 30 collateral
      // - 20 synthetic tokens (10 held by token holder, 10 by sponsor)
      await collateral.methods.approve(pricelessPositionManager.options.address, "100000").send({ from: sponsor });
      const numTokens = "20";
      const amountCollateral = "30";
      await pricelessPositionManager.methods
        .create({ rawValue: amountCollateral }, { rawValue: numTokens })
        .send({ from: sponsor });
      await tokenCurrency.methods.approve(pricelessPositionManager.options.address, numTokens).send({ from: sponsor });

      // Setting the regular fee to 4 % per second will result in a miscalculated cumulativeFeeMultiplier after 1 second
      // because of the intermediate calculation in `payRegularFees()` for calculating the `feeAdjustment`: ( fees paid ) / (total collateral)
      // = 0.033... repeating, which cannot be represented precisely by a fixed point.
      // --> 0.04 * 30 wei = 1.2 wei, which gets truncated to 1 wei, so 1 wei of fees are paid
      const regularFee = toWei("0.04");
      await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: regularFee }).send({ from: accounts[0] });

      // Advance the contract one second and make the contract pay its regular fees
      let startTime = parseInt(await pricelessPositionManager.methods.getCurrentTime().call());
      await pricelessPositionManager.methods.setCurrentTime(startTime + 1).send({ from: accounts[0] });
      await pricelessPositionManager.methods.payRegularFees().send({ from: accounts[0] });

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
      let collateralAmount = await pricelessPositionManager.methods.getCollateral(sponsor).call();
      assert.isTrue(toBN(collateralAmount.rawValue).lt(toBN("29")));
      assert.equal(
        (await pricelessPositionManager.methods.cumulativeFeeMultiplier().call()).toString(),
        toWei("0.966666666666666666").toString()
      );

      // The actual amount of fees paid to the store is as expected = 1 wei.
      // At this point, the store should have +1 wei, the contract should have 29 wei but the position will show 28 wei
      // because `(30 * 0.966666666666666666 = 28.999...98)`. `30` is the rawCollateral and if the fee multiplier were correct, {       // then `totalPositionCollateral` would be `(30 * 0.966666666666666666...) = 29`.
      assert.equal(
        (await collateral.methods.balanceOf(pricelessPositionManager.options.address).call()).toString(),
        "29"
      );
      assert.equal((await pricelessPositionManager.methods.totalPositionCollateral().call()).toString(), "28");
      assert.equal((await pricelessPositionManager.methods.rawTotalPositionCollateral().call()).toString(), "30");
    });
    it("settleExpired() returns the same amount of collateral that totalPositionCollateral is decreased by", async () => {
      // Expire the contract
      const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
      await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });
      await pricelessPositionManager.methods.expire().send({ from: other });

      // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
      // feed. With 20 units of outstanding tokens this results in a token redemption value of: TRV = 20 * 1.2 = 24 USD.
      const redemptionPrice = 1.2;
      const redemptionPriceWei = toWei(redemptionPrice.toString());
      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, parseInt(expirationTime), redemptionPriceWei);

      // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
      const tokenHolderTokens = "10";
      await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });
      await tokenCurrency.methods
        .approve(pricelessPositionManager.options.address, tokenHolderTokens)
        .send({ from: tokenHolder });

      // The token holder is entitled to the value of their tokens, notated in the underlying.
      // They have 10 tokens settled at a price of 1.2 should yield 12 units of collateral.
      // So, `rawCollateral` is decreased by (`12 / 0.966666666666666666 ~= 12.4`) which gets truncated to 12.
      // Before `settleExpired` is called, `totalPositionCollateral = rawCollateral * cumulativeFeeMultiplier = 30 * 0.966666666666666666 = 28`.
      // After `settleExpired`, `rawCollateral -= 12`, so the new `totalPositionCollateral = `(30-12) * 0.966666666666666666 = 17.4` which is truncated to 17.
      // So, due to precision loss, `totalPositionCollateral` is only decreased by 11, but it should be 12 without errors.
      // From the user's POV, they will see their balance decrease by 11, so we should send them 11 collateral not 12.
      const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
      const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
      const tokenHolderFinalSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();

      // The token holder should gain the value of their synthetic tokens in underlying.
      const expectedTokenHolderFinalCollateral = "11";
      assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);
      assert.equal(
        (await collateral.methods.balanceOf(pricelessPositionManager.options.address).call()).toString(),
        "18"
      );
      assert.equal((await pricelessPositionManager.methods.totalPositionCollateral().call()).toString(), "17");
      assert.equal((await pricelessPositionManager.methods.rawTotalPositionCollateral().call()).toString(), "18");

      // The token holder should have no synthetic positions left after settlement.
      assert.equal(tokenHolderFinalSynthetic, 0);

      // The sponsor is entitled to the underlying value of their remaining synthetic tokens + the excess collateral
      // in their position at time of settlement - final fees. But we'll see that the "excess" collateral displays error
      // due to precision loss.
      const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      await pricelessPositionManager.methods.settleExpired().send({ from: sponsor });
      const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

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
      assert.equal((await pricelessPositionManager.methods.totalPositionCollateral().call()).toString(), "1");
      assert.equal((await pricelessPositionManager.methods.rawTotalPositionCollateral().call()).toString(), "2");
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
      assert.equal(
        (await collateral.methods.balanceOf(pricelessPositionManager.options.address).call()).toString(),
        "2"
      );
      assert.equal((await pricelessPositionManager.methods.totalPositionCollateral().call()).toString(), "1");

      // Last check is that after redemption the position in the positions mapping is still removed despite leaving collateral dust.
      const sponsorsPosition = await pricelessPositionManager.methods.positions(sponsor).call();
      assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
      assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
      assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
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
      const initialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      await pricelessPositionManager.methods.requestWithdrawal({ rawValue: "12" }).send({ from: sponsor });
      let startTime = parseInt(await pricelessPositionManager.methods.getCurrentTime().call());
      await pricelessPositionManager.methods.setCurrentTime(startTime + withdrawalLiveness).send({ from: accounts[0] });
      await pricelessPositionManager.methods.withdrawPassedRequest().send({ from: sponsor });
      const finalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());

      // The sponsor should gain their requested amount minus precision loss.
      const expectedFinalCollateral = "11";
      assert.equal(finalCollateral.sub(initialCollateral), expectedFinalCollateral);
      assert.equal(
        (await collateral.methods.balanceOf(pricelessPositionManager.options.address).call()).toString(),
        "18"
      );
      assert.equal((await pricelessPositionManager.methods.totalPositionCollateral().call()).toString(), "17");
      assert.equal((await pricelessPositionManager.methods.rawTotalPositionCollateral().call()).toString(), "18");
    });
    it("redeem() returns the same amount of collateral that totalPositionCollateral is decreased by", async () => {
      // The sponsor requests to redeem 9 tokens. (9/20 = 0.45) tokens should result in a proportional redemption of the totalPositionCollateral, {       // which as you recall is 28 post-fees. So, we expect to redeem (0.45 * 28 = 12.6) collateral which gets truncated to 12.
      // So, `rawCollateral` is decreased by (`12 / 0.966666666666666666 ~= 12.4`) which gets truncated to 12.
      // Before `withdraw` is called, `totalPositionCollateral = rawCollateral * cumulativeFeeMultiplier = 30 * 0.966666666666666666 = 28`.
      // After `settleExpired`, `rawCollateral -= 12`, so the new `totalPositionCollateral = `(30-12) * 0.966666666666666666 = 17.4` which is truncated to 17.
      // So, due to precision loss, `totalPositionCollateral` is only decreased by 11, but it should be 12 without errors.
      // From the user's POV, they will see their balance decrease by 11, so we should send them 11 collateral not 12.
      const initialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
      await pricelessPositionManager.methods.redeem({ rawValue: "9" }).send({ from: sponsor });
      const finalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());

      // The sponsor should gain their requested amount minus precision loss.
      assert.equal(finalCollateral.sub(initialCollateral), "11");
      assert.equal(
        (await collateral.methods.balanceOf(pricelessPositionManager.options.address).call()).toString(),
        "18"
      );
      assert.equal((await pricelessPositionManager.methods.totalPositionCollateral().call()).toString(), "17");
      assert.equal((await pricelessPositionManager.methods.rawTotalPositionCollateral().call()).toString(), "18");

      // Expected number of synthetic tokens are burned.
      assert.equal((await tokenCurrency.methods.balanceOf(sponsor).call()).toString(), "11");
    });
  });

  it("Not enough collateral to pay final fees, reverts expire", async function () {
    // Create a new position
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("2")).send({ from: sponsor });
    const numTokens = toWei("2");
    const amountCollateral = toWei("2");
    await pricelessPositionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Set store final fees >= collateral in positions.
    const finalFeePaid = toWei("3");
    await store.methods.setFinalFee(collateral.options.address, { rawValue: finalFeePaid }).send({ from: accounts[0] });

    // Advance time until after expiration.
    const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
    await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    assert(await didContractThrow(pricelessPositionManager.methods.expire().send({ from: other })));

    // Position has frozen collateral
    let frozenCollateralAmount = await pricelessPositionManager.methods.getCollateral(sponsor).call();
    assert.equal(frozenCollateralAmount.rawValue.toString(), amountCollateral);

    // Set the store fees back to 0 to prevent it from affecting other tests.
    await store.methods.setFinalFee(collateral.options.address, { rawValue: "0" }).send({ from: accounts[0] });
  });

  it("Oracle swap post expiry", async function () {
    // Approvals
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("100000"))
      .send({ from: tokenHolder });
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("100000"))
      .send({ from: other });

    // Create one position with 200 synthetic tokens to mint with 300 tokens of collateral. For this test say the
    // collateral is WETH with a value of 1USD and the synthetic is some fictional stock or commodity.
    const numTokens = toWei("200");
    const amountCollateral = toWei("300");
    await pricelessPositionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Transfer 100 the tokens from the sponsor to two separate holders. IRL this happens through the sponsor selling
    // tokens.
    const tokenHolderTokens = toWei("100");
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });
    await tokenCurrency.methods.transfer(other, tokenHolderTokens).send({ from: sponsor });

    // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
    const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
    await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    await pricelessPositionManager.methods.expire().send({ from: other });

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 200 units of outstanding tokens this results in a token redemption value of: TRV = 200 * 1.2 = 240 USD.
    await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, parseInt(expirationTime), toWei("1.2"));

    // Token holder should receive 120 collateral tokens for their 100 synthetic tokens.
    let initialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
    let collateralPaid = toBN(await collateral.methods.balanceOf(tokenHolder).call()).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("120"));

    // Create new optimistic oracle, replace it in the finder, and push a different price to it.
    const newOptimisticOracle = await OptimisticOracle.new(
      optimisticOracleLiveness,
      finder.options.address,
      timer.options.address
    ).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), newOptimisticOracle.options.address)
      .send({ from: contractDeployer });

    // Settle expired should still work even if the new oracle has no price.
    initialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    await pricelessPositionManager.methods.settleExpired().send({ from: sponsor });
    collateralPaid = toBN(await collateral.methods.balanceOf(sponsor).call()).sub(initialCollateral);

    // Sponsor should have received 300 - 240 = 60 collateral tokens.
    assert.equal(collateralPaid, toWei("60"));

    // Push a different price to the new oracle to ensure the contract still uses the old price.
    await newOptimisticOracle.methods
      .requestPrice(priceFeedIdentifier, expirationTime, ancillaryData, collateral.options.address, 0)
      .send({ from: proposer });
    await collateral.methods.approve(newOptimisticOracle.options.address, toWei("1000000")).send({ from: proposer });
    const proposalTime = await newOptimisticOracle.methods.getCurrentTime().call();
    await newOptimisticOracle.methods
      .proposePrice(
        proposer, // requestor address
        priceFeedIdentifier,
        expirationTime,
        ancillaryData,
        toWei("0.6") // a difference price to previously in the test.
      )
      .send({ from: proposer });
    await newOptimisticOracle.methods
      .setCurrentTime(proposalTime + optimisticOracleLiveness)
      .send({ from: accounts[0] });
    await newOptimisticOracle.methods
      .settle(proposer, priceFeedIdentifier, expirationTime, ancillaryData)
      .send({ from: proposer });

    // Second token holder should receive the same payout as the first despite the oracle price being changed.
    initialCollateral = toBN(await collateral.methods.balanceOf(other).call());
    await pricelessPositionManager.methods.settleExpired().send({ from: other });
    collateralPaid = toBN(await collateral.methods.balanceOf(other).call()).sub(initialCollateral);
    assert.equal(collateralPaid, toWei("120"));
  });

  it("Undercapitalized contract", async function () {
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: other });
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("100000"))
      .send({ from: sponsor });
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("100000"))
      .send({ from: other });
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("100000"))
      .send({ from: tokenHolder });

    // Create one undercapitalized sponsor and one overcollateralized sponsor.
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("50") }, { rawValue: toWei("100") })
      .send({ from: sponsor });
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("150") }, { rawValue: toWei("100") })
      .send({ from: other });

    // Transfer 150 tokens to the token holder and leave the overcollateralized sponsor with 25.
    await tokenCurrency.methods.transfer(tokenHolder, toWei("75")).send({ from: other });
    await tokenCurrency.methods.transfer(tokenHolder, toWei("75")).send({ from: sponsor });

    // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
    const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
    await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });
    await pricelessPositionManager.methods.expire().send({ from: other });

    // Settle the price to 1, meaning the overcollateralized sponsor has 50 units of excess collateral.
    await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, parseInt(expirationTime), toWei("1"));

    // Token holder is the first to settle -- they should receive the entire value of their tokens (100) because they
    // were first.
    let startingBalance = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
    assert.equal(
      (await collateral.methods.balanceOf(tokenHolder).call()).toString(),
      startingBalance.add(toBN(toWei("150")))
    );

    // The overcollateralized sponsor should see a haircut because they settled later.
    // The overcollateralized sponsor is owed 75 because of the 50 in excess collateral and the 25 in tokens.
    // But there's only 50 left in the contract, so we should see only 50 paid out.
    startingBalance = toBN(await collateral.methods.balanceOf(other).call());
    await pricelessPositionManager.methods.settleExpired().send({ from: other });
    assert.equal((await collateral.methods.balanceOf(other).call()).toString(), startingBalance.add(toBN(toWei("50"))));

    // The undercapitalized sponsor should get nothing even though they have tokens because the contract has no more collateral.
    startingBalance = toBN(await collateral.methods.balanceOf(sponsor).call());
    await pricelessPositionManager.methods.settleExpired().send({ from: sponsor });
    assert.equal((await collateral.methods.balanceOf(sponsor).call()).toString(), startingBalance.add(toBN("0")));
  });

  it("Emergency shutdown: lifecycle", async function () {
    // Create one position with 100 synthetic tokens to mint with 150 tokens of collateral. For this test say the
    // collateral is WETH with a value of 1USD and the synthetic is some fictional stock or commodity.
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    const tokenHolderTokens = toWei("50");
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

    // Some time passes and the UMA token holders decide that Emergency shutdown needs to occur.
    const shutdownTimestamp = expirationTimestamp - 1000;
    await pricelessPositionManager.methods.setCurrentTime(shutdownTimestamp).send({ from: accounts[0] });

    // Should revert if emergency shutdown initialized by non-FinancialContractsAdmin (governor).
    assert(await didContractThrow(pricelessPositionManager.methods.emergencyShutdown().send({ from: other })));

    // FinancialContractAdmin can initiate emergency shutdown.
    await financialContractsAdmin.methods
      .callEmergencyShutdown(pricelessPositionManager.options.address)
      .send({ from: accounts[0] });
    assert.equal(
      await pricelessPositionManager.methods.contractState().call(),
      PositionStatesEnum.EXPIRED_PRICE_REQUESTED
    );

    // Because the emergency shutdown is called by the `financialContractsAdmin`, listening for events can not
    // happen in the standard way as done in other tests. However, we can directly query the `pricelessPositionManager`
    // to see it's past events to ensure that the right parameters were emmited.
    const eventResult = await pricelessPositionManager.getPastEvents("EmergencyShutdown");
    assert.equal(eventResult[0].returnValues.caller, financialContractsAdmin.options.address);
    assert.equal(eventResult[0].returnValues.originalExpirationTimestamp.toString(), expirationTimestamp.toString());
    assert.equal(eventResult[0].returnValues.shutdownTimestamp.toString(), shutdownTimestamp.toString());

    // Check contract state change correctly to requested oracle price and the contract expiration has updated.
    assert.equal(
      await pricelessPositionManager.methods.contractState().call(),
      PositionStatesEnum.EXPIRED_PRICE_REQUESTED
    );
    assert.equal(
      (await pricelessPositionManager.methods.expirationTimestamp().call()).toString(),
      shutdownTimestamp.toString()
    );

    // Emergency shutdown should not be able to be called a second time.
    assert(
      await didContractThrow(
        financialContractsAdmin.methods
          .callEmergencyShutdown(pricelessPositionManager.options.address)
          .send({ from: accounts[0] })
      )
    );

    // Expire should not be able to be called as the contract has been emergency shutdown.
    assert(await didContractThrow(pricelessPositionManager.methods.expire().send({ from: other })));

    // Before the DVM has resolved a price withdrawals should be disabled (as with settlement at maturity).
    assert(await didContractThrow(pricelessPositionManager.methods.settleExpired().send({ from: sponsor })));

    // UMA token holders now vote to resolve of the price request to enable the emergency shutdown to continue.
    // Say they resolve to a price of 1.1 USD per synthetic token.
    await proposeAndSettleOptimisticOraclePrice(
      priceFeedIdentifier,
      parseInt(await pricelessPositionManager.methods.expirationTimestamp().call()),
      toWei("1.1")
    );

    // Token holders (`sponsor` and `tokenHolder`) should now be able to withdraw post emergency shutdown.
    // From the token holder's perspective, they are entitled to the value of their tokens, notated in the underlying.
    // They have 50 tokens settled at a price of 1.1 should yield 55 units of underling (or 55 USD as underlying is WETH).
    const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderInitialSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    // Check that settlement fails if missing Burner role.
    await tokenCurrency.methods.removeBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });
    assert(await didContractThrow(pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder })));
    await tokenCurrency.methods.addBurner(pricelessPositionManager.options.address).send({ from: accounts[0] });
    await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
    assert.equal(
      await pricelessPositionManager.methods.contractState().call(),
      PositionStatesEnum.EXPIRED_PRICE_RECEIVED
    );
    const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderFinalSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();
    const expectedTokenHolderFinalCollateral = toWei("55");
    assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // If the tokenHolder tries to withdraw again they should get no additional tokens; all have been withdrawn (same as normal expiratory).
    const tokenHolderInitialCollateral_secondWithdrawal = await collateral.methods.balanceOf(tokenHolder).call();
    const tokenHolderInitialSynthetic_secondWithdrawal = await tokenCurrency.methods.balanceOf(tokenHolder).call();
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
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

    // For the sponsor, they are entitled to the underlying value of their remaining synthetic tokens + the excess collateral
    // in their position at time of settlement. The sponsor had 150 units of collateral in their position and the final TRV
    // of their synthetics they sold is 110. Their redeemed amount for this excess collateral is the difference between the two.
    // The sponsor also has 50 synthetic tokens that they did not sell.
    // This makes their expected redemption = 150 - 110 + 50 * 1.1 = 95
    const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorInitialSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, sponsorInitialSynthetic)
      .send({ from: sponsor });
    await pricelessPositionManager.methods.settleExpired().send({ from: sponsor });
    const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

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

  it("Emergency shutdown: reject emergency shutdown post expiratory", async function () {
    // Create one position with 100 synthetic tokens to mint with 150 tokens of collateral.
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("150") }, { rawValue: toWei("100") })
      .send({ from: sponsor });

    // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
    const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
    await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

    // Emergency shutdown should revert as post expiration.
    assert(
      await didContractThrow(
        financialContractsAdmin.methods
          .callEmergencyShutdown(pricelessPositionManager.options.address)
          .send({ from: accounts[0] })
      )
    );
  });

  it("Cannot create position smaller than min sponsor size", async function () {
    // Attempt to create position smaller than 5 wei tokens (the min sponsor position size)
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });

    assert(
      await didContractThrow(
        pricelessPositionManager.methods.create({ rawValue: "40" }, { rawValue: "4" }).send({ from: sponsor })
      )
    );
  });

  it("Cannot reduce position size below min sponsor size", async function () {
    // Attempt to redeem a position smaller s.t. the resulting position is less than 5 wei tokens (the min sponsor
    // position size)
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });

    await pricelessPositionManager.methods.create({ rawValue: "40" }, { rawValue: "20" }).send({ from: sponsor });

    assert(await didContractThrow(pricelessPositionManager.methods.redeem({ rawValue: "16" }).send({ from: sponsor })));
  });

  it("Gulp edge cases", async function () {
    // Gulp does not revert if PfC and collateral balance are both 0
    await pricelessPositionManager.methods.gulp().send({ from: accounts[0] });

    // Send 1 wei of excess collateral to the contract.
    await collateral.methods.transfer(pricelessPositionManager.options.address, "1").send({ from: sponsor });

    // Gulp reverts if PfC is 0 but collateral balance is > 0.
    assert(await didContractThrow(pricelessPositionManager.methods.gulp().send({ from: accounts[0] })));

    // Create a position to gulp.
    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, toWei("100000"))
      .send({ from: sponsor });
    await pricelessPositionManager.methods
      .create({ rawValue: toWei("10") }, { rawValue: "20" })
      .send({ from: sponsor });

    // Gulp does not do anything if the intermediate calculation (collateral balance / PfC) has precision loss.
    // For example:
    // - collateral balance = 10e18 + 1
    // - PfC = 10e18
    // - Gulp ratio = (10e18 + 1) / 10e18 =  1.0000000000000000001, which is 1e18 + 1e-19, which gets truncated to 1e18
    // - Therefore, the multiplier remains at 1e18.
    await pricelessPositionManager.methods.gulp().send({ from: accounts[0] });
    assert.equal(
      (await pricelessPositionManager.methods.cumulativeFeeMultiplier().call()).toString(),
      web3.utils.toWei("1")
    );

    // Gulp will shift the multiplier if enough excess collateral builds up in the contract to negate precision loss.
    await collateral.methods.transfer(pricelessPositionManager.options.address, "9").send({ from: sponsor });
    await pricelessPositionManager.methods.gulp().send({ from: accounts[0] });
    assert.equal(
      (await pricelessPositionManager.methods.cumulativeFeeMultiplier().call()).toString(),
      web3.utils.toWei("1.000000000000000001")
    );
  });

  it("Non-standard ERC20 delimitation", async function () {
    // To test non-standard ERC20 token delimitation a new ERC20 token is created which has 6 decimal points of precision.
    // A new priceless position manager is then created and and set to use this token as collateral. To generate values
    // which represent the appropriate scaling for USDC, .muln(1e6) is used over toWei as the latter scaled by 1e18.

    // Create a test net token with non-standard delimitation like USDC (6 decimals) and mint tokens.
    const USDCToken = await TestnetERC20.new("USDC", "USDC", 6).send({ from: accounts[0] });
    await collateralWhitelist.methods.addToWhitelist(USDCToken.options.address).send({ from: accounts[0] });
    await USDCToken.methods.allocateTo(sponsor, toWei("100")).send({ from: accounts[0] });

    const nonStandardToken = await SyntheticToken.new(syntheticName, syntheticSymbol, 6).send({ from: accounts[0] });
    ancillaryData = nonStandardToken.options.address;

    let customPricelessPositionManager = await PricelessPositionManager.new(
      expirationTimestamp, // _expirationTimestamp
      withdrawalLiveness, // _withdrawalLiveness
      USDCToken.options.address, // _collateralAddress
      nonStandardToken.options.address, // _tokenAddress
      finder.options.address, // _finderAddress
      priceFeedIdentifier, // _priceFeedIdentifier
      { rawValue: minSponsorTokens }, // _minSponsorTokens
      timer.options.address, // _timerAddress
      ZERO_ADDRESS // _financialProductLibraryAddress
    ).send({ from: contractDeployer });
    tokenCurrency = await SyntheticToken.at(await customPricelessPositionManager.methods.tokenCurrency().call());
    await tokenCurrency.methods.addMinter(customPricelessPositionManager.options.address).send({ from: accounts[0] });
    await tokenCurrency.methods.addBurner(customPricelessPositionManager.options.address).send({ from: accounts[0] });

    // Token currency and collateral have same # of decimals.
    assert.equal(await tokenCurrency.methods.decimals().call(), 6);

    // Create the initial custom positionManager position. 100 synthetics backed by 150 collat
    const createTokens = toBN("100").muln(1e6).toString();
    // The collateral is delimited by the same number of decimals. 150 * 1e6
    const createCollateral = toBN("150").muln(1e6).toString();
    let expectedSponsorTokens = toBN(createTokens);
    let expectedContractCollateral = toBN(createCollateral);

    await USDCToken.methods
      .approve(customPricelessPositionManager.options.address, createCollateral)
      .send({ from: sponsor });
    await customPricelessPositionManager.methods
      .create({ rawValue: createCollateral }, { rawValue: createTokens })
      .send({ from: sponsor });

    // The balances minted should equal that expected from the create function.
    assert.equal(
      (await USDCToken.methods.balanceOf(customPricelessPositionManager.options.address).call()).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal((await tokenCurrency.methods.balanceOf(sponsor).call()).toString(), expectedSponsorTokens.toString());

    // Deposit an additional 50 USDC to the position. Sponsor now has 200 USDC as collateral.
    const depositCollateral = toBN("50").muln(1e6).toString();
    expectedContractCollateral = expectedContractCollateral.add(toBN(depositCollateral));
    await USDCToken.methods
      .approve(customPricelessPositionManager.options.address, depositCollateral)
      .send({ from: sponsor });
    await customPricelessPositionManager.methods.deposit({ rawValue: depositCollateral }).send({ from: sponsor });

    // The balances should reflect the additional collateral added.
    assert.equal(
      (await USDCToken.methods.balanceOf(customPricelessPositionManager.options.address).call()).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal((await tokenCurrency.methods.balanceOf(sponsor).call()).toString(), expectedSponsorTokens.toString());
    assert.equal(
      (await customPricelessPositionManager.methods.getCollateral(sponsor).call()).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal(
      (await customPricelessPositionManager.methods.positions(sponsor).call()).tokensOutstanding.toString(),
      expectedSponsorTokens.toString()
    );
    assert.equal(
      (await customPricelessPositionManager.methods.totalPositionCollateral().call()).toString(),
      expectedContractCollateral.toString()
    );
    assert.equal(
      (await customPricelessPositionManager.methods.totalTokensOutstanding().call()).toString(),
      expectedSponsorTokens.toString()
    );

    // By matching collateral and synthetic precision, we can assume that oracle price requests will always resolve to 18 decimals.
    // The two cases that need to be tested are responding to dispute requests and settlement.
    // Dispute and liquidation is tested in `Liquidatable.js`. Here we test settlement.

    // Transfer half the tokens from the sponsor to a tokenHolder. IRL this happens through the sponsor selling tokens.
    // Sponsor now has 50 synthetics and 200 collateral. Note that synthetic tokens are still represented with 1e18 base.
    const tokenHolderTokens = toBN("50").muln(1e6).toString();
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

    // Advance time until expiration. Token holders and sponsors should now be able to settle.
    const expirationTime = await customPricelessPositionManager.methods.expirationTimestamp().call();
    await customPricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    await customPricelessPositionManager.methods.expire().send({ from: other });

    // Push a settlement price into the mock oracle to simulate a DVM vote. Say settlement occurs at 1.2 Stock/USD for the price
    // feed. With 100 units of outstanding tokens this results in a token redemption value of: TRV = 100 * 1.2 = 120 USD.
    await collateral.methods
      .approve(customPricelessPositionManager.options.address, toWei("1000000"))
      .send({ from: proposer });
    const proposalTime = await optimisticOracle.methods.getCurrentTime().call();
    await optimisticOracle.methods
      .proposePrice(
        customPricelessPositionManager.options.address,
        priceFeedIdentifier,
        expirationTime,
        ancillaryData,
        toWei("1.2")
      )
      .send({ from: proposer });
    await optimisticOracle.methods.setCurrentTime(proposalTime + optimisticOracleLiveness).send({ from: accounts[0] });
    await optimisticOracle.methods
      .settle(customPricelessPositionManager.options.address, priceFeedIdentifier, expirationTime, ancillaryData)
      .send({ from: proposer });

    // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
    // They have 50 tokens settled at a price of 1.2 should yield 60 units of underling (or 60 USD as underlying is WETH).
    const tokenHolderInitialCollateral = toBN(await USDCToken.methods.balanceOf(tokenHolder).call());
    const tokenHolderInitialSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(customPricelessPositionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    let settleExpiredResult = await customPricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
    const tokenHolderFinalCollateral = toBN(await USDCToken.methods.balanceOf(tokenHolder).call());
    const tokenHolderFinalSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();

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
    await assertEventEmitted(settleExpiredResult, customPricelessPositionManager, "SettleExpiredPosition", (ev) => {
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
      .approve(customPricelessPositionManager.options.address, sponsorInitialSynthetic)
      .send({ from: sponsor });
    await customPricelessPositionManager.methods.settleExpired().send({ from: sponsor });
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
    const sponsorsPosition = await customPricelessPositionManager.methods.positions(sponsor).call();
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
  });
  it("Optimistic oracle dispute lifecycle", async function () {
    // Ensure that a disputed optimistic oracle price request moves the the lifecycle using the expected flow.

    await collateral.methods.approve(pricelessPositionManager.options.address, toWei("100000")).send({ from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.methods
      .create({ rawValue: amountCollateral }, { rawValue: numTokens })
      .send({ from: sponsor });

    const tokenHolderTokens = toWei("50");
    await tokenCurrency.methods.transfer(tokenHolder, tokenHolderTokens).send({ from: sponsor });

    // Advance time until after expiration. Token holders and sponsors should now be able to start trying to settle.
    const expirationTime = await pricelessPositionManager.methods.expirationTimestamp().call();
    await pricelessPositionManager.methods.setCurrentTime(parseInt(expirationTime)).send({ from: accounts[0] });

    // To settle positions the DVM needs to be to be queried to get the price at the settlement time.
    await pricelessPositionManager.methods.expire().send({ from: other });

    await verifyState(priceFeedIdentifier, parseInt(expirationTime), OptimisticOracleRequestStatesEnum.REQUESTED);

    // Check that the enquire price request with the optimistic oracle is listed.
    const priceRequest = await optimisticOracle.methods
      .getRequest(pricelessPositionManager.options.address, priceFeedIdentifier, expirationTime, ancillaryData)
      .call();
    assert.equal(priceRequest.settled, false);
    assert.equal(priceRequest.currency, collateral.options.address);
    assert.equal(priceRequest.proposedPrice, "0");

    // Instead of a normal settlement, we will go through a disputed price settlement to ensure the EMP->OO->DVM intergration
    // works as expected in the dispute case.
    const redemptionPrice = 1.2;
    const redemptionPriceWei = toWei(redemptionPrice.toString());
    await optimisticOracle.methods
      .proposePrice(
        pricelessPositionManager.options.address,
        priceFeedIdentifier,
        expirationTime,
        ancillaryData,
        toWei("1") // input price that will get disputed.
      )
      .send({ from: proposer });

    // dispute the price.
    await optimisticOracle.methods
      .disputePrice(pricelessPositionManager.options.address, priceFeedIdentifier, expirationTime, ancillaryData)
      .send({ from: other });

    await verifyState(priceFeedIdentifier, parseInt(expirationTime), OptimisticOracleRequestStatesEnum.DISPUTED);

    // push a price into the mockOracle
    await mockOracle.methods
      .pushPrice(
        priceFeedIdentifier,
        expirationTime,
        await optimisticOracle.methods
          .stampAncillaryData(ancillaryData, pricelessPositionManager.options.address)
          .call(),
        redemptionPriceWei
      )
      .send({ from: accounts[0] });

    await optimisticOracle.methods
      .settle(pricelessPositionManager.options.address, priceFeedIdentifier, expirationTime, ancillaryData)
      .send({ from: accounts[0] });
    await verifyState(priceFeedIdentifier, parseInt(expirationTime), OptimisticOracleRequestStatesEnum.SETTLED);

    // From the token holders, they are entitled to the value of their tokens, notated in the underlying.
    // They have 50 tokens settled at a price of 1.2 should yield 60 units of underling.
    const tokenHolderInitialCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderInitialSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();
    assert.equal(tokenHolderInitialSynthetic, tokenHolderTokens);

    // Approve the tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, tokenHolderInitialSynthetic)
      .send({ from: tokenHolder });
    let settleExpiredResult = await pricelessPositionManager.methods.settleExpired().send({ from: tokenHolder });
    assert.equal(
      await pricelessPositionManager.methods.contractState().call(),
      PositionStatesEnum.EXPIRED_PRICE_RECEIVED
    );
    const tokenHolderFinalCollateral = toBN(await collateral.methods.balanceOf(tokenHolder).call());
    const tokenHolderFinalSynthetic = await tokenCurrency.methods.balanceOf(tokenHolder).call();

    // The token holder should gain the value of their synthetic tokens in underlying.
    // The value in underlying is the number of tokens they held in the beginning * settlement price as TRV
    // When redeeming 50 tokens at a price of 1.2 we expect to receive 60 collateral tokens (50 * 1.2)
    const expectedTokenHolderFinalCollateral = toWei("60");
    assert.equal(tokenHolderFinalCollateral.sub(tokenHolderInitialCollateral), expectedTokenHolderFinalCollateral);

    // The token holder should have no synthetic positions left after settlement.
    assert.equal(tokenHolderFinalSynthetic, 0);

    // Check the event returned the correct values
    await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "SettleExpiredPosition", (ev) => {
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
    const sponsorInitialCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorInitialSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();

    // Approve tokens to be moved by the contract and execute the settlement.
    await tokenCurrency.methods
      .approve(pricelessPositionManager.options.address, sponsorInitialSynthetic)
      .send({ from: sponsor });

    // The token Sponsor should gain the value of their synthetics in underlying
    // + their excess collateral from the over collateralization in their position
    // Excess collateral = 150 - 100 * 1.2 = 30
    const expectedSponsorCollateralUnderlying = toBN(toWei("30"));
    // Value of remaining synthetic tokens = 50 * 1.2 = 60
    const expectedSponsorCollateralSynthetic = toBN(toWei("60"));
    const expectedTotalSponsorCollateralReturned = expectedSponsorCollateralUnderlying.add(
      expectedSponsorCollateralSynthetic
    );

    // Redeem and settleExpired should give the same result as just settleExpired.
    const settleExpired = pricelessPositionManager.methods.settleExpired();

    // Get the amount as if we only settleExpired.
    const settleExpiredOnlyAmount = await settleExpired.call({ from: sponsor });

    // Partially redeem and partially settleExpired.
    const partialRedemptionAmount = await pricelessPositionManager.methods
      .redeem({ rawValue: toWei("1") })
      .call({ from: sponsor });
    await pricelessPositionManager.methods.redeem({ rawValue: toWei("1") }).send({ from: sponsor });
    const partialSettleExpiredAmount = await settleExpired.call({ from: sponsor });
    settleExpiredResult = await settleExpired.send({ from: sponsor });

    // Compare the two paths' results.
    assert.equal(
      settleExpiredOnlyAmount.toString(),
      toBN(partialRedemptionAmount.toString()).add(toBN(partialSettleExpiredAmount.toString())).toString()
    );

    // Compare the amount to the expected return value.
    assert.equal(settleExpiredOnlyAmount.toString(), expectedTotalSponsorCollateralReturned.toString());

    // Check balances.
    const sponsorFinalCollateral = toBN(await collateral.methods.balanceOf(sponsor).call());
    const sponsorFinalSynthetic = await tokenCurrency.methods.balanceOf(sponsor).call();
    assert.equal(
      sponsorFinalCollateral.sub(sponsorInitialCollateral).toString(),
      expectedTotalSponsorCollateralReturned
    );

    // Check events.
    await assertEventEmitted(settleExpiredResult, pricelessPositionManager, "EndedSponsorPosition", (ev) => {
      return ev.sponsor == sponsor;
    });

    // The token Sponsor should have no synthetic positions left after settlement.
    assert.equal(sponsorFinalSynthetic, 0);

    // Last check is that after redemption the position in the positions mapping has been removed.
    const sponsorsPosition = await pricelessPositionManager.methods.positions(sponsor).call();
    assert.equal(sponsorsPosition.rawCollateral.rawValue, 0);
    assert.equal(sponsorsPosition.tokensOutstanding.rawValue, 0);
    assert.equal(sponsorsPosition.withdrawalRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.transferPositionRequestPassTimestamp.toString(), 0);
    assert.equal(sponsorsPosition.withdrawalRequestAmount.rawValue, 0);
  });
});
