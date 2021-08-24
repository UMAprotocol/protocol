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
const { interfaceName } = require("@uma/common");
const { MAX_UINT_VAL } = require("@uma/common");
const unreachableDeadline = MAX_UINT_VAL;

// Contracts to test
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// Other UMA related contracts and mocks
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MarginToken = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const TokenFactory = artifacts.require("TokenFactory");
const MockOracle = artifacts.require("MockOracle");
const Timer = artifacts.require("Timer");

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
  let mockOracle;
  let finder;

  // Initial constant values
  const syntheticName = "UMA test Token";
  const syntheticSymbol = "SYNTH";
  const withdrawalLiveness = 0;
  const liquidationLiveness = 3600;
  const expirationTimestamp = Math.floor(Date.now() / 1000) + 10000;
  const priceTrackingIdentifier = utf8ToHex("TEST_IDENTIFIER");
  const collateralRequirement = toWei("1.5");
  const disputeBondPercentage = toWei("0.1");
  const sponsorDisputeRewardPercentage = toWei("0.1");
  const disputerDisputeRewardPercentage = toWei("0.1");

  // Create and mint collateral token.
  collateral = await MarginToken.new("UMA", "UMA", 18);
  await collateral.addMember(1, contractDeployer, { from: contractDeployer });
  await collateral.mint(sponsor, toWei("1000000"), { from: contractDeployer });
  await collateral.mint(other, toWei("1000000"), { from: contractDeployer });

  store = await Store.deployed();

  // Create identifier whitelist and register the price tracking ticker with it.
  identifierWhitelist = await IdentifierWhitelist.deployed();
  await identifierWhitelist.addSupportedIdentifier(priceTrackingIdentifier, { from: contractDeployer });

  // Change oracle to the mock oracle for two reasons:
  // (1) we can manually set settlement prices
  // (2) we don't need to register the contract with the Registry to request prices
  finder = await Finder.deployed();
  mockOracle = await MockOracle.new(finder.address, Timer.address);
  const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
  await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);

  // Create the instance of the emp to test against.
  // The contract expires 10k seconds in the future -> will not expire during this test case.
  const constructorParams = {
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
    disputeBondPercentage: { rawValue: disputeBondPercentage },
    sponsorDisputeRewardPercentage: { rawValue: sponsorDisputeRewardPercentage },
    disputerDisputeRewardPercentage: { rawValue: disputerDisputeRewardPercentage },
    minSponsorTokens: { rawValue: "0" },
    timerAddress: Timer.address,
  };
  emp = await ExpiringMultiParty.new(constructorParams, { from: contractDeployer });
  synthetic = await SyntheticToken.at(await emp.tokenCurrency());

  return { collateral, synthetic, emp, store, mockOracle, sponsor, contractDeployer, other };
}

/**
 * @notice Used to log experiment asset breakdown in a pretty fashion.
 * @param _total Assets belonging to contract.
 * @return {*Object} compatible with console.table()
 */
function CollateralBreakdown(_total) {
  try {
    this.totalPosition = fromWei(_total.toString());
  } catch (err) {
    this.totalPosition = _total.toString();
  }
}

/**
 * @notice Main script.
 **/
async function runExport() {
  // Empty-state contracts needed to run experiments.
  let collateral;
  let synthetic;
  let emp;
  let store;
  let mockOracle;

  // User roles.
  let contractDeployer;
  let sponsor;

  // Experiment environments.
  let experimentEnv;
  let testConfig;

  // Test variables:
  let startTime; // Contract time at start of experiment.
  // Synthetic token balances
  let tokensOutstanding;
  let sponsorTokens;
  let userTokens;
  // Collateral owned (i.e. queryable via `collateral.balanceOf()`).
  let contractCollateral;
  let sponsorCollateral;
  let userCollateral;
  // Credited collateral net of fees (i.e. queryable via `contract.totalPositionCollateral()`).
  let adjustedCollateral;
  // Scaled up collateral used by contract to track fees (i.e. queryable via `contract.rawTotalPositionCollateral()`).
  let rawContractCollateral;
  // Used to track Store collateral to calculate fees collected.
  let startingStoreCollateral;
  let endingStoreCollateral;
  let actualFeesCollected;
  // Cumulative fee multiplier used by contract to track fees. Multiplied by raw collateral to get "credited" collateral.
  let actualFeeMultiplier;
  let other;
  let expectedRemainingCollateral;

  // Misc.
  let breakdown; // Fill with CollateralBreakdown() objects for pretty printing.
  let createLiquidationResult; // Store createLiquidation event.

  /** ***************************************************************************
   *
   * START PAYFEES()
   *
   *****************************************************************************/
  // Overview:
  // - `F`: amount of fees owed by contract, computed by store
  // - `M`: cumulative fee multiplier
  // - `P`: `RC * M`, also the "profit from the corruption"
  // - Precision error in the `payFees()` method can occur when the cumulative fee multiplier specifically loses precision.
  //   After paying `F` collateral to the store, the contract sets the new cumulative fee multiplier `M_1` as:
  //   `M_1 = M * (1 - F / P)`.
  // - `F / P` is ceil'd which means that `1 - F / P` is floor'd and potentially loses 1e-18 precision.
  //   This could cause `M_1 < M * (1 - F / P)`. This is especially problematic because `M` is used whenever another method requires calculating `P`,
  //   the collateral credited to sponsors.
  // Example:
  // - P = 1
  // - F = 0.01
  // - M = 1e-17
  // - (F / P) = 0.01
  // - (1 - F/P) = 0.99
  // - M * (0.99) = 1e-17 * 0.99 = 9.9e-18 which gets floored to 9e-18, losing 0.9e-18 of precision
  // Error:
  // -1e-17 in `M` because `M` can multiply the 1e-18 precision loss coming from `(1 - F/P)`.
  console.group("Precision loss in cumulativeFeeMultiplier via payFees()");
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
    startCollateralAmount: toWei("1"),
    feeRatePerSecond: "0." + "9".repeat(17), // Used to set initial fee multiplier
    modifiedFeeRatePerSecond: "0.01", // Used to charge additional fees
    expectedFeesCollected: "9".repeat(17) + "0", // Amount of fees collected total
  };

  /**
   * @notice SETUP THE TEST
   */
  // 1) Create position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create(
    { rawValue: testConfig.startCollateralAmount.toString() },
    { rawValue: toWei("1") },
    { from: sponsor }
  );
  // 2) Set fee rate per second.
  await store.setFixedOracleFeePerSecondPerPfc(
    { rawValue: toWei(testConfig.feeRatePerSecond) },
    { from: contractDeployer }
  );
  // 3) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1), { from: contractDeployer });

  /**
   * @notice TEST INVARIANTS
   */
  startingStoreCollateral = await collateral.balanceOf(store.address);
  adjustedCollateral = await emp.getCollateral(sponsor);
  contractCollateral = await collateral.balanceOf(emp.address);
  rawContractCollateral = await emp.rawTotalPositionCollateral();
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();

  // Test 1) The adjusted and actual collateral amount is the same to start, pre-fees.
  assert.equal(adjustedCollateral.toString(), contractCollateral.toString());

  // Test 2) The store has not collected any fees.
  assert.equal(startingStoreCollateral.toString(), "0");

  // Test 3) Fee multiplier is set to default.
  assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, 1.0);

  // Test 4) Raw collateral and actual collateral amount are the same to start.
  assert.equal(rawContractCollateral.toString(), contractCollateral.toString());

  // Log results.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Collateral credited to Sponsors"] = new CollateralBreakdown(adjustedCollateral);
  breakdown["Contract raw collateral"] = new CollateralBreakdown(rawContractCollateral);
  breakdown["Cumulative Fee Multiplier"] = new CollateralBreakdown(actualFeeMultiplier);
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

  // Test 1) The correct fees are paid.
  assert.equal(testConfig.expectedFeesCollected, actualFeesCollected.toString());

  // Log results.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Collateral credited to Sponsors"] = new CollateralBreakdown(adjustedCollateral);
  breakdown["Contract raw collateral"] = new CollateralBreakdown(rawContractCollateral);
  breakdown["Cumulative Fee Multiplier"] = new CollateralBreakdown(actualFeeMultiplier);
  console.group(
    `** Collateral After Charging ${testConfig.feeRatePerSecond} in Fees (${fromWei(
      actualFeesCollected.toString()
    )} total fees collected) **`
  );
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice SET ANOTHER FEE RATE AND PRODUCE PRECISION LOSS IN THE FEE MULTIPLIER
   */
  // 0) Deposit more collateral into the contract so that there is enough collateral to charge fees correctly
  // without precision loss
  console.log(`** Depositing another ${fromWei(testConfig.expectedFeesCollected)} **`);
  await emp.deposit({ rawValue: testConfig.expectedFeesCollected }, { from: sponsor });
  // 1) Set fee rate per second.
  await store.setFixedOracleFeePerSecondPerPfc(
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

  // Test 1) The correct fees are paid.
  testConfig.expectedFeesCollected = toBN(testConfig.expectedFeesCollected)
    .add(toBN(toWei("0.01")))
    .toString();
  assert.equal(testConfig.expectedFeesCollected, actualFeesCollected.toString());

  // Log results.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Collateral credited to Sponsors"] = new CollateralBreakdown(adjustedCollateral);
  breakdown["Contract raw collateral"] = new CollateralBreakdown(rawContractCollateral);
  breakdown["Cumulative Fee Multiplier"] = new CollateralBreakdown(actualFeeMultiplier);
  console.group(
    `** Collateral After Charging ${testConfig.modifiedFeeRatePerSecond} in Fees (${fromWei(
      actualFeesCollected.toString()
    )} total fees collected) **`
  );
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice POST-TEST CLEANUP
   */

  // Reset store fees.
  await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0") }, { from: contractDeployer });

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
  // Overview:
  // - Deposits can cause precision loss in the "raw" collateral amount, independent of any precision loss in the cumulative fee multiplier.
  // - Deposits transfer user collateral to the contract and simultaneously call the internal method _addCollateral, which can cause the "raw"
  //   collateral amount (which accounts for fees) to reflect less collateral added to the contract than the user transferred.
  // End result:
  // - "raw" collateral could be 1e-18 lower than it should be. The "raw" precision loss adds over time.
  // Explanation:
  // - In order to induce precision loss on deposits, we want to indirectly set the "cumulativeFeeMultiplier"
  //   to a value that when divided by some amount cannot be represented fully by the Fixed Point structure.
  // - deposit(collateral) calls the internal method _addCollateral(collateral).
  // - _addCollateral(collateral) scales up the collateral to add: adjustedCollateral = collateral / cumulativeFeeMultiplier.
  // - adjustedCollateral is added to rawCollateral.
  // - The division has the potential for precision loss, makes adjustedCollateral lose 1e-18 of precision.
  // - rawCollateral is lower by 1e-18
  // Example: We send collateral to the contract for a deposit.
  // - cumulativeFeeMultiplier = 0.3
  // - amountToDeposit = 1e-18
  // - adjustedCollateral = (1e-18 / 0.3 = 3.33e-18 repeating), which gets floored to 3e-18
  // - So, the sponsor deposits 1e-18 collateral to the contract, and the contract credits 3e-18 rawCollateral to the sponsor
  // - Recall that (rawCollateral * feeMultiplier) should be equal to collateral, but (3e-18 * 0.3 < 1e-18)
  //   and we can't represent 3.33e-18 repeating in FixedPoint (3.33e-18 repeating * 0.3 == 1e-18)

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

  console.group("Precision loss in rawCollateralAmount via deposit()");

  /**
   * @notice TEST PARAMETERS
   */
  testConfig = {
    sponsorCollateralAmount: toWei("0.1"),
    expectedFeeMultiplier: toWei("0.3"), // Division by this produces precision loss, tune this.
    feePerSecond: toWei("0.7"),
    amountToDeposit: "1",
  };

  /**
   * @notice SETUP THE TEST
   */
  // 1) Create position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create({ rawValue: testConfig.sponsorCollateralAmount }, { rawValue: toWei("100") }, { from: sponsor });
  // 2) Set fee rate per second.
  await store.setFixedOracleFeePerSecondPerPfc({ rawValue: testConfig.feePerSecond }, { from: contractDeployer });
  // 3) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1));
  // 4) Pay the fees.
  await emp.payFees({ from: sponsor });

  /**
   * @notice PRE-TEST INVARIANTS
   */
  breakdown = {};
  startingStoreCollateral = await collateral.balanceOf(store.address);
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  contractCollateral = await collateral.balanceOf(emp.address);
  adjustedCollateral = await emp.totalPositionCollateral();
  rawContractCollateral = await emp.rawTotalPositionCollateral();

  // Test 1) Fee multiplier is set correctly.
  assert.equal(actualFeeMultiplier.toString(), testConfig.expectedFeeMultiplier);

  // Test 2) The collateral net-of-fees and collateral in contract should be equal to start.
  assert.equal(contractCollateral.toString(), adjustedCollateral.toString());

  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Collateral credited to Sponsors"] = new CollateralBreakdown(adjustedCollateral);
  breakdown["Contract raw collateral"] = new CollateralBreakdown(rawContractCollateral);
  breakdown["Cumulative Fee Multiplier"] = new CollateralBreakdown(actualFeeMultiplier);
  console.group("** Pre-Deposit: Actual and Credited Collateral should be equal **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE
   */
  await emp.deposit({ rawValue: testConfig.amountToDeposit }, { from: sponsor });
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  contractCollateral = await collateral.balanceOf(emp.address);
  adjustedCollateral = await emp.totalPositionCollateral();
  rawContractCollateral = await emp.rawTotalPositionCollateral();

  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Collateral credited to Sponsors"] = new CollateralBreakdown(adjustedCollateral);
  breakdown["Contract raw collateral"] = new CollateralBreakdown(rawContractCollateral);
  breakdown["Cumulative Fee Multiplier"] = new CollateralBreakdown(actualFeeMultiplier);
  console.group(`** After 1 Deposit of ${fromWei(testConfig.amountToDeposit)} collateral: **`);
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
  assert.equal(actualFeeMultiplier.toString(), testConfig.expectedFeeMultiplier);

  /**
   * @notice POST-TEST CLEANUP
   */

  // Reset store fees.
  await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0") }, { from: contractDeployer });

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
  // The precision loss mechanic is identical to deposit().
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
  // Overview:
  // - Withdraws perform the same intermediate calculations as deposits, but it subtracts the adjustedCollateral
  //   from the rawCollateral: rawCollateral -= adjustedCollateral, and adjustedCollateral = (collateral / cumulativeFeeMultiplier)
  // - Therefore, rawCollateral could be greater by 1e-18 than it should be
  // - This would be a problem as the collateral owned by the contract could be lower than (totalPositionCollateral = rawCollateral * feeMultiplier),
  //   so we counter this by removing from the contract the exact amount that `totalPositionCollateral` is decreased by.
  // Example: User wants to withdraw 1e-18 collateral, in this test we'll show how `totalPositionCollateral` drifts higher and higher away from `collateral`.
  // - cumulativeFeeMultiplier = 0.3
  // - amountToWithdraw = 1e-18
  // - adjustedCollateral = (1e-18 / 0.3 = 3.33e-18 repeating), which gets floored to 3e-18
  // - So, the sponsor expects to receive 1e-18 collateral from the contract, but the contract debits 3e-18 rawCollateral from the sponsor
  // - Recall that (rawCollateral * feeMultiplier) should be equal to collateral, but (3e-18 * 0.3 < 1e-18)
  //   and we can't represent 3.33e-18 repeating in FixedPoint (3.33e-18 repeating * 0.3 == 1e-18)
  // - So rawCollateral, which starts at 1, is decreased by 3e-18, but ideally it should have been decreased by 3.33e-18 repeating
  // - i.e. rawCollateral becomes 0.999999999999999997 but should be 0.9999999999999999967 <-- this has 19 digits,
  // - Let's check how much `totalPositionCollateral` is decreased by:
  //        before the `withdraw()`, `totalPositionCollateral = 1 * 0.3 = 0.3`
  //        after the `withdraw()`, `totalPositionCollateral = 0.999999999999999997 * 0.3 = 0.2999999999999999991` which truncates the last decimal
  // - So, this is as expected: `totalPositionCollateral` is decreased by 1e-18, so we can transfer 1e-18 to the user. However, what has really happened is that
  //   `totalPositionCollateral` is 0.1e-18 higher than `collateral`. Each withdraw increases this error, which only becomes visible after the tenth withdrawal.
  // - Let's look at the second `withdraw()`
  //        before the second `withdraw()`, `totalPositionCollateral = 0.299999999999999999`
  //        after the second `withdraw()`, `totalPositionCollateral = 0.999999999999999994 * 0.3 = 0.2999999999999999982` which truncates the last decimal
  // - Again, this is as expected: `totalPositionCollateral` is decreased by 1e-18, so we can transfer 1e-18 to the user
  // - In fact, the error does not emerge until the tenth `withdraw`. After the ninth withdraw, `rawCollateral = 0.999999999999999973` (1 - 9 * 3e-18),
  //        before the tenth `withdraw()`, `totalPositionCollateral = 0.999999999999999973 * 0.3 = 0.2999999999999999919`
  //        after the tenth `withdraw()`, `totalPositionCollateral = 0.9999999999999999970 * 0.3 = 0.2999999999999999910` which truncates the last decimal
  // - So, this is unexpected: `totalPositionCollateral` will show no decrease. After each withdrawal, `totalPositionCollateral` decreases by 0.9e-18 instead of the full
  //   1e-18, and 1e-18 of error appears after the tenth withdrawal.
  // - The contract does not want to have `totalPositionCollateral` return a value larger than `collateral` actually owned by the contract, so
  //   because it does not see that `totalPositionCollateral` has changed after the tenth withdrawal, it will return the user 0 after a withdraw.
  //   This will reset the error back to 0..
  // - If the contract instead withdrew 1e-18 collateral to the user, the contract would own `0.299999999999999990` collateral but its `totalPositionCollateral` would be
  //   `0.299999999999999991`. This could be a problem for example if the user then tried to `redeem` 100% of the outstanding tokens. The contract
  //   would attempt to transfer `0.299999999999999991` collateral but the contract would revert due to insufficient balance.

  console.group("No precision loss in rawCollateralAmount via withdraw()");

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
    sponsorCollateralAmount: toWei("1"),
    feePerSecond: toWei("0.7"),
    expectedFeeMultiplier: toWei("0.3"), // Division by this produces precision loss, tune this.
    amountToWithdraw: "1",
  };

  /**
   * @notice SETUP THE TEST
   */
  // 1) Create the position.
  await collateral.approve(emp.address, toWei("999999999"), { from: sponsor });
  await emp.create({ rawValue: testConfig.sponsorCollateralAmount }, { rawValue: toWei("100") }, { from: sponsor });
  // 2) Set fee rate per second.
  await store.setFixedOracleFeePerSecondPerPfc({ rawValue: testConfig.feePerSecond }, { from: contractDeployer });
  // 3) Move time in the contract forward by 1 second to capture unit fee.
  startTime = await emp.getCurrentTime();
  await emp.setCurrentTime(startTime.addn(1));
  // 4) Pay the fees.
  await emp.payRegularFees();

  /**
   * @notice PRE-TEST INVARIANTS
   */
  breakdown = {};
  startingStoreCollateral = await collateral.balanceOf(store.address);
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  contractCollateral = await collateral.balanceOf(emp.address);
  sponsorCollateral = await collateral.balanceOf(sponsor);
  adjustedCollateral = await emp.totalPositionCollateral();
  rawContractCollateral = await emp.rawTotalPositionCollateral();

  // Test 1) Fee multiplier is set correctly.
  assert.equal(actualFeeMultiplier.toString(), testConfig.expectedFeeMultiplier);

  // Test 2) The collateral net-of-fees and collateral in contract should be equal to start.
  assert.equal(contractCollateral.toString(), adjustedCollateral.toString());

  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Collateral owned by Sponsor"] = new CollateralBreakdown(sponsorCollateral);
  breakdown["Collateral credited to Sponsors"] = new CollateralBreakdown(adjustedCollateral);
  breakdown["Contract raw collateral"] = new CollateralBreakdown(rawContractCollateral);
  breakdown["Cumulative Fee Multiplier"] = new CollateralBreakdown(actualFeeMultiplier);
  console.group("** Pre-Withdrawal: Actual and Credited Collateral should be equal **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST TEN TIMES
   */
  // Need to set fees to 0 so as not to change the fee multiplier.
  await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0") }, { from: contractDeployer });
  for (let i = 0; i < 10; i++) {
    // Note: Must call `requestWithdrawal()` instead of `withdraw()` because we are the only position. I didn't create another
    // less-collateralized position because it would modify the total collateral and therefore the fee multiplier.
    await emp.requestWithdrawal({ rawValue: testConfig.amountToWithdraw }, { from: sponsor });
    // Execute withdrawal request.
    await emp.withdrawPassedRequest({ from: sponsor });
  }
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  contractCollateral = await collateral.balanceOf(emp.address);
  sponsorCollateral = await collateral.balanceOf(sponsor);
  adjustedCollateral = await emp.totalPositionCollateral();
  rawContractCollateral = await emp.rawTotalPositionCollateral();

  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Collateral owned by Sponsor"] = new CollateralBreakdown(sponsorCollateral);
  breakdown["Collateral credited to Sponsors"] = new CollateralBreakdown(adjustedCollateral);
  breakdown["Contract raw collateral"] = new CollateralBreakdown(rawContractCollateral);
  breakdown["Cumulative Fee Multiplier"] = new CollateralBreakdown(actualFeeMultiplier);
  console.group(`** After 10 Withdrawals of ${fromWei(testConfig.amountToWithdraw)} collateral: **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice CAN REDEEM 100% OF TOKENS
   * !!This would redeem would revert if you change the amount that `withdrawPassedRequest` transfers via `collateralCurrency.safeTransfer`
   * from `amountWithdrawn` to `amountToWithdraw`!!
   */
  await synthetic.approve(emp.address, toWei("100"), { from: sponsor });
  await emp.redeem({ rawValue: toWei("100") }, { from: sponsor });
  actualFeeMultiplier = await emp.cumulativeFeeMultiplier();
  contractCollateral = await collateral.balanceOf(emp.address);
  sponsorCollateral = await collateral.balanceOf(sponsor);
  adjustedCollateral = await emp.totalPositionCollateral();
  rawContractCollateral = await emp.rawTotalPositionCollateral();
  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Collateral owned by Sponsor"] = new CollateralBreakdown(sponsorCollateral);
  breakdown["Collateral credited to Sponsors"] = new CollateralBreakdown(adjustedCollateral);
  breakdown["Contract raw collateral"] = new CollateralBreakdown(rawContractCollateral);
  breakdown["Cumulative Fee Multiplier"] = new CollateralBreakdown(actualFeeMultiplier);
  console.group("** After Redeeming 100% of Synthetic Tokens: **");
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
  assert.equal(actualFeeMultiplier.toString(), testConfig.expectedFeeMultiplier);

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
  // Overview:
  // - `T` = Contract's synthetic tokens outstanding
  // - `RC` = raw collateral
  // - `M` = fee multiplier
  // - `C` = Collateral credited to sponsors `(RC * M)`
  // - Redeems have two sources of precision loss:
  //   (1) The user burns S synthetic tokens and should receive `(S / T) * C = c` collateral tokens.
  //       It is possible that `(S / T)` gets floored, loses 1e-18 of precision, and is then multiplied by C,
  //       therefore the proportion of collateral returned is less than the synthetic burned: `(C - c)/C < (T-S)/T`.
  //   (2) Identically to a withdraw, `c` collateral is sent from the contract to the user,
  //       while `(c / M)` raw collateral is removed from `RC`. `(c / M)` is floored and therefore
  //       the contract loses more collateral than it debits from sponsors: `(RC - c/M) * M > (C - c)`. We intentionally
  //       deal with this error in the raw collateral the same way we would with a `withdraw`, so we won't demonstrate
  //       this error in this test.
  // Example of (1):
  // - M = cumulativeFeeMultiplier = 1
  // - RC = rawCollateral = 9
  // - T = tokensOutstanding = 9
  // - S = amountToRedeem = 8
  // - (S / T) = 0.888...repeating and gets floored to 0.888...88
  // - (S / T) * (RC * M) = 7.999...92, instead of 8
  // - So, the user burns 8 synthetic but receives 7.999...92 collateral, representing 8e-18 less than they were expecting.
  // Error Amount:
  // - (-1e-17) in `c` if `(S / T)` has -1e-18 error and is then multiplied by C's least significant decimal

  console.group("Precision loss in % of collateral redeemed via redeem()");

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
  testConfig = { tokensOutstanding: toWei("9"), sponsorCollateralAmount: toWei("9"), amountToRedeem: toWei("8") };

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
  // 2) Increase approvals to cover all redemption.
  await synthetic.approve(emp.address, toWei("999999999"), { from: sponsor });

  /**
   * @notice PRE-TEST INVARIANTS
   */
  breakdown = {};
  tokensOutstanding = (await emp.positions(sponsor)).tokensOutstanding;
  contractCollateral = await collateral.balanceOf(emp.address);

  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Sponsor tokens outstanding"] = new CollateralBreakdown(tokensOutstanding);
  console.group("** Pre-Redemption: Starting Collateral and Synthetic amounts **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE
   */
  await emp.redeem({ rawValue: testConfig.amountToRedeem }, { from: sponsor });
  tokensOutstanding = (await emp.positions(sponsor)).tokensOutstanding;
  contractCollateral = await collateral.balanceOf(emp.address);

  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Sponsor tokens outstanding"] = new CollateralBreakdown(tokensOutstanding);
  console.group(`** After 1 Redemption of ${fromWei(testConfig.amountToRedeem)} collateral: **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice POST-TEST CLEANUP
   */

  console.groupEnd();
  /** ***************************************************************************
   *
   * END REDEEM()
   *
   *****************************************************************************/

  /** ***************************************************************************
   *
   * START SETTLE_EXPIRED()
   *
   *****************************************************************************/
  // Overview:
  // - `T` = Contract's synthetic tokens outstanding
  // - `RC` = raw collateral
  // - `M` = fee multiplier
  // - `C` = Collateral credited to sponsors `(RC * M)`
  // - `E` = Settlement price (amount of collateral that each synthetic can be redeemed for)
  // - Settlements at Expiry have two sources of precision loss:
  //   (1) The user burns S synthetic tokens and should receive `S * E = c` collateral tokens.
  //       It is possible that `S * E` gets floored and loses 1e-18 of precision,
  //       therefore the proportion of collateral returned is less than the synthetic burned: `(C - c)/C < (T-S)/T`.
  //   (2) Identically to a withdraw, `c` collateral is sent from the contract to the user,
  //       while `(c / M)` raw collateral is removed from `RC`. `(c / M)` is floored and therefore
  //       the contract loses more collateral than it debits from sponsors: `(RC - c/M) * M > (C - c)`. We intentionally
  //       deal with this error in the raw collateral the same way we would with a `withdraw`, so we won't demonstrate
  //       this error in this test.
  // Example for (1):
  // - M = cumulativeFeeMultiplier = 1
  // - RC = rawCollateral = 1e-18
  // - T = tokensOutstanding = 1e-18
  // - S = synthetic balance to settle = 1e-18
  // - E = settlement price (collateral per synthetic) = 0.5
  // - (S * E) = 0.5e-18, which gets floored to 0
  // - So, the user burns 1e-18 synthetic but receives 0 collateral, representing 0.5e-18 less than they were expecting.
  // Error Amount:
  // - (-1e-18) in `c` if `(S * E)` has -1e-18 error

  console.group("Precision loss in % of collateral redeemed via settleExpired()");

  /**
   * @notice CREATE NEW EXPERIMENT
   */
  experimentEnv = await createTestEnvironment();
  collateral = experimentEnv.collateral;
  synthetic = experimentEnv.synthetic;
  emp = experimentEnv.emp;
  store = experimentEnv.store;
  sponsor = experimentEnv.sponsor;
  other = experimentEnv.other;
  contractDeployer = experimentEnv.contractDeployer;
  mockOracle = experimentEnv.mockOracle;

  /**
   * @notice TEST PARAMETERS
   */
  testConfig = {
    tokensOutstanding: "1",
    amountToSettle: "1",
    sponsorCollateralAmount: "1",
    settlementPrice: toWei("0.5"), // Collateral per Synthetic
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
  // 2) Increase approvals to cover all redemption.
  await synthetic.approve(emp.address, toWei("999999999"), { from: sponsor });
  await synthetic.approve(emp.address, toWei("999999999"), { from: other });
  // 3) Send tokens to another user to settle at expiry.
  await synthetic.transfer(other, testConfig.amountToSettle, { from: sponsor });

  /**
   * @notice PRE-TEST INVARIANTS
   */
  breakdown = {};
  tokensOutstanding = await emp.totalTokensOutstanding();
  userTokens = await synthetic.balanceOf(other);
  userCollateral = await collateral.balanceOf(other);
  sponsorTokens = await synthetic.balanceOf(sponsor);
  sponsorCollateral = await collateral.balanceOf(sponsor);
  contractCollateral = await collateral.balanceOf(emp.address);

  // Advance time to expiry
  const expirationTime = (await emp.expirationTimestamp()).toString();
  await emp.setCurrentTime(expirationTime);
  // Expire the contract and pay any final fees
  await emp.expire();
  // Push a price
  await mockOracle.pushPrice(utf8ToHex("TEST_IDENTIFIER"), expirationTime, testConfig.settlementPrice.toString());

  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Total position tokens outstanding"] = new CollateralBreakdown(tokensOutstanding);
  breakdown["Non-Sponsor token balance"] = new CollateralBreakdown(userTokens);
  breakdown["Non-Sponsor collateral balance"] = new CollateralBreakdown(userCollateral);
  breakdown["Sponsor token balance"] = new CollateralBreakdown(sponsorTokens);
  breakdown["Sponsor collateral balance"] = new CollateralBreakdown(sponsorCollateral);
  console.group(
    `** Position expires, settlement price is ${fromWei(
      testConfig.settlementPrice
    )}: Actual and Credited Collateral should be equal **`
  );
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice NON-SPONSOR SETTLES
   */
  await emp.settleExpired({ from: other });
  contractCollateral = await collateral.balanceOf(emp.address);
  tokensOutstanding = await emp.totalTokensOutstanding();
  userTokens = await synthetic.balanceOf(other);
  userCollateral = await collateral.balanceOf(other);
  sponsorTokens = await synthetic.balanceOf(sponsor);
  sponsorCollateral = await collateral.balanceOf(sponsor);

  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Total position tokens outstanding"] = new CollateralBreakdown(tokensOutstanding);
  breakdown["Non-Sponsor token balance"] = new CollateralBreakdown(userTokens);
  breakdown["Non-Sponsor collateral balance"] = new CollateralBreakdown(userCollateral);
  breakdown["Sponsor token balance"] = new CollateralBreakdown(sponsorTokens);
  breakdown["Sponsor collateral balance"] = new CollateralBreakdown(sponsorCollateral);
  console.group("** After a Non-Sponsor settles their full synthetic balance: **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice SPONSOR SETTLES
   */
  await emp.settleExpired({ from: sponsor });
  contractCollateral = await collateral.balanceOf(emp.address);
  tokensOutstanding = await emp.totalTokensOutstanding();
  userTokens = await synthetic.balanceOf(other);
  userCollateral = await collateral.balanceOf(other);
  sponsorTokens = await synthetic.balanceOf(sponsor);
  sponsorCollateral = await collateral.balanceOf(sponsor);

  // Log results in a table.
  breakdown["Collateral owned by Contract"] = new CollateralBreakdown(contractCollateral);
  breakdown["Total position tokens outstanding"] = new CollateralBreakdown(tokensOutstanding);
  breakdown["Non-Sponsor token balance"] = new CollateralBreakdown(userTokens);
  breakdown["Non-Sponsor collateral balance"] = new CollateralBreakdown(userCollateral);
  breakdown["Sponsor token balance"] = new CollateralBreakdown(sponsorTokens);
  breakdown["Sponsor collateral balance"] = new CollateralBreakdown(sponsorCollateral);
  console.group("** After the Sponsor settles their full synthetic balance: **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice POST-TEST CLEANUP
   */

  console.groupEnd();
  /** ***************************************************************************
   *
   * END SETTLE_EXPIRED()
   *
   *****************************************************************************/

  /** ***************************************************************************
   *
   * START LIQUIDATE()
   *
   *****************************************************************************/
  console.group("Precision in % of collateral removed via createLiquidation()");
  // Overview:
  // - `T` = Contract's synthetic tokens outstanding
  // - `RC` = raw collateral
  // - `M` = fee multiplier
  // - `C` = Collateral credited to sponsors `(RC * M)`
  // - Partial liquidations have the same source of precision loss as redemptions:
  //   (1) The user liquidates S synthetic tokens and should receive `(S / T) * C = c` collateral tokens.
  //       It is possible that `(S / T)` gets floored, loses 1e-18 of precision, and is then multiplied by C,
  //       therefore the proportion of collateral returned is less than the synthetic burned: `(C - c)/C < (T-S)/T`.
  //   (2) Identically to a withdraw, `c` collateral is sent from the contract to the user,
  //       while `(c / M)` raw collateral is removed from `RC`. `(c / M)` is floored and therefore
  //       the contract loses more collateral than it debits from sponsors: `(RC - c/M) * M > (C - c)`.
  // Example of (1):
  // - T = 9
  // - RC = 9
  // - M = 1
  // - C = (9 * 1) = 9
  // - S = 3
  // - (S / T) = 0.333...repeating, which gets floored to 0.333...3, showing a loss of 1e-18
  // - We remove (S / T) * C = 2.999...97 collateral from the contract, but we should have removed 3 collateral, showing a loss of 3e-18
  // - If we liquidate 3 synthetic tokens again, then the ratio we are liquidating is 3/6 = 0.50.
  // - This means that the amount of collateral we are liquidating is (9 - 2.999...97) * 0.5 = 3.000...15 (this gets floored to 3.000...1).
  // - Therefore, the collateral remaining in the contract according to `getCollateral` is now 6.000..3 - 3.000..1 = 3.00...2.
  // - The third liquidation of 3 synthetic tokens should result in a "ratio" of 1.0, meaning that all of the remaining 3.000...2 collateral is liquidated.
  // Error Amount:
  // -1e-17 in `c` if `(S / T)` has -1e-18 error and is then multiplied by C's least significant decimal
  // +1e-18 in `RC` for the same reason as in a withdraw.

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
    amountToLiquidate: toWei("3"),
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
  contractCollateral = await emp.totalPositionCollateral();

  // Test 1) The collateral is correct.
  assert.equal(contractCollateral.toString(), testConfig.sponsorCollateralAmount.toString());

  // Log results in a table.
  breakdown["Actual collateral"] = new CollateralBreakdown(contractCollateral);
  console.group("** Collateral Amounts Pre-Liquidation: **");
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST ONCE
   */
  createLiquidationResult = await emp.createLiquidation(
    sponsor,
    { rawValue: "0" },
    { rawValue: testConfig.collateralRatio },
    { rawValue: testConfig.amountToLiquidate },
    unreachableDeadline,
    { from: sponsor }
  );
  expectedRemainingCollateral = toBN(await collateral.balanceOf(emp.address)).sub(toBN(testConfig.amountToLiquidate));
  contractCollateral = await emp.totalPositionCollateral();

  // Test 1) Liquidation emits correctly with slightly less collateral than expected.
  truffleAssert.eventEmitted(createLiquidationResult, "LiquidationCreated", (ev) => {
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
  breakdown["Expected collateral"] = new CollateralBreakdown(expectedRemainingCollateral);
  breakdown["Actual collateral"] = new CollateralBreakdown(contractCollateral);
  console.group(`** After 1 Partial Liquidation of ${fromWei(testConfig.amountToLiquidate)} collateral: **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST TWICE
   */
  createLiquidationResult = await emp.createLiquidation(
    sponsor,
    { rawValue: "0" },
    { rawValue: testConfig.collateralRatio },
    { rawValue: testConfig.amountToLiquidate },
    unreachableDeadline,
    { from: sponsor }
  );
  expectedRemainingCollateral = expectedRemainingCollateral.sub(toBN(testConfig.amountToLiquidate));
  contractCollateral = await emp.totalPositionCollateral();

  // Test 1) Liquidation emits correctly with slightly less collateral than expected.
  truffleAssert.eventEmitted(createLiquidationResult, "LiquidationCreated", (ev) => {
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
  breakdown["Expected collateral"] = new CollateralBreakdown(expectedRemainingCollateral);
  breakdown["Actual collateral"] = new CollateralBreakdown(contractCollateral);
  console.group(`** After 2 Partial Liquidations of ${fromWei(testConfig.amountToLiquidate)} collateral: **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice RUN THE TEST A THIRD TIME
   */
  createLiquidationResult = await emp.createLiquidation(
    sponsor,
    { rawValue: "0" },
    { rawValue: testConfig.collateralRatio },
    { rawValue: testConfig.amountToLiquidate },
    unreachableDeadline,
    { from: sponsor }
  );
  expectedRemainingCollateral = expectedRemainingCollateral.sub(toBN(testConfig.amountToLiquidate));
  contractCollateral = await emp.totalPositionCollateral();

  // Test 1) Liquidation emits correctly with slightly less collateral than expected.
  truffleAssert.eventEmitted(createLiquidationResult, "LiquidationCreated", (ev) => {
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
  breakdown["Expected collateral"] = new CollateralBreakdown(expectedRemainingCollateral);
  breakdown["Actual collateral"] = new CollateralBreakdown(contractCollateral);
  console.group(`** After 3 Partial Liquidations of ${fromWei(testConfig.amountToLiquidate)} collateral: **`);
  console.table(breakdown);
  console.groupEnd();

  /**
   * @notice POST-TEST CLEANUP
   */

  // Reset store fees.
  await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0") }, { from: contractDeployer });

  console.groupEnd();
  /** ***************************************************************************
   *
   * END LIQUIDATE()
   *
   *****************************************************************************/
}

const run = async function (callback) {
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
