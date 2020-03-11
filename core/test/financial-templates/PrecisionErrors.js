// Contracts to test
const PricelessPositionManager = artifacts.require("PricelessPositionManager");

// Other UMA related contracts and mocks
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MarginToken = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const TokenFactory = artifacts.require("TokenFactory");

contract("Measuring ExpiringMultiParty precision loss", function(accounts) {
  const { toWei, toBN, utf8ToHex } = web3.utils;
  const contractDeployer = accounts[0];
  const sponsor = accounts[1];
  const other = accounts[3];
  const collateralOwner = accounts[4];

  // Contracts
  let collateral;
  let pricelessPositionManager;
  let identifierWhitelist;

  // Initial constant values
  const syntheticName = "UMA test Token";
  const syntheticSymbol = "UMATEST";
  const withdrawalLiveness = 3600;
  const expirationTimestamp = Math.floor(Date.now() / 1000) + 10000;
  const priceTrackingIdentifier = utf8ToHex("UMATEST");

  beforeEach(async function() {
    // Create and mint collateral token.
    collateral = await MarginToken.new({ from: collateralOwner });
    await collateral.addMember(1, collateralOwner, { from: collateralOwner });
    await collateral.mint(sponsor, toWei("1000000"), { from: collateralOwner });
    await collateral.mint(other, toWei("1000000"), { from: collateralOwner });

    store = await Store.deployed();

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceTrackingIdentifier, {
      from: contractDeployer
    });

    // Create the instance of the PricelessPositionManager to test against.
    // The contract expires 10k seconds in the future -> will not expire during this test case.
    pricelessPositionManager = await PricelessPositionManager.new(
      true, // _isTest
      expirationTimestamp, // _expirationTimestamp
      withdrawalLiveness, // _withdrawalLiveness
      collateral.address, // _collateralAddress
      Finder.address, // _finderAddress
      priceTrackingIdentifier, // _priceFeedIdentifier
      syntheticName, // _syntheticName
      syntheticSymbol, // _syntheticSymbol
      TokenFactory.address,
      { from: contractDeployer }
    );
  });

  it("Precision loss due to payFees()", async function() {
    // Here, we choose a collateral amount that will produce one rounding error on the first run:
    // - Collateral = 9,000,000 wei.
    // - 0.0000004% fees per second * 1 second * 9,000,000 wei collateral = 3.6 wei fees, however this gets floored by `Store.computeFee()` to 3 wei fees.
    // - Fees paid as % of collateral = 3e-18 / 9000000-18 = 0.0000003...33 repeating, which cannot be represented by FixedPoint.
    // - The least significant digit will get ceil'd up from 3 to 4.
    // - This causes the adjustment multiplier applied to the collateral (1 - fee %) to be slightly lower.
    // - Ultimately this decreases the available collateral returned by `FeePayer._getCollateral()`.
    // - This produces drift between _getCollateral() and the actual collateral in the contract (`collateral.balanceOf(contract)`).

    /**
     * @notice TEST PARAMETERS
     */
    const testConfig = {
      startCollateralAmount: 9000000,
      startTokenAmount: 1,
      feeRatePerSecond: "0.0000004",
      expectedFeesCollectedPerPeriod: 3,
      runs: 500
    };

    /**
     * @notice INSTANTIATE TEST VARIABLES
     */
    let drift = toBN(0); // Precision loss on collateral.
    let adjustedCollateralAmount; // Amount of collateral returned by `contract.getCollateral()`
    let actualCollateralAmount; // Actual collateral owned by contract (there is only one sponsor, so we can check this via `token.balanceOf()`).
    let rawCollateralAmount; // Scaled up total contract collateral to account for fees.
    let endingStoreBalance; // Collateral owned by Store during the test, used to calculate fees collected.
    let actualFeesCollected; // Delta between starting store balance and ending store balance.
    let breakdown = {}; // Fill with CollateralBreakdown() objects for pretty printing.
    let actualFeeMultiplier; // Set to current fee multiplier.

    // Used to log collateral breakdown in a pretty fashion.
    function CollateralBreakdown(_sponsor) {
      this.sponsorPosition = _sponsor.toString();
    }

    /**
     * @notice SETUP THE TEST
     */
    // 1) Create position.
    await collateral.approve(pricelessPositionManager.address, testConfig.startCollateralAmount.toString(), {
      from: sponsor
    });
    await pricelessPositionManager.create(
      { rawValue: testConfig.startCollateralAmount.toString() },
      { rawValue: testConfig.startTokenAmount.toString() },
      { from: sponsor }
    );
    // 2) Set fee rate per second.
    await store.setFixedOracleFeePerSecond({ rawValue: toWei(testConfig.feeRatePerSecond) });
    // 3) Move time in the contract forward by 1 second to capture unit fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));

    /**
     * @notice TEST INVARIANTS
     */
    const startingStoreBalance = await collateral.balanceOf(store.address);
    adjustedCollateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    actualCollateralAmount = await collateral.balanceOf(pricelessPositionManager.address);
    rawCollateralAmount = await pricelessPositionManager.rawTotalPositionCollateral();
    actualFeeMultiplier = await pricelessPositionManager.cumulativeFeeMultiplier();

    // Test 1) The adjusted and actual collateral amount is the same to start, pre-fees.
    assert.equal(adjustedCollateralAmount.toString(), actualCollateralAmount.toString());

    // Test 2) The store has not collected any fees.
    assert.equal(startingStoreBalance.toString(), "0");

    // Test 3) Fee multiplier is set to default.
    assert.equal(parseFloat(actualFeeMultiplier.toString())/1e18, 1.0)

    // Test 4) Raw collateral and actual collateral amount are the same to start.
    assert.equal(rawCollateralAmount.toString(), actualCollateralAmount.toString())

    // Log results.
    breakdown.expected = new CollateralBreakdown(actualCollateralAmount);
    breakdown.credited = new CollateralBreakdown(adjustedCollateralAmount);
    breakdown.raw = new CollateralBreakdown(rawCollateralAmount);
    breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier);
    console.group("** Pre-Fees: **");
    console.table(breakdown);
    console.groupEnd();

    /**
     * @notice RUN THE TEST ONCE AND PRODUCE KNOWN DRIFT
     */
    await pricelessPositionManager.payFees();
    endingStoreBalance = await collateral.balanceOf(store.address);
    actualFeesCollected = endingStoreBalance.sub(startingStoreBalance).toString();
    adjustedCollateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    actualCollateralAmount = await collateral.balanceOf(pricelessPositionManager.address);
    rawCollateralAmount = await pricelessPositionManager.rawTotalPositionCollateral();
    actualFeeMultiplier = await pricelessPositionManager.cumulativeFeeMultiplier();
    drift = actualCollateralAmount.sub(toBN(adjustedCollateralAmount.rawValue));

    // Test 1) The correct fees are paid are regardless of precision loss.
    assert.equal(testConfig.expectedFeesCollectedPerPeriod.toString(), actualFeesCollected.toString());

    // Test 2) Due to the precision error mentioned above, `getCollateral()` should return
    // slightly less than what we are expecting.
    assert(drift.gt(toBN(0)));

    // Log results.
    breakdown.expected = new CollateralBreakdown(actualCollateralAmount);
    breakdown.credited = new CollateralBreakdown(adjustedCollateralAmount);
    breakdown.raw = new CollateralBreakdown(rawCollateralAmount);
    breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier);
    breakdown.drift = new CollateralBreakdown(drift);
    console.group(`** After 1 second: ${actualFeesCollected.toString()} collateral collected in fees **`);
    console.table(breakdown);
    console.groupEnd();

    /**
     * @notice RUN THE REMAINDER OF THE TEST AND CHECK UNKNOWN DRIFT
     * @dev For all of these runs, the expected fees collected per second should still be floor'd to 4 wei.
     * @dev Since we are no longer dividing by 9,000,000 in an intermediate calculation, it is not obvious that more
     * rounding errors will occur.
     */
    for (let i = 1; i <= testConfig.runs - 1; i++) {
      await pricelessPositionManager.setCurrentTime(startTime.addn(1 + i));
      await pricelessPositionManager.payFees();
    }
    endingStoreBalance = await collateral.balanceOf(store.address);
    actualFeesCollected = endingStoreBalance.sub(startingStoreBalance).toString();
    adjustedCollateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    actualCollateralAmount = await collateral.balanceOf(pricelessPositionManager.address);
    rawCollateralAmount = await pricelessPositionManager.rawTotalPositionCollateral();
    actualFeeMultiplier = await pricelessPositionManager.cumulativeFeeMultiplier();
    drift = actualCollateralAmount.sub(toBN(adjustedCollateralAmount.rawValue));

    // Test 1) The correct fees are paid are regardless of precision loss.
    assert.equal(
      (testConfig.expectedFeesCollectedPerPeriod * testConfig.runs).toString(),
      actualFeesCollected.toString()
    );

    // Test 2) Let's check if there is more drift.
    // Log results.
    breakdown.expected = new CollateralBreakdown(actualCollateralAmount);
    breakdown.credited = new CollateralBreakdown(adjustedCollateralAmount);
    breakdown.raw = new CollateralBreakdown(rawCollateralAmount);
    breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier);
    breakdown.drift = new CollateralBreakdown(drift);
    console.group(`** After ${testConfig.runs} seconds: **`);
    console.table(breakdown);
    console.groupEnd();
  });

  it("Precision loss due to deposit()", async function() {
    // In order to induce precision loss on deposits, we want to indirectly set the "cumulativeFeeMultiplier"
    // to a value that when divided by some amount cannot be represented fully by the Fixed Point structure.
    // To better understand this, we need to examine how the deposit() method is implemented:
    // - deposit(collateral) calls the internal method _addCollateral(collateral), which adjusts the position's collateral while taking fees into account.
    // - _addCollateral(collateral) scales up the collateral to add: adjustedCollateral = collateral / cumulativeFeeMultiplier.
    // - This division has the potential for precision loss, which could cause the resultant rawCollateral in the position to be lower than expected.
    // - In other words, the deposit() will have added less collateral to the position than the caller actually transferred.

    /**
     * @notice TEST PARAMETERS
     */
    const testConfig = {
      sponsorCollateralAmount: toWei("1"),
      otherCollateralAmount: toWei("0.1"),
      expectedFeeMultiplier: 0.9, // Division by this produces precision loss, tune this.
      feePerSecond: toWei("0.1"),
      amountToDeposit: toWei("0.1"),
      runs: 10
    };

    /**
     * @notice INSTANTIATE TEST VARIABLES
     */
    let actualFeeMultiplier; // Set to current fee multiplier.
    let startingContractCollateral; // Starting total contract collateral.
    let startingAdjustedContractCollateral; // Starting total contract collateral net of fees.
    let startingRawContractCollateral; // Starting scaled up total contract collateral to account for fees.
    let startingRawSponsorCollateral; // Starting scaled up sponsor collateral to account for fees.
    let startingStoreCollateral; // Starting amount of fees collected by store.
    let startingSponsorCollateral; // Starting amount of collateral credited to sponsor via deposits.
    let adjustedCollateral; // Starting total contract collateral net of fees.
    let contractCollateral; // Total contract collateral.
    let rawContractCollateral; // Scaled up total contract collateral.
    let sponsorCollateral; // Collateral credited to sponsor via deposits.
    let rawSponsorCollateral; // Scaled up collateral credited to sponsor.
    let expectedSponsorCollateral; // Amount of collateral that sponsor transfers to contract.
    let endingStoreCollateral; // Amount of fees collected by store
    let driftTotal = toBN(0); // Precision loss on total contract collateral.
    let driftSponsor = toBN(0); // Precision loss on just the sponsor's collateral.

    /**
     * @notice LOGGING
     */
    let breakdown = {}; // Fill with CollateralBreakdown() objects for pretty printing.
    // Used to log collateral breakdown in a pretty fashion.
    function CollateralBreakdown(_total, _sponsor) {
      this.totalPosition = _total.toString();
      this.sponsorPosition = _sponsor.toString();
    }

    /**
     * @notice SETUP THE TEST
     */
    // 1) Create position.
    await collateral.approve(pricelessPositionManager.address, toWei("999999999"), { from: sponsor });
    await pricelessPositionManager.create(
      { rawValue: testConfig.sponsorCollateralAmount },
      { rawValue: toWei("100") },
      { from: sponsor }
    );
    // 2) Set fee rate per second.
    await store.setFixedOracleFeePerSecond({ rawValue: testConfig.feePerSecond });
    // 3) Move time in the contract forward by 1 second to capture unit fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));
    // 4) Pay the fees.
    await pricelessPositionManager.payFees();

    /**
     * @notice PRE-TEST INVARIANTS
     */
    actualFeeMultiplier = await pricelessPositionManager.cumulativeFeeMultiplier();
    startingContractCollateral = await collateral.balanceOf(pricelessPositionManager.address);
    startingAdjustedContractCollateral = await pricelessPositionManager.totalPositionCollateral();
    startingStoreCollateral = await collateral.balanceOf(store.address);
    startingSponsorCollateral = await pricelessPositionManager.getCollateral(sponsor);
    expectedSponsorCollateral =
      testConfig.expectedFeeMultiplier * parseFloat(testConfig.sponsorCollateralAmount.toString());
    startingRawContractCollateral = await pricelessPositionManager.rawTotalPositionCollateral();
    startingRawSponsorCollateral = (await pricelessPositionManager.positions(sponsor)).rawCollateral;

    // Test 1) Fee multiplier is set correctly.
    assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, testConfig.expectedFeeMultiplier);

    // Test 2) The collateral net-of-fees and collateral in contract should be equal to start.
    assert.equal(startingContractCollateral.toString(), startingAdjustedContractCollateral.toString());

    // Test 3) The sponsor has initial collateral minus fees
    assert.equal(startingSponsorCollateral.toString(), expectedSponsorCollateral);

    // Log results in a table.
    breakdown.expected = new CollateralBreakdown(startingContractCollateral, expectedSponsorCollateral);
    breakdown.credited = new CollateralBreakdown(startingAdjustedContractCollateral, startingSponsorCollateral);
    breakdown.raw = new CollateralBreakdown(startingRawContractCollateral, startingRawSponsorCollateral);
    console.group("** Pre-Deposit: Expected and Credited amounts should be equal **");
    console.table(breakdown);
    console.groupEnd();

    /**
     * @notice RUN THE TEST ONCE
     */
    await pricelessPositionManager.deposit({ rawValue: testConfig.amountToDeposit }, { from: sponsor });
    contractCollateral = await collateral.balanceOf(pricelessPositionManager.address);
    adjustedCollateral = await pricelessPositionManager.totalPositionCollateral();
    sponsorCollateral = await pricelessPositionManager.getCollateral(sponsor);
    expectedSponsorCollateral =
      parseFloat(startingSponsorCollateral.toString()) + parseFloat(testConfig.amountToDeposit.toString());
    rawContractCollateral = await pricelessPositionManager.rawTotalPositionCollateral();
    rawSponsorCollateral = (await pricelessPositionManager.positions(sponsor)).rawCollateral;
    driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));
    driftSponsor = toBN(expectedSponsorCollateral).sub(toBN(sponsorCollateral.rawValue));

    // Log results in a table.
    breakdown.expected = new CollateralBreakdown(contractCollateral, expectedSponsorCollateral);
    breakdown.credited = new CollateralBreakdown(adjustedCollateral, sponsorCollateral);
    breakdown.raw = new CollateralBreakdown(rawContractCollateral, rawSponsorCollateral);
    breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
    console.group(`** After 1 Deposit of ${testConfig.amountToDeposit} collateral: **`);
    console.table(breakdown);
    console.groupEnd();

    /**
     * @notice RUN THE REMAINDER OF THE TEST
     */
    for (let i = 0; i < testConfig.runs - 1; i++) {
      await pricelessPositionManager.deposit({ rawValue: testConfig.amountToDeposit }, { from: sponsor });
    }
    contractCollateral = await collateral.balanceOf(pricelessPositionManager.address);
    adjustedCollateral = await pricelessPositionManager.totalPositionCollateral();
    sponsorCollateral = await pricelessPositionManager.getCollateral(sponsor);
    expectedSponsorCollateral =
      parseFloat(startingSponsorCollateral.toString()) +
      parseFloat(testConfig.amountToDeposit.toString()) * testConfig.runs;
    rawContractCollateral = await pricelessPositionManager.rawTotalPositionCollateral();
    rawSponsorCollateral = (await pricelessPositionManager.positions(sponsor)).rawCollateral;
    driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));
    driftSponsor = toBN(expectedSponsorCollateral).sub(toBN(sponsorCollateral.rawValue));

    // Log results in a table.
    breakdown.expected = new CollateralBreakdown(contractCollateral, expectedSponsorCollateral);
    breakdown.credited = new CollateralBreakdown(adjustedCollateral, sponsorCollateral);
    breakdown.raw = new CollateralBreakdown(rawContractCollateral, rawSponsorCollateral);
    breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
    console.group(`** After All ${testConfig.runs} Deposits: **`);
    console.table(breakdown);
    console.groupEnd();

    /**
     * @notice POST-TEST INVARIANTS
     */
    endingStoreCollateral = await collateral.balanceOf(store.address);

    // Test 1) Make sure that store hasn't collected any fees during this test, so that we can be confident that deposits
    // are the only source of drift.
    assert.equal(startingStoreCollateral.toString(), endingStoreCollateral.toString());

    // Test 2) The fee multiplier has not changed.
    assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, testConfig.expectedFeeMultiplier);
  });

  it("Precision loss due to withdraw()", async function() {
    // In order to induce precision loss on withdrawals, we will follow a similar strategy to deposit().
    // To better understand this, we need to examine how the withdraw() method is implemented:
    // - withdraw(collateral) calls the internal method _removeCollateral(collateral), which adjusts the position's collateral while taking fees into account.
    // - _removeCollateral(collateral) scales up the collateral to add: adjustedCollateral = collateral / cumulativeFeeMultiplier.
    // - This division has the potential for precision loss, which could cause the resultant rawCollateral in the position to be higher than expected.
    // - Note: here is the difference between deposit() and withdraw(): withdraw subtracts the floor'd quotient from rawCollateral so rawCollateral can be higher than expected
    // - In other words, the withdraw() will have subtracted less collateral from the position than the caller actually receives in the withdraw.
    // - We should expect to see negative "drift", because the adjusted collateral in contract will be higher than expected.

    /**
     * @notice TEST PARAMETERS
     */
    const testConfig = {
      sponsorCollateralAmount: toWei("100"),
      otherCollateralAmount: toWei("0.1"),
      feePerSecond: toWei("0.1"),
      expectedFeeMultiplier: 0.9, // Division by this produces precision loss, tune this.
      amountToWithdraw: toWei("0.001"), // Invariant: (runs * amountToWithdraw) >= (sponsorCollateralAmount - otherCollateralAmount), otherwise GCR check on withdraw() will fail
      runs: 10
    };

    /**
     * @notice INSTANTIATE TEST VARIABLES
     */
    let actualFeeMultiplier; // Set to current fee multiplier.
    let startingContractCollateral; // Starting total contract collateral.
    let startingAdjustedContractCollateral; // Starting total contract collateral net of fees.
    let startingRawContractCollateral; // Starting scaled up total contract collateral to account for fees.
    let startingRawSponsorCollateral; // Starting scaled up sponsor collateral to account for fees.
    let startingStoreCollateral; // Starting amount of fees collected by store.
    let startingSponsorCollateral; // Starting amount of collateral credited to sponsor via deposits.
    let adjustedCollateral; // Starting total contract collateral net of fees.
    let contractCollateral; // Total contract collateral.
    let rawContractCollateral; // Scaled up total contract collateral.
    let sponsorCollateral; // Collateral credited to sponsor via deposits.
    let rawSponsorCollateral; // Scaled up collateral credited to sponsor.
    let expectedSponsorCollateral; // Amount of collateral that sponsor transfers to contract.
    let endingStoreCollateral; // Amount of fees collected by store
    let driftTotal = toBN(0); // Precision loss on total contract collateral.
    let driftSponsor = toBN(0); // Precision loss on just the sponsor's collateral.

    /**
     * @notice LOGGING
     */
    let breakdown = {}; // Fill with CollateralBreakdown() objects for pretty printing.
    // Used to log collateral breakdown in a pretty fashion.
    function CollateralBreakdown(_total, _sponsor) {
      this.totalPosition = _total.toString();
      this.sponsorPosition = _sponsor.toString();
    }

    /**
     * @notice SETUP THE TEST
     */
    // 1) Create two positions, one with a very low collateral ratio so that we can withdraw from our test position.
    // Note: we must create less collateralized position first.
    await collateral.approve(pricelessPositionManager.address, toWei("999999999"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("999999999"), { from: other });
    await pricelessPositionManager.create(
      { rawValue: testConfig.otherCollateralAmount },
      { rawValue: toWei("100") },
      { from: other }
    );
    await pricelessPositionManager.create(
      { rawValue: testConfig.sponsorCollateralAmount },
      { rawValue: toWei("100") },
      { from: sponsor }
    );
    // 2) Set fee rate per second.
    await store.setFixedOracleFeePerSecond({ rawValue: testConfig.feePerSecond });
    // 3) Move time in the contract forward by 1 second to capture unit fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));
    // 4) Pay the fees.
    await pricelessPositionManager.payFees();

    /**
     * @notice PRE-TEST INVARIANTS
     */
    actualFeeMultiplier = await pricelessPositionManager.cumulativeFeeMultiplier();
    startingContractCollateral = await collateral.balanceOf(pricelessPositionManager.address);
    startingAdjustedContractCollateral = await pricelessPositionManager.totalPositionCollateral();
    startingStoreCollateral = await collateral.balanceOf(store.address);
    startingSponsorCollateral = await pricelessPositionManager.getCollateral(sponsor);
    expectedSponsorCollateral =
      testConfig.expectedFeeMultiplier * parseFloat(testConfig.sponsorCollateralAmount.toString());
    startingRawContractCollateral = await pricelessPositionManager.rawTotalPositionCollateral();
    startingRawSponsorCollateral = (await pricelessPositionManager.positions(sponsor)).rawCollateral;

    // Test 1) Fee multiplier is set correctly.
    assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, testConfig.expectedFeeMultiplier);

    // Test 2) The collateral net-of-fees and collateral in contract should be equal to start.
    assert.equal(startingContractCollateral.toString(), startingAdjustedContractCollateral.toString());

    // Test 3) The sponsor has initial collateral minus fees
    assert.equal(startingSponsorCollateral.toString(), expectedSponsorCollateral);

    // Log results in a table.
    breakdown.expected = new CollateralBreakdown(startingContractCollateral, expectedSponsorCollateral);
    breakdown.credited = new CollateralBreakdown(startingAdjustedContractCollateral, startingSponsorCollateral);
    breakdown.raw = new CollateralBreakdown(startingRawContractCollateral, startingRawSponsorCollateral);
    console.group("** Pre-Withdrawal: Expected and Credited amounts should be equal **");
    console.table(breakdown);
    console.groupEnd();

    /**
     * @notice RUN THE TEST ONCE
     */
    await pricelessPositionManager.withdraw({ rawValue: testConfig.amountToWithdraw }, { from: sponsor });
    contractCollateral = await collateral.balanceOf(pricelessPositionManager.address);
    adjustedCollateral = await pricelessPositionManager.totalPositionCollateral();
    sponsorCollateral = await pricelessPositionManager.getCollateral(sponsor);
    expectedSponsorCollateral =
      parseFloat(startingSponsorCollateral.toString()) - parseFloat(testConfig.amountToWithdraw.toString());
    rawContractCollateral = await pricelessPositionManager.rawTotalPositionCollateral();
    rawSponsorCollateral = (await pricelessPositionManager.positions(sponsor)).rawCollateral;
    driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));
    driftSponsor = toBN(expectedSponsorCollateral).sub(toBN(sponsorCollateral.rawValue));

    // Log results in a table.
    breakdown.expected = new CollateralBreakdown(contractCollateral, expectedSponsorCollateral);
    breakdown.credited = new CollateralBreakdown(adjustedCollateral, sponsorCollateral);
    breakdown.raw = new CollateralBreakdown(rawContractCollateral, rawSponsorCollateral);
    breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
    console.group(`** After 1 Withdrawal of ${parseFloat(testConfig.amountToWithdraw) / 1e18}e18 collateral: **`);
    console.table(breakdown);
    console.groupEnd();

    /**
     * @notice RUN THE REMAINDER OF THE TEST
     */
    for (let i = 0; i < testConfig.runs - 1; i++) {
      await pricelessPositionManager.withdraw({ rawValue: testConfig.amountToWithdraw }, { from: sponsor });
    }
    contractCollateral = await collateral.balanceOf(pricelessPositionManager.address);
    adjustedCollateral = await pricelessPositionManager.totalPositionCollateral();
    sponsorCollateral = await pricelessPositionManager.getCollateral(sponsor);
    expectedSponsorCollateral =
      parseFloat(startingSponsorCollateral.toString()) -
      parseFloat(testConfig.amountToWithdraw.toString()) * testConfig.runs;
    rawContractCollateral = await pricelessPositionManager.rawTotalPositionCollateral();
    rawSponsorCollateral = (await pricelessPositionManager.positions(sponsor)).rawCollateral;
    driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));
    driftSponsor = toBN(expectedSponsorCollateral).sub(toBN(sponsorCollateral.rawValue));

    // Log results in a table.
    breakdown.expected = new CollateralBreakdown(contractCollateral, expectedSponsorCollateral);
    breakdown.credited = new CollateralBreakdown(adjustedCollateral, sponsorCollateral);
    breakdown.raw = new CollateralBreakdown(rawContractCollateral, rawSponsorCollateral);
    breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
    console.group(`** After All ${testConfig.runs} Withdrawals: **`);
    console.table(breakdown);
    console.groupEnd();

    /**
     * @notice POST-TEST INVARIANTS
     */
    endingStoreCollateral = await collateral.balanceOf(store.address);

    // Test 1) Make sure that store hasn't collected any fees during this test, so that we can be confident that withdraws
    // are the only source of drift.
    assert.equal(startingStoreCollateral.toString(), endingStoreCollateral.toString());

    // Test 2) The fee multiplier has not changed.
    assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, testConfig.expectedFeeMultiplier);
  });
});
