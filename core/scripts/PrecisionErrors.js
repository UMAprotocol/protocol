/**
 * @notice This is the main script that performs experiments on precision loss occuring throughout ExpiringMultiParty methods.
 * Precision loss occurs when multiplying or dividing FixedPoint numbers because FixedPoint can only store a fixed
 * amount of decimals. Therefore, calculations will get truncated and either floored or ceiled. Each test runs in isolation
 * by creating a new test environment with a new EMP contract.
 * @dev This script works assuming that the sender of all transactions is the deployer of the EMP contracts.
 *
 * Assumptions: You are currently in the `/core` directory.
 * Requirements: Deploy contracts via `$(npm bin)/truffle migrate --reset --network <network>
 * Run: $(npm bin)/truffle exec ./scripts/PrecisionErrors.js --network test
 */

// Helpers
const assert = require("assert").strict;
const truffleAssert = require("truffle-assertions");
const { toWei, fromWei, toBN, utf8ToHex } = web3.utils;

// Contracts to test
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// Other UMA related contracts and mocks
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MarginToken = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const TokenFactory = artifacts.require("TokenFactory");

/**
 * @notice Deploys a brand new ExpiringMultiParty contract so that each experiment can run in isolation.
 * @assumption Truffle object has 3 accounts, the first is the contract deployer, the second and third as the sponsor and another sponsor respectively.
 * @return {*Object} {
 *  - collateral contract,
 *  - synthetic contract,
 *  - emp contract,
 *  - store contract,
 *  - sponsor address,
 *  - contract deployer address
 * }
 */
async function createTestEnvironment() {
  // User roles.
  const contractDeployer = (await web3.eth.getAccounts())[0];
  const sponsor = (await web3.eth.getAccounts())[1];
  const other = (await web3.eth.getAccounts())[2];

  // Contracts
  let collateral;
  let synthetic;
  let emp;
  let store;
  let identifierWhitelist;

  // Initial constant values
  const syntheticName = "UMA test Token";
  const syntheticSymbol = "UMATEST";
  const withdrawalLiveness = 0;
  const liquidationLiveness = 3600;
  const expirationTimestamp = Math.floor(Date.now() / 1000) + 10000;
  const priceTrackingIdentifier = utf8ToHex("UMATEST");
  const collateralRequirement = toWei("1.5");
  const disputeBondPct = toWei("0.1");
  const sponsorDisputeRewardPct = toWei("0.1");
  const disputerDisputeRewardPct = toWei("0.1");

  // Create and mint collateral token.
  collateral = await MarginToken.new();
  await collateral.addMember(1, contractDeployer, { from: contractDeployer });
  await collateral.mint(sponsor, toWei("1000000"), { from: contractDeployer });
  await collateral.mint(other, toWei("1000000"), { from: contractDeployer });

  store = await Store.deployed();

  // Create identifier whitelist and register the price tracking ticker with it.
  identifierWhitelist = await IdentifierWhitelist.deployed();
  await identifierWhitelist.addSupportedIdentifier(priceTrackingIdentifier, { from: contractDeployer });

  // Create the instance of the emp to test against.
  // The contract expires 10k seconds in the future -> will not expire during this test case.
  const constructorParams = {
    isTest: true,
    expirationTimestamp: expirationTimestamp,
    withdrawalLiveness: withdrawalLiveness,
    collateralAddress: collateral.address,
    finderAddress: Finder.address,
    tokenFactoryAddress: TokenFactory.address,
    priceFeedIdentifier: priceTrackingIdentifier,
    syntheticName: syntheticName,
    syntheticSymbol: syntheticSymbol,
    liquidationLiveness: liquidationLiveness,
    collateralRequirement: { rawValue: collateralRequirement },
    disputeBondPct: { rawValue: disputeBondPct },
    sponsorDisputeRewardPct: { rawValue: sponsorDisputeRewardPct },
    disputerDisputeRewardPct: { rawValue: disputerDisputeRewardPct }
  };
  emp = await ExpiringMultiParty.new(constructorParams, { from: contractDeployer });
  synthetic = await SyntheticToken.at(await emp.tokenCurrency());

  return {
    collateral,
    synthetic,
    emp,
    store,
    sponsor,
    contractDeployer,
    other
  };
}

/**
 * @notice Used to log experiment asset breakdown in a pretty fashion.
 * @param _sponsor Assets belonging to sponsor.
 * @return {*Object} compatible with console.table()
 */
function CollateralBreakdown(_total, _sponsor) {
  try {
    this.totalPosition = fromWei(_total.toString());
  } catch (err) {
    this.totalPosition = _total.toString();
  }
  try {
    this.sponsorPosition = fromWei(_sponsor.toString());
  } catch (err) {
    this.sponsorPosition = _sponsor.toString();
  }
}

/**
 * @notice Main script.
 **/
async function runExport() {
  // Ultimately what matters is the difference between the expected and actual amount of collateral credited to the contract. 
  // We attempt to quantify this per single run per type of transaction.
  let precisionLossPercentage; 

  // Empty-state contracts needed to run experiments.
  let collateral;
  let synthetic;
  let emp;
  let store;

  // User roles.
  let contractDeployer;
  let sponsor;

  // Experiment environments.
  let experimentEnv;
  let testConfig;

  // Test variables:
  let startTime; // Contract time at start of experiment.
  let driftTotal = toBN(0); // Precision loss on total contract collateral.
  let driftSponsor = toBN(0); // Precision loss on just the sponsor's collateral.
  let tokensOutstanding; // Current count of synthetic tokens outstanding. Need to remember this before calling redeem() in order to forecast post-redemption collateral.
  // Collateral actually owned by contract (i.e. queryable via `collateral.balanceOf(contract)`).
  let startingContractCollateral;
  let contractCollateral;
  // Credited collateral net of fees (i.e. queryable via `contract.totalPositionCollateral()|.getCollateral(sponsor)`).
  let startingAdjustedContractCollateral;
  let adjustedCollateral;
  let startingSponsorCollateral;
  let sponsorCollateral;
  let expectedSponsorCollateral;
  // Scaled up collateral used by contract to track fees (i.e. queryable via `contract.rawTotalPositionCollateral()|contract.positions(sponsor).rawCollateral`).
  let startingRawContractCollateral;
  let startingRawSponsorCollateral;
  let rawContractCollateral;
  let rawSponsorCollateral;
  // Used to track Store collateral to calculate fees collected.
  let startingStoreCollateral;
  let endingStoreCollateral;
  let actualFeesCollected;
  // Cumulative fee multiplier used by contract to track fees. Multiplied by raw collateral to get "credited" collateral.
  let actualFeeMultiplier;

  // Misc.
  let breakdown; // Fill with CollateralBreakdown() objects for pretty printing.
  let createLiquidationResult; // Store createLiquidation event.

  /** ***************************************************************************
   *
   * START PAYFEES()
   *
   *****************************************************************************/
  // Precision error in the `payFees()` method can occur when the cumulative fee multiplier specifically loses precision.
  // Remember how we calculate the cumulative fee multiplier: ((1 - fee %) * cumulativeFeeMultiplier)
  // There are two intermediate calculations here which can produce error:
  // 1) The calculation of "fee %" which is equal to: (fees paid) / (PfC), and this division potentially "ceil"'s the quotient.
  // 2) The multiplication of (1 - fee %) and cumulativeFeeMultiplier which could "floor" the product.
  // In both situations, the resultant feeMultiplier is less than it should be, therefore
  // the contract believes it to have less collateral than it actually owns (`getCollateral()` returns less than `collateral.balanceOf()`).

  // Situation 1: The percentage of fees paid (as a % of PfC) gets "ceil"'d.
  // -------------------------------------------------------------------------------------------------------------------------------
  // Example:
  // - Collateral = 9 wei.
  // - 40% fees per second * 1 second * 9 wei collateral = 3.6 wei fees, however this gets floored by `Store.computeFee()` to 3 wei fees.
  // - Fees paid as % of collateral = 3e-18 / 9e-18 = 0.3...33 repeating, which cannot be represented by FixedPoint.
  // - The least significant digit will get ceil'd up from 3 to 4.
  // - This causes the adjustment multiplier applied to the collateral (1 - fee %) to be slightly lower:
  // - 0.6...66 instead of 0.6...67.
  // - Ultimately this decreases the available collateral returned by `FeePayer._getCollateral()`.
  // -------------------------------------------------------------------------------------------------------------------------------

  // Situation 2: The cumulative fee multiplier gets "floor"'d.
  // -------------------------------------------------------------------------------------------------------------------------------
  // Example:
  // - Assess fees such that the fee multiplier is 1e-17
  // - Change fee rate to 0.01 and charge one time unit's worth of fees.
  // - Fee multiplier is calculated as ((1 - fee %) * cumulativeFeeMultiplier)
  // - In this case: ((1-0.01) * 1e-17 = 9.9e-18)
  // - The multiplication is floored, causing the fee multiplier to get set to 9e-18
  // -------------------------------------------------------------------------------------------------------------------------------

  // Conclusion:
  // -------------------------------------------------------------------------------------------------------------------------------
  // Precision loss in the fee multiplier compounds over time, as the fee multiplier is applied to all future fees charged.
  // This precision loss affects a percentage, not a flat value, So as the value in the contract scales up,
  // the precision loss, in real dollar terms, scales up too.
  // 
  // Specifically, for a single transaction, the cumulative fee multiplier can have a maximum precision loss of 1e-18.
  // However, the precision loss as a percentage of the previous fee multiplier increases over time, since
  // the fee multiplier can only decrease over time.

  console.group("Cumulative Fee Multiplier gets Floor'd");
  /**
   * @notice CREATE NEW EXPERIMENT
   */
  breakdown = {};
  experimentEnv = await createTestEnvironment();
  collateral = experimentEnv.collateral;
  synthetic = experimentEnv.synthetic;
  emp = experimentEnv.emp;
  store = experimentEnv.store;
  sponsor = experimentEnv.sponsor;
  contractDeployer = experimentEnv.contractDeployer;

  /**
   * @notice TEST PARAMETERS
   */
  testConfig = {
    startCollateralAmount: 1e18,
    startTokenAmount: 1,
    feeRatePerSecond: "0." + "9".repeat(17), // Used to set initial fee multiplier
    modifiedFeeRatePerSecond: "0.01", // Used to charge additional fees
    expectedFeesCollected: "9".repeat(17) + "0" // Amount of fees collected total
  };

  /**
   * @notice SETUP THE TEST
   */
  // 1) Create position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create(
    { rawValue: testConfig.startCollateralAmount.toString() },
    { rawValue: testConfig.startTokenAmount.toString() },
    { from: sponsor }
  );
  // 2) Set fee rate per second.
  await store.setFixedOracleFeePerSecond({ rawValue: toWei(testConfig.feeRatePerSecond) }, { from: contractDeployer });
  // 3) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1), { from: contractDeployer });

  /**
   * @notice TEST INVARIANTS
   */
  startingStoreCollateral = await collateral.balanceOf(store.address);
  startingAdjustedContractCollateral = await emp.getCollateral(sponsor);
  startingContractCollateral = await collateral.balanceOf(emp.address);
  startingRawContractCollateral = await emp.rawTotalPositionCollateral();
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();

  // Test 1) The adjusted and actual collateral amount is the same to start, pre-fees.
  assert.equal(startingAdjustedContractCollateral.toString(), startingContractCollateral.toString());

  // Test 2) The store has not collected any fees.
  assert.equal(startingStoreCollateral.toString(), "0");

  // Test 3) Fee multiplier is set to default.
  assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, 1.0);

  // Test 4) Raw collateral and actual collateral amount are the same to start.
  assert.equal(startingRawContractCollateral.toString(), startingContractCollateral.toString());

  // Log results.
  breakdown.expected = new CollateralBreakdown(startingContractCollateral, "N/A");
  breakdown.credited = new CollateralBreakdown(startingAdjustedContractCollateral, "N/A");
  breakdown.raw = new CollateralBreakdown(startingRawContractCollateral, "N/A");
  breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier, "N/A");
  console.group("** Collateral Before Charging any Fees **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE AND SET THE INITIAL FEE MULTIPLIER
   */
  await emp.payFees({ from: sponsor });
  endingStoreCollateral = await collateral.balanceOf(store.address);
  actualFeesCollected = endingStoreCollateral.sub(startingStoreCollateral).toString();
  adjustedCollateral = await emp.totalPositionCollateral();
  contractCollateral = await collateral.balanceOf(emp.address);
  rawContractCollateral = await emp.rawTotalPositionCollateral();
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));

  // Test 1) The correct fees are paid.
  assert.equal(testConfig.expectedFeesCollected, actualFeesCollected.toString());

  // Log results.
  breakdown.expected = new CollateralBreakdown(contractCollateral, "N/A");
  breakdown.credited = new CollateralBreakdown(adjustedCollateral, "N/A");
  breakdown.raw = new CollateralBreakdown(rawContractCollateral, "N/A");
  breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier, "N/A");
  breakdown.drift = new CollateralBreakdown(driftTotal, "N/A");
  console.group(`** Collateral After Charging ${testConfig.feeRatePerSecond} in Fees (${fromWei(actualFeesCollected.toString())} total fees collected) **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice SET ANOTHER FEE RATE AND PRODUCE PRECISION LOSS IN THE FEE MULTIPLIER
   */
  // 0) Deposit more collateral into the contract so that there is enough collateral to charge fees correctly
  // without precision loss
  console.log(`** Depositing another ${fromWei(testConfig.expectedFeesCollected)} **`)
  await emp.deposit({ rawValue: testConfig.expectedFeesCollected }, { from: sponsor });
  // 1) Set fee rate per second.
  await store.setFixedOracleFeePerSecond(
    { rawValue: toWei(testConfig.modifiedFeeRatePerSecond) },
    { from: contractDeployer }
  );
  // 2) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1), { from: contractDeployer });
  await emp.payFees({ from: sponsor });
  endingStoreCollateral = await collateral.balanceOf(store.address);
  actualFeesCollected = endingStoreCollateral.sub(startingStoreCollateral).toString();
  adjustedCollateral = await emp.totalPositionCollateral();
  contractCollateral = await collateral.balanceOf(emp.address);
  rawContractCollateral = await emp.rawTotalPositionCollateral();
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));

  // Test 1) The correct fees are paid.
  testConfig.expectedFeesCollected = toBN(testConfig.expectedFeesCollected)
    .add(toBN(toWei("0.01")))
    .toString();
  assert.equal(testConfig.expectedFeesCollected, actualFeesCollected.toString());

  // Log results.
  breakdown.expected = new CollateralBreakdown(contractCollateral, "N/A");
  breakdown.credited = new CollateralBreakdown(adjustedCollateral, "N/A");
  breakdown.raw = new CollateralBreakdown(rawContractCollateral, "N/A");
  breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier, "N/A");
  breakdown.drift = new CollateralBreakdown(driftTotal, "N/A");
  console.group(`** Collateral After Charging ${testConfig.modifiedFeeRatePerSecond} in Fees (${fromWei(actualFeesCollected.toString())} total fees collected) **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice ASSERT PRECISION LOSS IN FEE MULTIPLIER
   */
  // Without precision loss, the cumulative fee multiplier should be 9.9e-18 but it gets floored to 9e-18.
  // Therefore, the credited collateral is (0.9e-18 / 9.9e-18) ~= 9% less than it should be.
  assert.equal(fromWei(driftTotal), "0.09")

  /**
   * @notice POST-TEST CLEANUP
   */

  // Reset store fees.
  await store.setFixedOracleFeePerSecond({ rawValue: toWei("0") }, { from: contractDeployer });

  console.groupEnd();

  console.group("Fees paid as % of PfC gets Ceil'd");
  /**
   * @notice CREATE NEW EXPERIMENT
   */
  breakdown = {};
  experimentEnv = await createTestEnvironment();
  collateral = experimentEnv.collateral;
  synthetic = experimentEnv.synthetic;
  emp = experimentEnv.emp;
  store = experimentEnv.store;
  sponsor = experimentEnv.sponsor;
  contractDeployer = experimentEnv.contractDeployer;

  /**
   * @notice TEST PARAMETERS
   */
  testConfig = {
    startCollateralAmount: 9,
    startTokenAmount: 1,
    feeRatePerSecond: "0.4", // Used to set initial fee multiplier
    expectedFeesCollectedPerPeriod: "3"
  };

  /**
   * @notice SETUP THE TEST
   */
  // 1) Create position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create(
    { rawValue: testConfig.startCollateralAmount.toString() },
    { rawValue: testConfig.startTokenAmount.toString() },
    { from: sponsor }
  );
  // 2) Set fee rate per second.
  await store.setFixedOracleFeePerSecond({ rawValue: toWei(testConfig.feeRatePerSecond) }, { from: contractDeployer });
  // 3) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1), { from: contractDeployer });

  /**
   * @notice TEST INVARIANTS
   */
  startingStoreCollateral = await collateral.balanceOf(store.address);
  startingAdjustedContractCollateral = await emp.getCollateral(sponsor);
  startingContractCollateral = await collateral.balanceOf(emp.address);
  startingRawContractCollateral = await emp.rawTotalPositionCollateral();
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();

  // Test 1) The adjusted and actual collateral amount is the same to start, pre-fees.
  assert.equal(startingAdjustedContractCollateral.toString(), startingContractCollateral.toString());

  // Test 2) The store has not collected any fees.
  assert.equal(startingStoreCollateral.toString(), "0");

  // Test 3) Fee multiplier is set to default.
  assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, 1.0);

  // Test 4) Raw collateral and actual collateral amount are the same to start.
  assert.equal(startingRawContractCollateral.toString(), startingContractCollateral.toString());

  // Log results.
  breakdown.expected = new CollateralBreakdown(startingContractCollateral, "N/A");
  breakdown.credited = new CollateralBreakdown(startingAdjustedContractCollateral, "N/A");
  breakdown.raw = new CollateralBreakdown(startingRawContractCollateral, "N/A");
  breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier, "N/A");
  console.group("** Collateral Before Charging any Fees **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE AND SET THE INITIAL FEE MULTIPLIER
   */
  await emp.payFees({ from: sponsor });
  endingStoreCollateral = await collateral.balanceOf(store.address);
  actualFeesCollected = endingStoreCollateral.sub(startingStoreCollateral).toString();
  adjustedCollateral = await emp.totalPositionCollateral();
  contractCollateral = await collateral.balanceOf(emp.address);
  rawContractCollateral = await emp.rawTotalPositionCollateral();
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));

  // Test 1) The correct fees are paid.
  assert.equal(testConfig.expectedFeesCollectedPerPeriod, actualFeesCollected.toString());

  // Log results.
  breakdown.expected = new CollateralBreakdown(contractCollateral, "N/A");
  breakdown.credited = new CollateralBreakdown(adjustedCollateral, "N/A");
  breakdown.raw = new CollateralBreakdown(rawContractCollateral, "N/A");
  breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier, "N/A");
  breakdown.drift = new CollateralBreakdown(driftTotal, "N/A");
  console.group(`** Collateral After Charging ${testConfig.feeRatePerSecond} in Fees (${fromWei(actualFeesCollected.toString())} total fees collected) **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice ASSERT PRECISION LOSS IN FEE MULTIPLIER
   */
  // Without precision loss, the cumulative fee multiplier should be 0.6...66 repeating but it gets floored to 0.6...66.
  // Therefore, the credited collateral is (1e-18 / 6e-18) ~= 16.7% less than it should be.
  assert.equal(fromWei(driftTotal), '0.000000000000000001')

  /**
   * @notice POST-TEST CLEANUP
   */

  // Reset store fees.
  await store.setFixedOracleFeePerSecond({ rawValue: toWei("0") }, { from: contractDeployer });

  console.groupEnd();
  /** ***************************************************************************
   *
   * END PAYFEES()
   *
   *****************************************************************************/

  /** ***************************************************************************
   *
   * START DEPOSIT()
   *
   *****************************************************************************/

  /**
   * @notice CREATE NEW EXPERIMENT
   */
  experimentEnv = await createTestEnvironment();
  collateral = experimentEnv.collateral;
  synthetic = experimentEnv.synthetic;
  emp = experimentEnv.emp;
  store = experimentEnv.store;
  sponsor = experimentEnv.sponsor;
  contractDeployer = experimentEnv.contractDeployer;

  console.group("Precision loss due to deposit()");
  // In order to induce precision loss on deposits, we want to indirectly set the "cumulativeFeeMultiplier"
  // to a value that when divided by some amount cannot be represented fully by the Fixed Point structure.
  // To better understand this, we need to examine how the deposit() method is implemented:
  // - deposit(collateral) calls the internal method _addCollateral(collateral), which adjusts the position's collateral while taking fees into account.
  // - _addCollateral(collateral) scales up the collateral to add: adjustedCollateral = collateral / cumulativeFeeMultiplier.
  // - adjustedCollateral is added to rawCollateral.
  // - Therefore, this division has the potential for precision loss, which could cause the resultant rawCollateral in the position to be lower than expected.
  // - In other words, the deposit() will have added less collateral to the position than the caller actually transferred.

  /**
   * @notice TEST PARAMETERS
   */
  testConfig = {
    sponsorCollateralAmount: toWei("0.1"),
    expectedFeeMultiplier: 0.9, // Division by this produces precision loss, tune this.
    feePerSecond: toWei("0.1"),
    amountToDeposit: toWei("0.1")
  };

  /**
   * @notice SETUP THE TEST
   */
  // 1) Create position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create({ rawValue: testConfig.sponsorCollateralAmount }, { rawValue: toWei("100") }, { from: sponsor });
  // 2) Set fee rate per second.
  await store.setFixedOracleFeePerSecond({ rawValue: testConfig.feePerSecond }, { from: contractDeployer });
  // 3) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1));
  // 4) Pay the fees.
  await emp.payFees({ from: sponsor });

  /**
   * @notice PRE-TEST INVARIANTS
   */
  breakdown = {};
  driftTotal = toBN(0);
  driftSponsor = toBN(0);
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  startingContractCollateral = await collateral.balanceOf(emp.address);
  startingAdjustedContractCollateral = await emp.totalPositionCollateral();
  startingStoreCollateral = await collateral.balanceOf(store.address);
  startingSponsorCollateral = await emp.getCollateral(sponsor);
  expectedSponsorCollateral =
    testConfig.expectedFeeMultiplier * parseFloat(testConfig.sponsorCollateralAmount.toString());
  startingRawContractCollateral = await emp.rawTotalPositionCollateral();
  startingRawSponsorCollateral = (await emp.positions(sponsor)).rawCollateral;

  // Test 1) Fee multiplier is set correctly.
  assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, testConfig.expectedFeeMultiplier);

  // Test 2) The collateral net-of-fees and collateral in contract should be equal to start.
  assert.equal(startingContractCollateral.toString(), startingAdjustedContractCollateral.toString());

  // Test 3) The sponsor has initial collateral minus fees
  assert.equal(startingSponsorCollateral.toString(), expectedSponsorCollateral.toString());

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(startingContractCollateral, expectedSponsorCollateral);
  breakdown.credited = new CollateralBreakdown(startingAdjustedContractCollateral, startingSponsorCollateral);
  breakdown.raw = new CollateralBreakdown(startingRawContractCollateral, startingRawSponsorCollateral);
  console.group("** Pre-Deposit: Actual and Credited Collateral should be equal **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE
   */
  await emp.deposit({ rawValue: testConfig.amountToDeposit }, { from: sponsor });
  contractCollateral = await collateral.balanceOf(emp.address);
  adjustedCollateral = await emp.totalPositionCollateral();
  sponsorCollateral = await emp.getCollateral(sponsor);
  expectedSponsorCollateral =
    parseFloat(startingSponsorCollateral.toString()) + parseFloat(testConfig.amountToDeposit.toString());
  rawContractCollateral = await emp.rawTotalPositionCollateral();
  rawSponsorCollateral = (await emp.positions(sponsor)).rawCollateral;
  driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));
  driftSponsor = toBN(expectedSponsorCollateral).sub(toBN(sponsorCollateral.rawValue));

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(contractCollateral, expectedSponsorCollateral);
  breakdown.credited = new CollateralBreakdown(adjustedCollateral, sponsorCollateral);
  breakdown.raw = new CollateralBreakdown(rawContractCollateral, rawSponsorCollateral);
  breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
  console.group(
    `** After 1 Deposit of ${fromWei(testConfig.amountToDeposit)} collateral (fee-multiplier = ${testConfig.expectedFeeMultiplier}): **`
  );
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

  /**
   * @notice ASSERT PRECISION LOSS IN FEE MULTIPLIER
   */
  // Without precision loss, `_addCollateral()` should add (0.1 / 0.9 = 0.1...11 repeating) raw collateral to the contract 
  // but this gets floored. Therefore, the credited collateral is (1e-18 / [0.09+0.1]) ~= 5.3e-18% less than it should be.
  assert.equal(fromWei(driftTotal), "0.000000000000000001")

  /**
   * @notice POST-TEST CLEANUP
   */

  // Reset store fees.
  await store.setFixedOracleFeePerSecond({ rawValue: toWei("0") }, { from: contractDeployer });

  console.groupEnd();
  /** ***************************************************************************
   *
   * END DEPOSIT()
   *
   *****************************************************************************/

  /** ***************************************************************************
   *
   * START CREATE()
   *
   *****************************************************************************/
  console.group("Precision loss due to createToken()");
  // The precision loss mechanic is identical to deposit().

  /**
   * @notice CREATE NEW EXPERIMENT
   */
  experimentEnv = await createTestEnvironment();
  collateral = experimentEnv.collateral;
  synthetic = experimentEnv.synthetic;
  emp = experimentEnv.emp;
  store = experimentEnv.store;
  sponsor = experimentEnv.sponsor;
  contractDeployer = experimentEnv.contractDeployer;

  /**
   * @notice TEST PARAMETERS
   */
  testConfig = {
    sponsorCollateralAmount: toWei("0.1"),
    expectedFeeMultiplier: 0.9, // Division by this produces precision loss, tune this.
    feePerSecond: toWei("0.1"),
    amountToDeposit: toWei("0.1"),
    amountToCreate: toWei("1") // Amount of synthetic tokens to create does not matter.
  };

  /**
   * @notice SETUP THE TEST
   */
  // 1) Create position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create(
    { rawValue: testConfig.sponsorCollateralAmount },
    { rawValue: testConfig.amountToCreate },
    { from: sponsor }
  );
  // 2) Set fee rate per second.
  await store.setFixedOracleFeePerSecond({ rawValue: testConfig.feePerSecond }, { from: contractDeployer });
  // 3) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1));
  // 4) Pay the fees.
  await emp.payFees();

  /**
   * @notice PRE-TEST INVARIANTS
   */
  breakdown = {};
  driftTotal = toBN(0);
  driftSponsor = toBN(0);
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  startingContractCollateral = await collateral.balanceOf(emp.address);
  startingAdjustedContractCollateral = await emp.totalPositionCollateral();
  startingStoreCollateral = await collateral.balanceOf(store.address);
  startingSponsorCollateral = await emp.getCollateral(sponsor);
  expectedSponsorCollateral =
    testConfig.expectedFeeMultiplier * parseFloat(testConfig.sponsorCollateralAmount.toString());
  startingRawContractCollateral = await emp.rawTotalPositionCollateral();
  startingRawSponsorCollateral = (await emp.positions(sponsor)).rawCollateral;

  // Test 1) Fee multiplier is set correctly.
  assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, testConfig.expectedFeeMultiplier);

  // Test 2) The collateral net-of-fees and collateral in contract should be equal to start.
  assert.equal(startingContractCollateral.toString(), startingAdjustedContractCollateral.toString());

  // Test 3) The sponsor has initial collateral minus fees
  assert.equal(startingSponsorCollateral.toString(), expectedSponsorCollateral.toString());

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(startingContractCollateral, expectedSponsorCollateral);
  breakdown.credited = new CollateralBreakdown(startingAdjustedContractCollateral, startingSponsorCollateral);
  breakdown.raw = new CollateralBreakdown(startingRawContractCollateral, startingRawSponsorCollateral);
  delete breakdown.drift;
  delete console.group("** Pre-Create: Actual and Credited Collateral should be equal **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE
   */
  await collateral.approve(emp.address, testConfig.sponsorCollateralAmount, { from: sponsor });
  await emp.create(
    { rawValue: testConfig.sponsorCollateralAmount },
    { rawValue: testConfig.amountToCreate },
    { from: sponsor }
  );
  contractCollateral = await collateral.balanceOf(emp.address);
  adjustedCollateral = await emp.totalPositionCollateral();
  sponsorCollateral = await emp.getCollateral(sponsor);
  expectedSponsorCollateral =
    parseFloat(startingSponsorCollateral.toString()) + parseFloat(testConfig.amountToDeposit.toString());
  rawContractCollateral = await emp.rawTotalPositionCollateral();
  rawSponsorCollateral = (await emp.positions(sponsor)).rawCollateral;
  driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));
  driftSponsor = toBN(expectedSponsorCollateral).sub(toBN(sponsorCollateral.rawValue));

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(contractCollateral, expectedSponsorCollateral);
  breakdown.credited = new CollateralBreakdown(adjustedCollateral, sponsorCollateral);
  breakdown.raw = new CollateralBreakdown(rawContractCollateral, rawSponsorCollateral);
  breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
  console.group(
    `** After 1 Create with ${fromWei(testConfig.amountToDeposit)} collateral (fee-multiplier = ${testConfig.expectedFeeMultiplier}): **`
  );
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice ASSERT PRECISION LOSS IN FEE MULTIPLIER
   */
  // Without precision loss, `_addCollateral()` should add (0.1 / 0.9 = 0.1...11 repeating) raw collateral to the contract 
  // but this gets floored. Therefore, the credited collateral is (1e-18 / [0.09+0.1]) ~= 5.3e-18% less than it should be.
  assert.equal(fromWei(driftTotal), "0.000000000000000001")

  /**
   * @notice POST-TEST INVARIANTS
   */
  endingStoreCollateral = await collateral.balanceOf(store.address);

  // Test 1) Make sure that store hasn't collected any fees during this test, so that we can be confident that deposits
  // are the only source of drift.
  assert.equal(startingStoreCollateral.toString(), endingStoreCollateral.toString());

  // Test 2) The fee multiplier has not changed.
  assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, testConfig.expectedFeeMultiplier);

  /**
   * @notice POST-TEST CLEANUP
   */

  // Reset store fees.
  await store.setFixedOracleFeePerSecond({ rawValue: toWei("0") }, { from: contractDeployer });

  console.groupEnd();
  /** ***************************************************************************
   *
   * END CREATE()
   *
   *****************************************************************************/

  /** ***************************************************************************
   *
   * START WITHDRAW()
   *
   *****************************************************************************/
  console.group("Precision loss due to withdraw()");
  // In order to induce precision loss on withdrawals, we will follow a similar strategy to deposit().
  // To better understand this, we need to examine how the withdraw() method is implemented:
  // - withdraw(collateral) calls the internal method _removeCollateral(collateral), which adjusts the position's collateral while taking fees into account.
  // - _removeCollateral(collateral) scales up the collateral to add: adjustedCollateral = collateral / cumulativeFeeMultiplier.
  // - This division has the potential for precision loss, which could cause the resultant rawCollateral in the position to be higher than expected.
  // - Note: here is the difference between deposit() and withdraw(): withdraw subtracts the floor'd quotient from rawCollateral so rawCollateral can be higher than expected
  // - In other words, the withdraw() will have subtracted less collateral from the position than the caller actually receives in the withdraw.
  // - We should expect to see negative "drift", because the adjusted collateral in contract will be higher than expected.

  /**
   * @notice CREATE NEW EXPERIMENT
   */
  experimentEnv = await createTestEnvironment();
  collateral = experimentEnv.collateral;
  synthetic = experimentEnv.synthetic;
  emp = experimentEnv.emp;
  store = experimentEnv.store;
  sponsor = experimentEnv.sponsor;
  contractDeployer = experimentEnv.contractDeployer;
  other = experimentEnv.other;

  /**
   * @notice TEST PARAMETERS
   */
  testConfig = {
    sponsorCollateralAmount: toWei("0.1"),
    feePerSecond: toWei("0.1"),
    expectedFeeMultiplier: 0.9, // Division by this produces precision loss, tune this.
    amountToWithdraw: toWei("0.01")
  };
  /**
   * @notice SETUP THE TEST
   */
  // 1) Create the position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create({ rawValue: testConfig.sponsorCollateralAmount }, { rawValue: toWei("100") }, { from: sponsor });
  // 2) Set fee rate per second.
  await store.setFixedOracleFeePerSecond({ rawValue: testConfig.feePerSecond }, { from: contractDeployer });  
  // 3) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1));
  // 4) Pay the fees.
  await emp.payFees();

  /**
   * @notice PRE-TEST INVARIANTS
   */
  breakdown = {};
  driftTotal = toBN(0);
  driftSponsor = toBN(0);
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  startingContractCollateral = await collateral.balanceOf(emp.address);
  startingAdjustedContractCollateral = await emp.totalPositionCollateral();
  startingStoreCollateral = await collateral.balanceOf(store.address);
  startingSponsorCollateral = await emp.getCollateral(sponsor);
  expectedSponsorCollateral = testConfig.expectedFeeMultiplier * parseFloat(testConfig.sponsorCollateralAmount.toString());
  startingRawContractCollateral = await emp.rawTotalPositionCollateral();
  startingRawSponsorCollateral = (await emp.positions(sponsor)).rawCollateral;

  // Test 1) Fee multiplier is set correctly.
  assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, testConfig.expectedFeeMultiplier);

  // Test 2) The collateral net-of-fees and collateral in contract should be equal to start.
  assert.equal(startingContractCollateral.toString(), startingAdjustedContractCollateral.toString());

  // Test 3) The sponsor has initial collateral minus fees
  assert.equal(startingSponsorCollateral.toString(), expectedSponsorCollateral.toString());

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(startingContractCollateral, expectedSponsorCollateral);
  breakdown.credited = new CollateralBreakdown(startingAdjustedContractCollateral, startingSponsorCollateral);
  breakdown.raw = new CollateralBreakdown(startingRawContractCollateral, startingRawSponsorCollateral);
  breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier, "N/A");
  console.group("** Pre-Withdrawal: Actual and Credited Collateral should be equal **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE
   */
  // Note: Must call `requestWithdrawal()` instead of `withdraw()` because we are the only position. I didn't create another
  // less-collateralized position because it would modify the total collateral and therefore the fee multiplier.
  await emp.requestWithdrawal({ rawValue: testConfig.amountToWithdraw }, { from: sponsor });
  // Move time forward. Need to set fees to 0 so as not to change the fee multiplier.
  await store.setFixedOracleFeePerSecond({ rawValue: toWei("0") }, { from: contractDeployer });
  startTime = await emp.getCurrentTime();
  // Advance time to 1 second past the withdrawal liveness.
  await emp.setCurrentTime(startTime.addn(1));
  // Execute withdrawal request.
  await emp.withdrawPassedRequest({ from: sponsor });

  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  contractCollateral = await collateral.balanceOf(emp.address);
  adjustedCollateral = await emp.totalPositionCollateral();
  sponsorCollateral = await emp.getCollateral(sponsor);
  expectedSponsorCollateral =
    parseFloat(startingSponsorCollateral.toString()) - parseFloat(testConfig.amountToWithdraw.toString());
  rawContractCollateral = await emp.rawTotalPositionCollateral();
  rawSponsorCollateral = (await emp.positions(sponsor)).rawCollateral;
  driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));
  driftSponsor = toBN(expectedSponsorCollateral).sub(toBN(sponsorCollateral.rawValue));

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(contractCollateral, expectedSponsorCollateral);
  breakdown.credited = new CollateralBreakdown(adjustedCollateral, sponsorCollateral);
  breakdown.raw = new CollateralBreakdown(rawContractCollateral, rawSponsorCollateral);
  breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
  breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier, "N/A");
  console.group(
    `** After 1 Withdrawal of ${fromWei(testConfig.amountToWithdraw)} collateral (fee-multiplier = ${testConfig.expectedFeeMultiplier}): **`
  );
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

  console.groupEnd();
  /** ***************************************************************************
   *
   * END WITHDRAW()
   *
   *****************************************************************************/

  /** ***************************************************************************
   *
   * START REDEEM()
   *
   *****************************************************************************/
  console.group("Precision loss due to redeem()");
  // Redeem() is a bit more complex because the amount of collateral released from the contract
  // is determined by the proportion of (synthetic tokens redeemed / synthetic tokens outstanding).
  // This proportion can exhibit precision loss, the product of which is multiplied by
  // the position collateral (inclusive of fees).
  // The relatively larger danger with redeem() is that we are multiplying a number with potential precision loss,
  // which magnifies the ultimate error.
  // To better understand this, we need to examine how the redeem() method is implemented:
  // - redeem(numTokens) first calculates the `fractionRedeemed` by dividing numTokens by tokens outstanding. This can have precision loss.
  // - The actual amount of collateral to pass into _removeCollateral() is `fractionRedeemed` multiplied by `_getCollateral()`.
  // - The analysis after this is similar to withdraw():
  // - _removeCollateral(collateral) scales up the collateral to add: adjustedCollateral = collateral / cumulativeFeeMultiplier.
  // - This division has the potential for precision loss, which could cause the resultant rawCollateral in the position to be higher than expected.
  // - Note: here is the difference between deposit() and withdraw(): withdraw subtracts the floor'd quotient from rawCollateral so rawCollateral can be higher than expected
  // - In other words, the redeem() will have subtracted less collateral from the position than the caller actually receives in the redemption.
  // - We should expect to see negative "drift", because the adjusted collateral in contract will be higher than expected.

  /**
   * @notice CREATE NEW EXPERIMENT
   */
  experimentEnv = await createTestEnvironment();
  collateral = experimentEnv.collateral;
  synthetic = experimentEnv.synthetic;
  emp = experimentEnv.emp;
  store = experimentEnv.store;
  sponsor = experimentEnv.sponsor;
  contractDeployer = experimentEnv.contractDeployer;

  /**
   * @notice TEST PARAMETERS
   */
  testConfig = {
    tokensOutstanding: toWei("9"),
    sponsorCollateralAmount: toWei("1100"),
    feePerSecond: toWei("0.1"),
    expectedFeeMultiplier: 0.9, // Division by this produces precision loss, tune this.
    amountToRedeem: toWei("0.01") 
  };

  /**
   * @notice SETUP THE TEST
   */
  // 1) Create position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create(
    { rawValue: testConfig.sponsorCollateralAmount },
    { rawValue: testConfig.tokensOutstanding },
    { from: sponsor }
  );
  // 2) Set fee rate per second.
  await store.setFixedOracleFeePerSecond({ rawValue: testConfig.feePerSecond }, { from: contractDeployer });
  // 3) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1));
  // 4) Pay the fees.
  await emp.payFees();
  // 5) Increase approvals to cover all redemption.
  await synthetic.approve(emp.address, toWei("999999999"), { from: sponsor });

  /**
   * @notice PRE-TEST INVARIANTS
   */
  breakdown = {};
  driftTotal = toBN(0);
  driftSponsor = toBN(0);
  tokensOutstanding = (await emp.positions(sponsor)).tokensOutstanding;
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  startingContractCollateral = await collateral.balanceOf(emp.address);
  startingAdjustedContractCollateral = await emp.totalPositionCollateral();
  startingStoreCollateral = await collateral.balanceOf(store.address);
  startingSponsorCollateral = await emp.getCollateral(sponsor);
  expectedSponsorCollateral =
    testConfig.expectedFeeMultiplier * parseFloat(testConfig.sponsorCollateralAmount.toString());
  startingRawContractCollateral = await emp.rawTotalPositionCollateral();
  startingRawSponsorCollateral = (await emp.positions(sponsor)).rawCollateral;

  // Test 1) Fee multiplier is set correctly.
  assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, testConfig.expectedFeeMultiplier);

  // Test 2) The collateral net-of-fees and collateral in contract should be equal to start.
  assert.equal(startingContractCollateral.toString(), startingAdjustedContractCollateral.toString());

  // Test 3) The sponsor has initial collateral minus fees.
  assert.equal(startingSponsorCollateral.toString(), expectedSponsorCollateral.toString());

  // Test 4) Tokens outstanding is same as tokens created.
  assert.equal(tokensOutstanding.toString(), testConfig.tokensOutstanding.toString());

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(startingContractCollateral, expectedSponsorCollateral);
  breakdown.credited = new CollateralBreakdown(startingAdjustedContractCollateral, startingSponsorCollateral);
  breakdown.raw = new CollateralBreakdown(startingRawContractCollateral, startingRawSponsorCollateral);
  breakdown.tokensOutstanding = new CollateralBreakdown(tokensOutstanding, "N/A");
  breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier, "N/A");
  console.group("** Pre-Redemption: Actual and Credited Collateral should be equal **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE
   */
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  tokensOutstanding = (await emp.positions(sponsor)).tokensOutstanding;
  await emp.redeem({ rawValue: testConfig.amountToRedeem }, { from: sponsor });
  contractCollateral = await collateral.balanceOf(emp.address);
  adjustedCollateral = await emp.totalPositionCollateral();
  sponsorCollateral = await emp.getCollateral(sponsor);
  expectedSponsorCollateral =
    parseFloat(startingSponsorCollateral.toString()) -
    (parseFloat(testConfig.amountToRedeem.toString()) / parseFloat(tokensOutstanding.toString())) *
      parseFloat(startingSponsorCollateral.toString());
  rawContractCollateral = await emp.rawTotalPositionCollateral();
  rawSponsorCollateral = (await emp.positions(sponsor)).rawCollateral;
  driftTotal = contractCollateral.sub(toBN(adjustedCollateral.rawValue));
  driftSponsor = toBN(expectedSponsorCollateral).sub(toBN(sponsorCollateral.rawValue));
  tokensOutstanding = (await emp.positions(sponsor)).tokensOutstanding;

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(contractCollateral, expectedSponsorCollateral);
  breakdown.credited = new CollateralBreakdown(adjustedCollateral, sponsorCollateral);
  breakdown.raw = new CollateralBreakdown(rawContractCollateral, rawSponsorCollateral);
  breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
  breakdown.tokensOutstanding = new CollateralBreakdown(tokensOutstanding, "N/A");
  breakdown.feeMultiplier = new CollateralBreakdown(actualFeeMultiplier, "N/A");
  console.group(
    `** After 1 Redemption of ${fromWei(testConfig.amountToRedeem)} collateral (fee-multiplier = ${testConfig.expectedFeeMultiplier}): **`
  );
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

  /**
   * @notice POST-TEST CLEANUP
   */
  // Reset store fees.
  await store.setFixedOracleFeePerSecond({ rawValue: toWei("0") }, { from: contractDeployer });

  console.groupEnd();
  /** ***************************************************************************
   *
   * END REDEEM()
   *
   *****************************************************************************/

  /** ***************************************************************************
   *
   * START LIQUIDATE()
   *
   *****************************************************************************/
  console.group("Precision loss due to partial liquidations via createLiquidation()");
  // When you partially liquidate X tokens of a position with T tokens, we liquidate X/T of the collateral.
  // - That division does a floor operation in order to represent a FixedPoint.
  // - Let's start with 9 synthetic tokens and 9 collateral.
  // - If we liquidate 3 synthetic tokens, then the "(FixedPoint) ratio" of the position that we are liquidating is 3/9 = 0.33..repeating,
  // which gets floored after 18 decimals.
  // - The amount of collateral that gets "liquidated" is equal to 9 * "ratio" which should equal 3 but it ends up being slightly less,
  // because the "ratio" is floored, and equals 2.999...97 (try multiplying 9 * 0.33 to see this).
  // - Therefore, the collateral remaining in contract according to `getCollateral` is now 9 - 2.999..97 = 6.000..3.
  // - If we liquidate 3 synthetic tokens again, then the ratio we are liquidating is 3/6 = 0.50.
  // - This means that the amount of collateral we are liquidating is 6.000...3 * 0.5 = 3.000...15 (this gets floored to 3.000...1).
  // - Therefore, the collateral remaining in the contract according to `getCollateral` is now 6.000..3 - 3.000..1 = 3.00...2.
  // - The third liquidation of 3 synthetic tokens should result in a "ratio" of 1.0, meaning that all of the remaining 3.000...2 collateral is liquidated.

  /**
   * @notice CREATE NEW EXPERIMENT
   */
  experimentEnv = await createTestEnvironment();
  collateral = experimentEnv.collateral;
  synthetic = experimentEnv.synthetic;
  emp = experimentEnv.emp;
  store = experimentEnv.store;
  sponsor = experimentEnv.sponsor;
  contractDeployer = experimentEnv.contractDeployer;

  /**
   * @notice TEST PARAMETERS
   */
  testConfig = {
    sponsorCollateralAmount: toWei("9"),
    sponsorSyntheticAmount: toWei("9"),
    collateralRatio: toWei("1.5"),
    amountToLiquidate: toWei("3")
  };

  /**
   * @notice SETUP THE TEST
   */
  // 1) Create position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create(
    { rawValue: testConfig.sponsorCollateralAmount },
    { rawValue: testConfig.sponsorSyntheticAmount },
    { from: sponsor }
  );
  // 2) Approve contract to transfer full synthetic token balance.
  await synthetic.approve(emp.address, toWei("999999999"), { from: sponsor });

  /**
   * @notice PRE-TEST INVARIANTS
   */
  breakdown = {};
  driftTotal = toBN(0);
  driftSponsor = toBN(0);
  startingContractCollateral = await emp.totalPositionCollateral();
  startingSponsorCollateral = await emp.getCollateral(sponsor);

  // Test 1) The collateral is correct.
  assert.equal(startingContractCollateral.toString(), testConfig.sponsorCollateralAmount.toString());
  assert.equal(startingSponsorCollateral.toString(), testConfig.sponsorCollateralAmount.toString());

  // Log results in a table.
  breakdown.credited = new CollateralBreakdown(startingContractCollateral, startingSponsorCollateral);
  console.group("** Pre-Liquidation: **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE
   */
  createLiquidationResult = await emp.createLiquidation(
    sponsor,
    { rawValue: testConfig.collateralRatio },
    { rawValue: testConfig.amountToLiquidate },
    { from: sponsor }
  );
  expectedRemainingCollateral = toBN(await collateral.balanceOf(emp.address)).sub(toBN(testConfig.amountToLiquidate));
  contractCollateral = await emp.totalPositionCollateral();
  sponsorCollateral = await emp.getCollateral(sponsor);
  driftTotal = toBN(expectedRemainingCollateral).sub(toBN(contractCollateral.rawValue.toString()));
  driftSponsor = toBN(expectedRemainingCollateral).sub(toBN(sponsorCollateral.rawValue.toString()));

  // Test 1) Liquidation emits correctly with slightly less collateral than expected.
  truffleAssert.eventEmitted(createLiquidationResult, "LiquidationCreated", ev => {
    return (
      ev.sponsor == sponsor,
      ev.liquidator == sponsor,
      ev.liquidationId == 0,
      ev.tokensOutstanding == testConfig.amountToLiquidate.toString(),
      ev.lockedCollateral < testConfig.amountToLiquidate.toString(), // 2.9..97 < 3
      ev.liquidatedCollateral < testConfig.amountToLiquidate.toString()
    );
  });

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(expectedRemainingCollateral, expectedRemainingCollateral);
  breakdown.credited = new CollateralBreakdown(contractCollateral, sponsorCollateral);
  breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
  console.group(`** After 1 Partial Liquidation of ${fromWei(testConfig.amountToLiquidate)} collateral: **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST TWICE
   */
  createLiquidationResult = await emp.createLiquidation(
    sponsor,
    { rawValue: testConfig.collateralRatio },
    { rawValue: testConfig.amountToLiquidate },
    { from: sponsor }
  );
  expectedRemainingCollateral = expectedRemainingCollateral.sub(toBN(testConfig.amountToLiquidate));
  contractCollateral = await emp.totalPositionCollateral();
  sponsorCollateral = await emp.getCollateral(sponsor);
  driftTotal = toBN(expectedRemainingCollateral).sub(toBN(contractCollateral.rawValue.toString()));
  driftSponsor = toBN(expectedRemainingCollateral).sub(toBN(sponsorCollateral.rawValue.toString()));

  // Test 1) Liquidation emits correctly with slightly less collateral than expected.
  truffleAssert.eventEmitted(createLiquidationResult, "LiquidationCreated", ev => {
    return (
      ev.sponsor == sponsor,
      ev.liquidator == sponsor,
      ev.liquidationId == 1,
      ev.tokensOutstanding == testConfig.amountToLiquidate.toString(),
      ev.lockedCollateral > testConfig.amountToLiquidate.toString(), // 3.000...1 > 3
      ev.liquidatedCollateral > testConfig.amountToLiquidate.toString()
    );
  });

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(expectedRemainingCollateral, expectedRemainingCollateral);
  breakdown.credited = new CollateralBreakdown(contractCollateral, sponsorCollateral);
  breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
  console.group(`** After 2 Partial Liquidations of ${fromWei(testConfig.amountToLiquidate)} collateral: **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST A THIRD TIME
   */
  createLiquidationResult = await emp.createLiquidation(
    sponsor,
    { rawValue: testConfig.collateralRatio },
    { rawValue: testConfig.amountToLiquidate },
    { from: sponsor }
  );
  expectedRemainingCollateral = expectedRemainingCollateral.sub(toBN(testConfig.amountToLiquidate));
  contractCollateral = await emp.totalPositionCollateral();
  sponsorCollateral = await emp.getCollateral(sponsor);
  driftTotal = toBN(expectedRemainingCollateral).sub(toBN(contractCollateral.rawValue.toString()));
  driftSponsor = toBN(expectedRemainingCollateral).sub(toBN(sponsorCollateral.rawValue.toString()));

  // Test 1) Liquidation emits correctly with slightly less collateral than expected.
  truffleAssert.eventEmitted(createLiquidationResult, "LiquidationCreated", ev => {
    return (
      ev.sponsor == sponsor,
      ev.liquidator == sponsor,
      ev.liquidationId == 2,
      ev.tokensOutstanding == testConfig.amountToLiquidate.toString(),
      ev.lockedCollateral > testConfig.amountToLiquidate.toString(), // 3.000...2 > 3
      ev.liquidatedCollateral > testConfig.amountToLiquidate.toString()
    );
  });

  // Log results in a table.
  breakdown.expected = new CollateralBreakdown(expectedRemainingCollateral, expectedRemainingCollateral);
  breakdown.credited = new CollateralBreakdown(contractCollateral, sponsorCollateral);
  breakdown.drift = new CollateralBreakdown(driftTotal, driftSponsor);
  console.group(`** After 3 Partial Liquidations of ${fromWei(testConfig.amountToLiquidate)} collateral: **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice POST-TEST CLEANUP
   */

  // Reset store fees.
  await store.setFixedOracleFeePerSecond({ rawValue: toWei("0") }, { from: contractDeployer });

  console.groupEnd();
  /** ***************************************************************************
   *
   * END LIQUIDATE()
   *
   *****************************************************************************/
}

run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    console.error(err);
  }
  callback();
};
// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
run.runExport = runExport;
module.exports = run;
