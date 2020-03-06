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
      TokenFactory.address, // _tokenFactoryAddress
      { from: contractDeployer }
    );
  });

// TODO:
//   it("Precision loss due to basic fees", async function() {
//     // Here, we choose a collateral amount that will produce rounding errors:
//     // - Collateral = 3 wei (3e-18)
//     // - 50% fees per second * 1 second * 3e-18 collateral = 1.5e-18 fees, however this gets floored by `Store.computeFee()` to 1 wei (1e-18) fees
//     // - Fees paid as % of collateral = 1e-18 / 3e-18 = 0.33...33 repeating, which cannot be represented by FixedPoint
//     // - This will get ceil'd up to 0.33...34
//     // - This causes the adjustment multiplier applied to the collateral (1 - fee %) to be slightly lower: (1-0.33..34) versus (1+0.33..33)
//     // - Ultimately this adjusts the collateral available for redemption to be lower than anticipated
//     const startCollateralAmount = 3;
//     const startTokenAmount = 1;

//     // Create position.
//     await collateral.approve(pricelessPositionManager.address, startCollateralAmount.toString(), { from: sponsor });
//     await pricelessPositionManager.create({ rawValue: startCollateralAmount.toString() }, { rawValue: startTokenAmount.toString() }, { from: sponsor });

//     // Set fee rate per second.
//     const feeRatePerSecond = 0.50;
//     await store.setFixedOracleFeePerSecond({ rawValue: toWei(feeRatePerSecond.toString()) });

//     // Move time in the contract forward by 1 second to capture unit fee.
//     const startTime = await pricelessPositionManager.getCurrentTime();
//     await pricelessPositionManager.setCurrentTime(startTime.addn(1));

//     // Calculate expected fees collected during this period.
//     const expectedFeesCollectedThisPeriod = 1;
//     const startingStoreBalance = await collateral.balanceOf(store.address)
//     const expectedStoreBalance = (startingStoreBalance).add(toBN(expectedFeesCollectedThisPeriod.toString()));

//     // Pay the fees, then check the collateral and the store balance.
//     await pricelessPositionManager.payFees();
//     const endingStoreBalance = await collateral.balanceOf(store.address)
//     // Due to the precision error mentioned above, `getCollateral()` will return
//     // slightly less than what we are expecting:
//     // Without precision errors, we would expect there to be (3 wei collateral - 1 wei fee = 2 wei collateral) in the contract
//     let collateralAmount = await pricelessPositionManager.getCollateral(sponsor);
//     console.log(`Expected fees collected: `, expectedFeesCollectedThisPeriod.toString())
//     console.log(`Actual fees collected:`, endingStoreBalance.sub(startingStoreBalance).toString())
//     console.log(`Alleged contract collateral net of fees: `,collateralAmount.toString())
//     console.log(`Actual contract collateral net of fees:`, (await collateral.balanceOf(pricelessPositionManager.address)).toString())

//     // However, `getCollateral()` returns a value less than expected
//     // assert(toBN(collateralAmount.rawValue).lt(toBN("2")));
//     // // Store should still have received the correct fee
//     // assert.equal((await collateral.balanceOf(store.address)).toString(), expectedStoreBalance.toString());
//     // // The contract itself has more collateral than `getCollateral()` returns (i.e. it has the expected amount of collateral absent any rounding errors)
//     // assert.equal((await collateral.balanceOf(pricelessPositionManager.address)).toString(), "2");

//     // // Set the store fees back to 0 to prevent it from affecting other tests.
//     // await store.setFixedOracleFeePerSecond({ rawValue: "0" });
//   });

  it("Precision loss due to deposits() and withdraws()", async function() {
    // Create two positions, one with a very high collateral ratio so that we can withdraw from our test position.
    const normalCollateralAmount = toWei("1")
    const overCollateralAmount = toWei("100000")
    await collateral.approve(pricelessPositionManager.address, toWei("999999999"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("999999999"), { from: other });
    await pricelessPositionManager.create({ rawValue: normalCollateralAmount }, { rawValue: toWei("100") }, { from: sponsor });
    await pricelessPositionManager.create({ rawValue: overCollateralAmount }, { rawValue: toWei("100") }, { from: other });

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
    // - In other words, the withdraw() will have removed less collateral from the position than contract transferred to the caller
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

    let startingContractCollateral = await collateral.balanceOf(pricelessPositionManager.address)
    let startingAdjustedSponsorCollateral = await pricelessPositionManager.getCollateral(sponsor)
    let startingAdjustedOtherCollateralOther = await pricelessPositionManager.getCollateral(other)

    // To start, the adjusted collateral and actual collateral in contract should be equal
    assert.equal(startingContractCollateral.toString(), toBN(startingAdjustedSponsorCollateral.rawValue).add(toBN(startingAdjustedOtherCollateralOther.rawValue)).toString())

    // Track drift over time. This can be negative or positive.
    let drift = 0;

    // Deposit collateral, this should result in a difference
    await pricelessPositionManager.deposit({ rawValue: toWei("0.1")}, { from: sponsor })
    let contractCollateral = await collateral.balanceOf(pricelessPositionManager.address)
    let adjustedSponsorCollateral = await pricelessPositionManager.getCollateral(sponsor)
    let adjustedOtherCollateral = await pricelessPositionManager.getCollateral(other)
    let delta = contractCollateral.sub(toBN(adjustedSponsorCollateral.rawValue).add(toBN(adjustedOtherCollateral.rawValue)))
    console.log(`Contract Collateral:`, contractCollateral.toString())
    console.log(`Adjusted Sponsor Collateral:`, adjustedSponsorCollateral.toString())
    console.log(`Adjusted Other Collateral:`, adjustedOtherCollateral.toString())
    console.log(`DELTA: `, parseFloat(delta.toString())/1e18)

    // Withdraw collateral, which should also result in a difference

    // See how long it takes to get meaningful drift
  });
});
