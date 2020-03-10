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
  const withdrawalLiveness = 1000;
  const expirationTimestamp = Math.floor(Date.now() / 1000) + 10000;
  const siphonDelay = 100000;
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
      siphonDelay, // __siphonDelay
      collateral.address, // _collateralAddress
      Finder.address, // _finderAddress
      priceTrackingIdentifier, // _priceFeedIdentifier
      syntheticName, // _syntheticName
      syntheticSymbol, // _syntheticSymbol
      { from: contractDeployer }
    );
  });

  it("Precision loss due to basic fees", async function() {
    // Here, we choose a collateral amount that will produce one rounding error on the first run:
    // - Collateral = 9,000,000 wei.
    // - 0.0000004% fees per second * 1 second * 9,000,000 wei collateral = 3.5 wei fees, however this gets floored by `Store.computeFee()` to 3 wei fees.
    // - Fees paid as % of collateral = 3e-18 / 9000000-18 = 0.0000003...33 repeating, which cannot be represented by FixedPoint.
    // - The least significant digit will get ceil'd up from 3 to 4.
    // - This causes the adjustment multiplier applied to the collateral (1 - fee %) to be slightly lower.
    // - Ultimately this decreases the available collateral returned by `FeePayer._getCollateral()`.
    // - This produces drift between _getCollateral() and the actual collateral in the contract (`collateral.balanceOf(contract)`).

    /**
     * @notice TEST PARAMETERS
     */
    const startCollateralAmount = 9000000;
    const startTokenAmount = 1;
    const feeRatePerSecond = "0.0000004";
    const expectedFeesCollectedPerPeriod = 3;
    const runs = 50;

    /**
     * @notice INSTANTIATE TEST VARIABLES
     */
    let drift = toBN(0); // Precision loss on collateral.
    let adjustedCollateralAmount; // Amount of collateral returned by `contract.getCollateral()`
    let actualCollateralAmount; // Actual collateral owned by contract (there is only one sponsor, so we can check this via `token.balanceOf()`).
    let endingStoreBalance; // Collateral owned by Store during the test, used to calculate fees collected.
    let actualFeesCollected; // Delta between starting store balance and ending store balance.

    /**
     * @notice SETUP THE TEST
     */
    // 1) Create position.
    await collateral.approve(pricelessPositionManager.address, startCollateralAmount.toString(), { from: sponsor });
    await pricelessPositionManager.create(
      { rawValue: startCollateralAmount.toString() },
      { rawValue: startTokenAmount.toString() },
      { from: sponsor }
    );
    // 2) Set fee rate per second.
    await store.setFixedOracleFeePerSecond({ rawValue: toWei(feeRatePerSecond) });
    // 3) Move time in the contract forward by 1 second to capture unit fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));

    /**
     * @notice TEST INVARIANTS
     */
    const startingStoreBalance = await collateral.balanceOf(store.address);
    adjustedCollateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    actualCollateralAmount = await collateral.balanceOf(pricelessPositionManager.address);

    // Test 1) The adjusted and actual collateral amount is the same to start, pre-fees.
    assert.equal(adjustedCollateralAmount.toString(), actualCollateralAmount.toString());
    console.group("** Pre-Fees: **");
    console.log("- Store Collateral:", startingStoreBalance.toString());
    console.log("- Adjusted Collateral (returned by contract.getCollateral()):", adjustedCollateralAmount.toString());
    console.log("- Actual Collateral (returned by token.balanceOf()):", actualCollateralAmount.toString());
    console.groupEnd();

    /**
     * @notice RUN THE TEST ONCE AND PRODUCE KNOWN DRIFT
     */
    await pricelessPositionManager.payFees();
    endingStoreBalance = await collateral.balanceOf(store.address);
    actualFeesCollected = endingStoreBalance.sub(startingStoreBalance).toString();
    adjustedCollateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    actualCollateralAmount = await collateral.balanceOf(pricelessPositionManager.address);
    drift = actualCollateralAmount.sub(toBN(adjustedCollateralAmount.rawValue));

    // Test 1) The correct fees are paid are regardless of precision loss.
    assert.equal(expectedFeesCollectedPerPeriod.toString(), actualFeesCollected.toString());

    // Test 2) Due to the precision error mentioned above, `getCollateral()` should return
    // slightly less than what we are expecting.
    assert(drift.gt(toBN(0)));
    console.group("** After 1 second: **");
    console.log("- Fees collected: ", actualFeesCollected.toString());
    console.log("- Sponsor's credited collateral returned by getCollateral(): ", adjustedCollateralAmount.toString());
    console.log("- Collateral owned by contract:", actualCollateralAmount.toString());
    console.log("- Drift:", parseFloat(drift.toString()) / 1e18);
    console.groupEnd();

    /**
     * @notice RUN THE REMAINDER OF THE TEST AND CHECK UNKNOWN DRIFT
     * @dev For all of these runs, the expected fees collected per second should still be floor'd to 4 wei.
     * @dev Since we are no longer dividing by 9,000,000 in an intermediate calculation, it is not obvious that more
     * rounding errors will occur.
     */
    for (let i = 1; i <= runs - 1; i++) {
      await pricelessPositionManager.setCurrentTime(startTime.addn(1 + i));
      await pricelessPositionManager.payFees();
    }
    endingStoreBalance = await collateral.balanceOf(store.address);
    actualFeesCollected = endingStoreBalance.sub(startingStoreBalance).toString();
    adjustedCollateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    actualCollateralAmount = await collateral.balanceOf(pricelessPositionManager.address);
    drift = actualCollateralAmount.sub(toBN(adjustedCollateralAmount.rawValue));

    // Test 1) The correct fees are paid are regardless of precision loss.
    assert.equal((expectedFeesCollectedPerPeriod * runs).toString(), actualFeesCollected.toString());

    // Test 2) Let's check if there is more drift.
    console.group(`** After ${runs} seconds: **`);
    console.log("- Fees collected: ", actualFeesCollected.toString());
    console.log("- Sponsor's credited collateral returned by getCollateral(): ", adjustedCollateralAmount.toString());
    console.log("- Collateral owned by contract:", actualCollateralAmount.toString());
    console.log("- Drift:", parseFloat(drift.toString()) / 1e18);
    console.groupEnd();
  });

  it("Precision loss due to deposits() and withdraws()", async function() {
    // In order to induce precision loss on deposits and withdraws, we want to indirectly set the "cumulativeFeeMultiplier"
    // to a value that when divided by some amount cannot be represented fully by the Fixed Point structure.
    // To better understand this, we need to examine how the deposit() method is implemented:
    // - deposit(collateral) calls the internal method _addCollateral(collateral), which adjusts the position's collateral while taking fees into account.
    // - _addCollateral(collateral) scales up the collateral to add: adjustedCollateral = collateral / cumulativeFeeMultiplier
    // - This division has the potential for precision loss, which could cause the resultant rawCollateral in the position to be lower than expected
    // - In other words, the deposit() will have added less collateral to the position than the caller actually transferred
    // - We'll set cumulativeMultiplier to 0.9 because if we deposit 1 collateral token, then an intermediate calculation will be 1/0.9 = 1.1111...repeating, which FixedPoint cannot represent.

    /**
     * @notice TEST PARAMETERS
     */
    const sponsorCollateralAmount = toWei("1");
    const otherCollateralAmount = toWei("0.1");
    const feePerSecond = toWei("0.1");
    const expectedFeeMultiplier = 0.9;
    const amountToDeposit = toWei("0.1");
    const runs = 50;

    /**
     * @notice INSTANTIATE TEST VARIABLES
     */
    let actualFeeMultiplier;
    let startingContractCollateral; // Amount of fees collected by store.
    let startingAdjustedContractCollateral; // Starting collateral that the contract thinks it owns.
    let startingStoreCollateral; // Starting collateral that the contract actually owns.
    let drift = toBN(0); // Precision loss on collateral.
    let adjustedCollateral; // Collateral that the contract thinks it owns.
    let contractCollateral; // Collateral that the contract actually owns.
    let endingStoreCollateral;

    /**
     * @notice SETUP THE TEST
     */
    // 1) Create two positions, one with a very low collateral ratio so that we can withdraw from our test position.
    // Note: must create less collateralized position first
    await collateral.approve(pricelessPositionManager.address, toWei("999999999"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("999999999"), { from: other });
    await pricelessPositionManager.create(
      { rawValue: otherCollateralAmount },
      { rawValue: toWei("100") },
      { from: other }
    );
    await pricelessPositionManager.create(
      { rawValue: sponsorCollateralAmount },
      { rawValue: toWei("100") },
      { from: sponsor }
    );
    // 2) Set fee rate per second.
    await store.setFixedOracleFeePerSecond({ rawValue: feePerSecond });
    // 3) Move time in the contract forward by 1 second to capture unit fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));
    // 4) Pay the fees.
    await pricelessPositionManager.payFees();

    /**
     * @notice TEST INVARIANTS
     */
    actualFeeMultiplier = await pricelessPositionManager.cumulativeFeeMultiplier();
    startingContractCollateral = await collateral.balanceOf(pricelessPositionManager.address);
    startingAdjustedContractCollateral = await pricelessPositionManager.totalPositionCollateral();
    startingStoreCollateral = await collateral.balanceOf(store.address);

    // Test 1) Fee multiplier is set correctly.
    assert.equal(parseFloat(actualFeeMultiplier.toString()) / 1e18, expectedFeeMultiplier);

    // Test 2) The adjusted collateral and actual collateral in contract should be equal
    assert.equal(startingContractCollateral.toString(), startingAdjustedContractCollateral.toString());
    console.group("** Pre-Deposit: **");
    console.log("- Contract Collateral:", startingContractCollateral.toString());
    console.log("- Adjusted Collateral:", startingAdjustedContractCollateral.toString());
    console.groupEnd();

    /**
     * @notice RUN THE TEST ONCE AND PRODUCE KNOWN DRIFT
     */
    await pricelessPositionManager.deposit({ rawValue: amountToDeposit }, { from: sponsor });
    contractCollateral = await collateral.balanceOf(pricelessPositionManager.address);
    adjustedCollateral = await pricelessPositionManager.totalPositionCollateral();
    drift = contractCollateral.sub(toBN(adjustedCollateral.rawValue));

    // Test 1) User should be credited with slightly less collateral than they actually deposited.
    assert(drift.gt(toBN(0)));
    console.group("** After 1 Deposit: **");
    console.log("- Contract Collateral:", contractCollateral.toString());
    console.log("- Adjusted Collateral:", adjustedCollateral.toString());
    console.log("- Drift: ", parseFloat(drift.toString()) / 1e18);
    console.groupEnd();

    /**
     * @notice RUN THE REMAINDER OF THE TEST AND CHECK UNKNOWN DRIFT
     */
    for (let i = 0; i < runs - 1; i++) {
      await pricelessPositionManager.deposit({ rawValue: amountToDeposit }, { from: sponsor });
    }
    contractCollateral = await collateral.balanceOf(pricelessPositionManager.address);
    adjustedCollateral = await pricelessPositionManager.totalPositionCollateral();
    drift = contractCollateral.sub(toBN(adjustedCollateral.rawValue));

    // Test 1) Let's check dat drift.
    console.group(`** After ${runs + 1} Deposits: **`);
    console.log("- Contract Collateral:", contractCollateral.toString());
    console.log("- Adjusted Collateral:", adjustedCollateral.toString());
    console.log("- Drift: ", parseFloat(drift.toString()) / 1e18);
    console.groupEnd();

    /**
     * @notice POST-TEST INVARIANTS
     */
    endingStoreCollateral = await collateral.balanceOf(store.address);

    // Test 1) Make sure that store hasn't collected any fees during this test, so that we can be confident that deposits
    // are the only source of drift.
    assert.equal(startingStoreCollateral.toString(), endingStoreCollateral.toString());
  });
});
