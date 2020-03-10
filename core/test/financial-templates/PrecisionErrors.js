// Contracts to test
const PricelessPositionManager = artifacts.require("PricelessPositionManager");

// Other UMA related contracts and mocks
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MarginToken = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const TokenFactory = artifacts.require("TokenFactory");

contract("PricelessPositionManager", function(accounts) {
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
    // Here, we choose a collateral amount that will produce one rounding error immediately:
    // - Collateral = 9,000,000 wei.
    // - 0.0000004% fees per second * 1 second * 9,000,000 wei collateral = 3.5 wei fees, however this gets floored by `Store.computeFee()` to 3 wei fees.
    // - Fees paid as % of collateral = 3e-18 / 9000000-18 = 0.0000003...33 repeating, which cannot be represented by FixedPoint.
    // - The least significant digit will get ceil'd up from 3 to 4.
    // - This causes the adjustment multiplier applied to the collateral (1 - fee %) to be slightly lower.
    // - Ultimately this decreases the available collateral returned by `FeePayer._getCollateral()`.
    // - This produces drift between _getCollateral() and the actual collateral in the contract (`collateral.balanceOf(contract)`).
    const startCollateralAmount = 9000000;
    const startTokenAmount = 1;

    // Create position.
    await collateral.approve(pricelessPositionManager.address, startCollateralAmount.toString(), { from: sponsor });
    await pricelessPositionManager.create({ rawValue: startCollateralAmount.toString() }, { rawValue: startTokenAmount.toString() }, { from: sponsor });

    // Set fee rate per second.
    const feeRatePerSecond = "0.0000004";
    await store.setFixedOracleFeePerSecond({ rawValue: toWei(feeRatePerSecond) });

    // Move time in the contract forward by 1 second to capture unit fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));

    // Calculate expected fees collected during this period.
    let expectedFeesCollectedThisPeriod = 3;
    const startingStoreBalance = await collateral.balanceOf(store.address)

    // Pay the fees, then check the collateral and the store balance.
    await pricelessPositionManager.payFees();
    let endingStoreBalance = await collateral.balanceOf(store.address)
    // Due to the precision error mentioned above, `getCollateral()` will return
    // slightly less than what we are expecting:
    let collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    console.group(`** After 1 second: **`)
    console.log(`- Expected fees collected: `, expectedFeesCollectedThisPeriod.toString())
    console.log(`- Actual fees collected:`, endingStoreBalance.sub(startingStoreBalance).toString())
    console.log(`- Sponsor's credited collateral returned by getCollateral(): `,collateralAmount.toString())
    console.log(`- Collateral owned by contract:`, (await collateral.balanceOf(pricelessPositionManager.address)).toString())
    console.groupEnd()

    // Run more iterations and check for compounded error.
    let runs = 25;
    for (let i = 1; i <= runs; i++) {
      await pricelessPositionManager.setCurrentTime(startTime.addn(1+i));
      await pricelessPositionManager.payFees();
    }

    // While getCollateral() returns >= 8,000,000 wei collateral, the expected fees collected per second should be floor'd to 4 wei.
    // This will be the case for at least the next 1000 runs
    expectedFeesCollectedThisPeriod += (runs * expectedFeesCollectedThisPeriod);
    endingStoreBalance = await collateral.balanceOf(store.address);

    // However, since we are no longer dividing by 9,000,000 in an intermediate calculation, it is not obvious that more
    // rounding errors will occur. Let's see what the drift is after 1000 runs.
    collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
    console.group(`** After ${1+runs} seconds: **`)
    console.log(`- Expected fees collected: `, expectedFeesCollectedThisPeriod.toString())
    console.log(`- Actual fees collected:`, endingStoreBalance.sub(startingStoreBalance).toString())
    console.log(`- Sponsor's credited collateral returned by getCollateral(): `,collateralAmount.toString())
    console.log(`- Collateral owned by contract:`, (await collateral.balanceOf(pricelessPositionManager.address)).toString())
    console.groupEnd()
  });

  it("Precision loss due to deposits() and withdraws()", async function() {
    // Create two positions, one with a very low collateral ratio so that we can withdraw from our test position.
    const sponsorCollateralAmount = toWei("1")
    const otherCollateralAmount = toWei("0.1")
    await collateral.approve(pricelessPositionManager.address, toWei("999999999"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("999999999"), { from: other });
    // Note: must create less collateralized position first
    await pricelessPositionManager.create({ rawValue: otherCollateralAmount }, { rawValue: toWei("100") }, { from: other });
    await pricelessPositionManager.create({ rawValue: sponsorCollateralAmount }, { rawValue: toWei("100") }, { from: sponsor });

    // In order to induce precision loss on deposits and withdraws, we want to indirectly set the "cumulativeFeeMultiplier"
    // to a value that when divided by some amount cannot be represented fully by the Fixed Point structure.
    // To better understand this, we need to examine how the deposit() method is implemented:
    // - deposit(collateral) calls the internal method _addCollateral(collateral), which adjusts the position's collateral while taking fees into account.
    // - _addCollateral(collateral) scales up the collateral to add: adjustedCollateral = collateral / cumulativeFeeMultiplier
    // - This division has the potential for precision loss, which could cause the resultant rawCollateral in the position to be lower than expected
    // - In other words, the deposit() will have added less collateral to the position than the caller actually transferred
    // - withdraw(collateral) similarly calls the internal method _removeCollateral(collateral)
    // - _removeCollateral(collateral) also scales up the collateral to remove: adjustedCollateral = collateral / cumulativeFeeMultiplier
    // - The resultant rawCollateral post-withdrawal could be more than expected
    // - In other words, the withdraw() will have removed less collateral from the position than contract transfers to the caller
    // What's going to happen? It's anybody's guess!

    // First, let's set cumulativeMultiplier to 0.9 because 1/0.9 = 1.1111...repeating, which FixedPoint cannot represent.
    let feePerSecond = toWei("0.1");
    await store.setFixedOracleFeePerSecond({ rawValue: feePerSecond });

    // Move time in the contract forward by 1 second to capture unit fee.
    const startTime = await pricelessPositionManager.getCurrentTime();
    await pricelessPositionManager.setCurrentTime(startTime.addn(1));

    // Pay the fees, then check the collateral balances and the fee multiplier.
    await pricelessPositionManager.payFees();
    let evilFeeMultiplier = await pricelessPositionManager.cumulativeFeeMultiplier()
    assert.equal(parseFloat(evilFeeMultiplier.toString())/1e18, 0.9)

    // Snapshot collateral amounts post-fees
    let startingContractCollateral = await collateral.balanceOf(pricelessPositionManager.address)
    let startingAdjustedContractCollateral = await pricelessPositionManager.totalPositionCollateral();
    let startingStoreCollateral = await collateral.balanceOf(store.address)

    // To start, the adjusted collateral and actual collateral in contract should be equal
    assert.equal(startingContractCollateral.toString(), startingAdjustedContractCollateral.toString())
    console.group(`** Pre-Deposit: **`)
    console.log(`- Contract Collateral:`, startingContractCollateral.toString())
    console.log(`- Adjusted Collateral:`, startingAdjustedContractCollateral.toString())
    console.groupEnd()

    // Track drift over time. This can be negative or positive.
    let drift = toBN(0);
    let contractCollateral;
    let adjustedCollateral;

    // Deposit collateral, which should credit user LESS collateral than they transfer
    await pricelessPositionManager.deposit({ rawValue: toWei("0.1")}, { from: sponsor })
    contractCollateral = await collateral.balanceOf(pricelessPositionManager.address)
    adjustedCollateral = await pricelessPositionManager.totalPositionCollateral()
    drift = contractCollateral.sub(toBN(adjustedCollateral.rawValue))
    console.group(`** After 1 Deposit: **`)
    console.log(`- Contract Collateral:`, contractCollateral.toString())
    console.log(`- Adjusted Collateral:`, adjustedCollateral.toString())
    console.log(`- Drift: `, parseFloat(drift.toString())/1e18)
    console.groupEnd()

    // More runs, check for compounded error.
    let runs = 15;
    for (let i = 0; i < runs; i++) {
      await pricelessPositionManager.deposit({ rawValue: toWei("0.1")}, { from: sponsor })
    }
    contractCollateral = await collateral.balanceOf(pricelessPositionManager.address)
    adjustedCollateral = await pricelessPositionManager.totalPositionCollateral()
    drift = contractCollateral.sub(toBN(adjustedCollateral.rawValue))
    console.group(`** After ${runs+1} Deposits: **`)
    console.log(`- Contract Collateral:`, contractCollateral.toString())
    console.log(`- Adjusted Collateral:`, adjustedCollateral.toString())
    console.log(`- Drift: `, parseFloat(drift.toString())/1e18)
    console.groupEnd()  

    // Make sure that store hasn't collected any fees during this test, so that we can be confident that deposits
    // are the only source of drift.
    let endingStoreCollateral = await collateral.balanceOf(store.address)
    assert.equal(startingStoreCollateral.toString(), endingStoreCollateral.toString())
  });
});
