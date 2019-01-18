const { didContractThrow } = require("./utils/DidContractThrow.js");

const CentralizedOracle = artifacts.require("CentralizedOracle");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const NoLeverage = artifacts.require("NoLeverage");
const Oracle = artifacts.require("OracleMock");
const Registry = artifacts.require("Registry");
const TokenizedDerivative = artifacts.require("TokenizedDerivative");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const BigNumber = require("bignumber.js");

contract("TokenizedDerivative", function(accounts) {
  let identifierBytes;
  let derivativeContract;
  let deployedRegistry;
  let deployedCentralizedOracle;
  let deployedManualPriceFeed;
  let tokenizedDerivativeCreator;
  let noLeverageCalculator;

  const ownerAddress = accounts[0];
  const sponsor = accounts[1];
  const admin = accounts[2];
  const thirdParty = accounts[3];

  // The ManualPriceFeed can support prices at arbitrary intervals, but for convenience, we send updates at this
  // interval.
  const priceFeedUpdatesInterval = 60;
  let feesPerInterval;

  const computeNewNav = (previousNav, priceReturn, fees) => {
    const expectedReturnWithFees = priceReturn.sub(fees);
    const retVal = BigNumber(web3.utils.fromWei(expectedReturnWithFees.mul(previousNav), "ether"));
    const flooredRetVal = retVal.integerValue(BigNumber.ROUND_FLOOR);
    return web3.utils.toBN(flooredRetVal);
  };

  const computeExpectedPenalty = (navToPenalize, penaltyPercentage) => {
    return web3.utils.toBN(web3.utils.fromWei(navToPenalize.mul(penaltyPercentage), "ether"));
  };

  // Pushes a price to the ManualPriceFeed, incrementing time by `priceFeedUpdatesInterval`.
  const pushPrice = async price => {
    const latestTime = parseInt(await deployedManualPriceFeed.getCurrentTime(), 10) + priceFeedUpdatesInterval;
    await deployedManualPriceFeed.setCurrentTime(latestTime);
    await deployedManualPriceFeed.pushLatestPrice(identifierBytes, latestTime, price);
  };

  const deployNewTokenizedDerivative = async expiryDelay => {
    await pushPrice(web3.utils.toWei("1", "ether"));
    const startTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];

    let expiry = 0;
    if (expiryDelay != undefined) {
      expiry = startTime.addn(expiryDelay);
    }

    await tokenizedDerivativeCreator.createTokenizedDerivative(
      sponsor,
      admin,
      web3.utils.toWei("0.05", "ether") /*_defaultPenalty*/,
      web3.utils.toWei("0.1", "ether") /*_requiredMargin*/,
      identifierBytes,
      web3.utils.toWei("0.01", "ether") /*_fixedYearlyFee*/,
      web3.utils.toWei("0.05", "ether") /*_disputeDeposit*/,
      noLeverageCalculator.address /*_returnCalculator*/,
      web3.utils.toWei("1", "ether") /*_startingTokenPrice*/,
      expiry.toString(),
      { from: sponsor }
    );

    const numRegisteredContracts = await deployedRegistry.getNumRegisteredContractsBySender({ from: sponsor });
    const derivativeAddress = await deployedRegistry.getRegisteredContractBySender(
      numRegisteredContracts.subn(1).toString(),
      { from: sponsor }
    );
    derivativeContract = await TokenizedDerivative.at(derivativeAddress);

    const feesPerSecond = await derivativeContract.fixedFeePerSecond();
    feesPerInterval = feesPerSecond.muln(priceFeedUpdatesInterval);
  };

  before(async function() {
    identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("ETH/USD"));
    // Set the deployed registry and oracle.
    deployedRegistry = await Registry.deployed();
    deployedCentralizedOracle = await CentralizedOracle.deployed();
    deployedManualPriceFeed = await ManualPriceFeed.deployed();
    tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    noLeverageCalculator = await NoLeverage.deployed();

    // Make sure the Oracle and PriceFeed support the underlying product.
    await deployedCentralizedOracle.addSupportedIdentifier(identifierBytes);
    await deployedManualPriceFeed.setCurrentTime(1000);
    await pushPrice(web3.utils.toWei("1", "ether"));
  });

  it("Live -> Default -> Settled (confirmed)", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    await deployNewTokenizedDerivative();

    let state = await derivativeContract.state();
    let tokensOutstanding = await derivativeContract.totalSupply();
    let nav = await derivativeContract.nav();

    // TODO: add a javascript lib that will map from enum name to uint value.
    // '0' == State.Live
    assert.equal(state.toString(), "0");
    assert.equal(tokensOutstanding.toString(), "0");
    assert.equal(nav.toString(), "0");

    let contractSponsor = await derivativeContract.sponsor();
    let contractAdmin = await derivativeContract.admin();

    assert.equal(contractSponsor, sponsor);
    assert.equal(contractAdmin, admin);

    let longBalance = await derivativeContract.longBalance();
    let shortBalance = await derivativeContract.shortBalance();

    // Ensure the short balance is 0 ETH (as is deposited in beforeEach()).
    assert.equal(shortBalance.toString(), web3.utils.toWei("0", "ether"));

    // Check that the deposit function correctly credits the short account.
    await derivativeContract.deposit({ from: sponsor, value: web3.utils.toWei("0.3", "ether") });
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(shortBalance.toString(), web3.utils.toWei("0.3", "ether"));

    // Check that the withdraw function correctly withdraws from the sponsor account.
    await derivativeContract.withdraw(web3.utils.toWei("0.1", "ether"), { from: sponsor });
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(shortBalance.toString(), web3.utils.toWei("0.2", "ether"));

    // Fails because there is not enough short margin for 3 ETH of tokens.
    assert(
      await didContractThrow(derivativeContract.createTokens({ from: sponsor, value: web3.utils.toWei("3", "ether") }))
    );

    // Fails because the admin is not allowed to create tokens.
    assert(
      await didContractThrow(derivativeContract.createTokens({ from: admin, value: web3.utils.toWei("1", "ether") }))
    );

    // Succeeds because exact is true and requested NAV (1 ETH) would not cause the short account to go below its
    // margin requirement.
    await derivativeContract.createTokens({ from: sponsor, value: web3.utils.toWei("1", "ether") });

    let sponsorTokenBalance = await derivativeContract.balanceOf(sponsor);
    longBalance = await derivativeContract.longBalance();
    nav = await derivativeContract.nav();

    assert.equal(sponsorTokenBalance.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(longBalance.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(nav.toString(), web3.utils.toWei("1", "ether"));

    // Succeeds because there is enough margin to support an additional 1 ETH of NAV.
    await derivativeContract.createTokens({ from: sponsor, value: web3.utils.toWei("1", "ether") });

    sponsorTokenBalance = await derivativeContract.balanceOf(sponsor);
    longBalance = await derivativeContract.longBalance();
    nav = await derivativeContract.nav();

    assert.equal(sponsorTokenBalance.toString(), web3.utils.toWei("2", "ether"));
    assert.equal(longBalance.toString(), web3.utils.toWei("2", "ether"));
    assert.equal(nav.toString(), web3.utils.toWei("2", "ether"));

    // This number was chosen so that once the price doubles, the sponsor will not default.
    await derivativeContract.deposit({ from: sponsor, value: web3.utils.toWei("2.6", "ether") });

    shortBalance = await derivativeContract.shortBalance();

    assert.equal(shortBalance.toString(), web3.utils.toWei("2.8", "ether"));

    // Change the price to ensure the new NAV and redemption value is computed correctly.
    await pushPrice(web3.utils.toWei("2", "ether"));

    tokensOutstanding = await derivativeContract.totalSupply();

    assert.equal(tokensOutstanding.toString(), web3.utils.toWei("2", "ether"));

    // Compute NAV with fees and expected return on initial price.
    let expectedReturnWithoutFees = web3.utils.toBN(web3.utils.toWei("2", "ether"));
    let expectedNav = computeNewNav(nav, expectedReturnWithoutFees, feesPerInterval);

    // Remargin to the new price.
    await derivativeContract.remargin({ from: sponsor });

    // Ensure that a remargin with no new price works appropriately and doesn't create any balance issues.
    await derivativeContract.remargin({ from: admin });

    // Check new nav after price change.
    nav = await derivativeContract.nav();
    longBalance = await derivativeContract.longBalance();

    assert.equal(nav.toString(), expectedNav.toString());
    assert.equal(longBalance.toString(), expectedNav.toString());

    // Should fail because the ERC20 tokens have not been authorized.
    assert(await didContractThrow(derivativeContract.redeemTokens({ from: sponsor })));

    let initialContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));

    // Attempt redemption of half of the tokens.
    await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: sponsor });
    await derivativeContract.redeemTokens({ from: sponsor });

    nav = await derivativeContract.nav();

    // Verify token deduction and ETH payout.
    totalSupply = await derivativeContract.totalSupply();
    longBalance = await derivativeContract.longBalance();
    let allowance = await derivativeContract.allowance(sponsor, derivativeContract.address);
    let newContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));

    expectedNav = expectedNav.divn(2);
    assert.equal(totalSupply.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(longBalance.toString(), expectedNav.toString());
    assert.equal(nav.toString(), expectedNav.toString());
    assert.equal(allowance.toString(), "0");

    let expectedBalanceChange = expectedNav;
    let actualBalanceChange = initialContractBalance.sub(newContractBalance);
    assert.equal(actualBalanceChange.toString(), expectedBalanceChange.toString());

    // Force the sponsor into default by further increasing the unverified price.
    shortBalance = await derivativeContract.shortBalance();
    await pushPrice(web3.utils.toWei("2.6", "ether"));
    await derivativeContract.remargin({ from: sponsor });

    // Add an unverified price to ensure that post-default the contract ceases updating.
    await pushPrice(web3.utils.toWei("10.0", "ether"));

    // Compute the expected new NAV and compare.
    expectedNav = computeNewNav(nav, web3.utils.toBN(web3.utils.toWei("1.3", "ether")), feesPerInterval);
    let expectedPenalty = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));

    let expectedNavChange = expectedNav.sub(nav);
    state = await derivativeContract.state();
    nav = await derivativeContract.nav();
    let initialSponsorBalance = shortBalance;
    shortBalance = await derivativeContract.shortBalance();
    let sponsorBalancePostRemargin = shortBalance;

    assert.equal(state.toString(), "3");
    assert.equal(nav.toString(), expectedNav.toString());
    assert.equal(initialSponsorBalance.sub(sponsorBalancePostRemargin).toString(), expectedNavChange.toString());

    // Only the sponsor can confirm.
    assert(await didContractThrow(derivativeContract.confirmPrice({ from: admin })));

    // Verify that the sponsor cannot withdraw before settlement.
    assert(
      await didContractThrow(derivativeContract.withdraw(sponsorBalancePostRemargin.toString(), { from: sponsor }))
    );

    // Verify that after the sponsor confirms, the state is moved to settled.
    await derivativeContract.confirmPrice({ from: sponsor });

    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Now that the contract is settled, verify that all parties can extract their tokens/balances.
    shortBalance = await derivativeContract.shortBalance();
    longBalance = await derivativeContract.longBalance();
    let sponsorBalancePostSettlement = shortBalance;
    let expectedBalance = sponsorBalancePostRemargin.sub(expectedPenalty);
    assert.equal(sponsorBalancePostSettlement.toString(), expectedBalance.toString());

    initialContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    await derivativeContract.withdraw(sponsorBalancePostSettlement.toString(), { from: sponsor });
    newContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    assert.equal(initialContractBalance.sub(newContractBalance).toString(), sponsorBalancePostSettlement.toString());

    // Investor should never be able to use the withdraw function.
    assert(await didContractThrow(derivativeContract.withdraw(longBalance.toString(), { from: sponsor })));

    // Tokens should be able to be transferred post-settlement. Anyone should be able to redeem them for the frozen price.
    let remainingBalance = await derivativeContract.balanceOf(sponsor);
    await derivativeContract.transfer(thirdParty, remainingBalance.toString(), { from: sponsor });

    await derivativeContract.approve(derivativeContract.address, remainingBalance.toString(), { from: thirdParty });
    initialContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    let initialUserBalance = web3.utils.toBN(await web3.eth.getBalance(thirdParty));
    await derivativeContract.redeemTokens({ from: thirdParty });
    newContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    let newUserBalance = web3.utils.toBN(await web3.eth.getBalance(thirdParty));

    assert.equal(initialContractBalance.sub(newContractBalance).toString(), nav.add(expectedPenalty).toString());

    // 1 means that newUserBalance > initialUserBalance - the user's balance increased.
    assert.equal(newUserBalance.cmp(initialUserBalance), 1);

    // Contract should be empty.
    assert.equal(newContractBalance.toString(), "0");
  });

  it("Live -> Default -> Settled (oracle)", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    await deployNewTokenizedDerivative();

    // Sponsor initializes contract.
    await derivativeContract.depositAndCreateTokens(web3.utils.toWei("1", "ether"), {
      from: sponsor,
      value: web3.utils.toWei("1.2", "ether")
    });

    // Verify initial state, nav, and balances.
    const initialNav = await derivativeContract.nav();
    let longBalance = await derivativeContract.longBalance();
    let shortBalance = await derivativeContract.shortBalance();
    const initialInvestorBalance = longBalance;
    const initialSponsorBalance = shortBalance;
    assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(initialInvestorBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
    assert.equal(initialSponsorBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.2", "ether")));
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // The price increases, forcing the sponsor into default.
    const navPreDefault = await derivativeContract.nav();
    await pushPrice(web3.utils.toWei("1.1", "ether"));
    const defaultTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];
    await derivativeContract.remargin({ from: sponsor });

    // Verify nav and balances. The default penalty shouldn't be charged yet.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "3");
    let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    const expectedDefaultNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
    let changeInNav = expectedDefaultNav.sub(initialNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = initialInvestorBalance.add(changeInNav);
    expectedSponsorAccountBalance = initialSponsorBalance.sub(changeInNav);
    longBalance = await derivativeContract.longBalance();
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(actualNav.toString(), expectedDefaultNav.toString());
    assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
    assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());

    // Provide the Oracle price and call settle. The Oracle price is different from the price feed price, and the
    // sponsor is no longer in default.
    await deployedCentralizedOracle.pushPrice(identifierBytes, defaultTime, web3.utils.toWei("1.05", "ether"));
    await derivativeContract.settle();

    // Verify nav and balances at settlement, no default penalty. Whatever the price feed said before is effectively
    // ignored.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");
    priceReturn = web3.utils.toBN(web3.utils.toWei("1.05", "ether"));
    const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
    changeInNav = expectedSettlementNav.sub(initialNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = initialInvestorBalance.add(changeInNav);
    expectedSponsorAccountBalance = initialSponsorBalance.sub(changeInNav);
    longBalance = await derivativeContract.longBalance();
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(actualNav.toString(), expectedSettlementNav.toString());
    assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
    assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
  });

  it("Live -> Default -> Settled (oracle) [price available]", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    await deployNewTokenizedDerivative();

    // Sponsor initializes contract.
    await derivativeContract.depositAndCreateTokens(web3.utils.toWei("1", "ether"), {
      from: sponsor,
      value: web3.utils.toWei("1.2", "ether")
    });

    // Verify initial state, nav, and balances.
    const initialNav = await derivativeContract.nav();
    let longBalance = await derivativeContract.longBalance();
    let shortBalance = await derivativeContract.shortBalance();
    assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(longBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
    assert.equal(shortBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.2", "ether")));
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // The price increases, forcing the sponsor into default.
    const navPreDefault = await derivativeContract.nav();
    await pushPrice(web3.utils.toWei("1.1", "ether"));
    const defaultTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];

    // The Oracle price is already available.
    await deployedCentralizedOracle.getPrice(identifierBytes, defaultTime);
    await deployedCentralizedOracle.pushPrice(identifierBytes, defaultTime, web3.utils.toWei("1.1", "ether"));

    // Remargin to the new price, which should immediately settle the contract.
    await derivativeContract.remargin({ from: sponsor });
    assert.equal((await derivativeContract.state()).toString(), "4");

    // Verify nav and balances at settlement, including default penalty.
    const defaultPenalty = computeExpectedPenalty(initialNav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
    const priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
    let changeInNav = expectedSettlementNav.sub(initialNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = longBalance.add(changeInNav).add(defaultPenalty);
    expectedSponsorAccountBalance = shortBalance.sub(changeInNav).sub(defaultPenalty);
    longBalance = await derivativeContract.longBalance();
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(actualNav.toString(), expectedSettlementNav.toString());
    assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
    assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
  });

  it("Live -> Dispute (correctly) [price available] -> Settled", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    await deployNewTokenizedDerivative();

    // Sponsor initializes contract
    await derivativeContract.depositAndCreateTokens(web3.utils.toWei("1", "ether"), {
      from: sponsor,
      value: web3.utils.toWei("1.2", "ether")
    });

    let nav = await derivativeContract.nav();
    const disputeTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];
    // Provide oracle price for the disputed time.
    await deployedCentralizedOracle.getPrice(identifierBytes, disputeTime);
    await deployedCentralizedOracle.pushPrice(identifierBytes, disputeTime, web3.utils.toWei("0.9", "ether"));

    // Pushing these prices doesn't remargin the contract, so it doesn't affect what we dispute.
    await pushPrice(web3.utils.toWei("1.1", "ether"));

    // Dispute the price.
    const presettlementNav = await derivativeContract.nav();
    const presettlementSponsorBalance = await derivativeContract.shortBalance();

    const disputeFee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
    await derivativeContract.dispute({ from: sponsor, value: disputeFee.toString() });

    // Auto-settles with the Oracle price.
    assert.equal((await derivativeContract.state()).toString(), "4");
    nav = await derivativeContract.nav();

    const shortBalance = await derivativeContract.shortBalance();
    const longBalance = await derivativeContract.longBalance();

    // Verify that the dispute fee went to the counterparty and that the NAV changed.
    assert.notEqual(presettlementNav.toString(), nav.toString());
    assert.equal(longBalance.toString(), nav.toString());
    const navDiff = nav.sub(presettlementNav);
    assert.equal(
      shortBalance.toString(),
      presettlementSponsorBalance
        .sub(navDiff)
        .add(disputeFee)
        .toString()
    );

    // Redeem tokens and withdraw money.
    await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: sponsor });
    await derivativeContract.redeemTokens({ from: sponsor });
    await derivativeContract.withdraw(shortBalance.toString(), { from: sponsor });

    contractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    assert.equal(contractBalance.toString(), "0");
  });

  it("Live -> Dispute (incorrectly) -> Settled", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    await deployNewTokenizedDerivative();

    // Sponsor initializes contract
    await derivativeContract.depositAndCreateTokens(web3.utils.toWei("1", "ether"), {
      from: sponsor,
      value: web3.utils.toWei("1.5", "ether")
    });

    let nav = await derivativeContract.nav();

    const disputeTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];
    // Dispute the current price.
    let disputeFee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
    await derivativeContract.dispute({ from: sponsor, value: disputeFee.toString() });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "1");

    // Provide the Oracle price.
    await deployedCentralizedOracle.pushPrice(identifierBytes, disputeTime, web3.utils.toWei("1", "ether"));

    // Settle with the Oracle price.
    let presettlementNav = await derivativeContract.nav();
    let presettlementSponsorBalance = await derivativeContract.shortBalance();
    await derivativeContract.settle({ from: thirdParty });

    // Verify that you can't call dispute once the contract is settled.
    assert(await didContractThrow(derivativeContract.dispute()));

    nav = await derivativeContract.nav();
    let shortBalance = await derivativeContract.shortBalance();
    let longBalance = await derivativeContract.longBalance();

    // Verify that the dispute fee was refunded and the nav didn't change.
    assert.equal(presettlementNav.toString(), nav.toString());
    assert.equal(longBalance.toString(), nav.add(disputeFee).toString());

    // Sponsor should have the exact same amount of ETH that they deposited.
    assert.equal(shortBalance.toString(), web3.utils.toWei("0.5", "ether"));

    // Redeem tokens and withdraw money.
    await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: sponsor });
    await derivativeContract.redeemTokens({ from: sponsor });
    await derivativeContract.withdraw(shortBalance.toString(), { from: sponsor });

    contractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    assert.equal(contractBalance.toString(), "0");
  });

  it("Live -> Expired -> Settled (oracle price)", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    // One time step until expiry.
    await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

    // Sponsor initializes contract
    await derivativeContract.depositAndCreateTokens(web3.utils.toWei("1", "ether"), {
      from: sponsor,
      value: web3.utils.toWei("1.5", "ether")
    });

    // Verify initial state.
    const initialNav = await derivativeContract.nav();
    let longBalance = await derivativeContract.longBalance();
    let shortBalance = await derivativeContract.shortBalance();
    assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(longBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
    assert.equal(shortBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.5", "ether")));
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Push the contract to expiry. and provide Oracle price beforehand.
    await pushPrice(web3.utils.toWei("100", "ether"));
    const expirationTime = await deployedManualPriceFeed.getCurrentTime();

    // Contract should go to expired.
    await derivativeContract.remargin({ from: sponsor });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "2");

    // Verify that you can't call settle before the Oracle provides a price.
    assert(await didContractThrow(derivativeContract.dispute()));

    // Then the Oracle price should be provided, which settles the contract.
    await deployedCentralizedOracle.pushPrice(identifierBytes, expirationTime, web3.utils.toWei("1.1", "ether"));
    await derivativeContract.settle();
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Verify nav and balances at settlement.
    let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
    let changeInNav = expectedSettlementNav.sub(initialNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = longBalance.add(changeInNav);
    expectedSponsorAccountBalance = shortBalance.sub(changeInNav);
    longBalance = await derivativeContract.longBalance();
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(actualNav.toString(), expectedSettlementNav.toString());
    assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
    assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
  });

  it("Live -> Expired -> Settled (oracle price) [price available]", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    // One time step until expiry.
    await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

    // Sponsor initializes contract
    await derivativeContract.depositAndCreateTokens(web3.utils.toWei("1", "ether"), {
      from: sponsor,
      value: web3.utils.toWei("1.5", "ether")
    });

    // Verify initial state.
    const initialNav = await derivativeContract.nav();
    let longBalance = await derivativeContract.longBalance();
    let shortBalance = await derivativeContract.shortBalance();
    assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(longBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
    assert.equal(shortBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.5", "ether")));
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Push the contract to expiry, and provide Oracle price beforehand.
    await pushPrice(web3.utils.toWei("100", "ether"));
    const expirationTime = await deployedManualPriceFeed.getCurrentTime();
    await deployedCentralizedOracle.getPrice(identifierBytes, expirationTime);
    await deployedCentralizedOracle.pushPrice(identifierBytes, expirationTime, web3.utils.toWei("1.1", "ether"));

    // Contract should go straight to settled.
    await derivativeContract.remargin({ from: sponsor });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Verify nav and balances at settlement.
    let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
    let changeInNav = expectedSettlementNav.sub(initialNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = longBalance.add(changeInNav);
    expectedSponsorAccountBalance = shortBalance.sub(changeInNav);
    longBalance = await derivativeContract.longBalance();
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(actualNav.toString(), expectedSettlementNav.toString());
    assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
    assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
  });

  it("Live -> Remargin -> Remargin -> Expired -> Settled (oracle price)", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    // Three time steps until expiry.
    await deployNewTokenizedDerivative(priceFeedUpdatesInterval * 3);

    // Sponsor initializes contract
    await derivativeContract.depositAndCreateTokens(web3.utils.toWei("1", "ether"), {
      from: sponsor,
      value: web3.utils.toWei("1.5", "ether")
    });

    // Verify initial nav and balances. No time based fees have been assessed yet.
    let expectedNav = web3.utils.toBN(web3.utils.toWei("1", "ether"));
    let actualNav = await derivativeContract.nav();
    let longBalance = await derivativeContract.longBalance();
    let shortBalance = await derivativeContract.shortBalance();
    assert.equal(actualNav.toString(), expectedNav.toString());
    assert.equal(longBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
    assert.equal(shortBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.5", "ether")));

    // Move the price 10% up.
    await pushPrice(web3.utils.toWei("1.1", "ether"));
    await derivativeContract.remargin({ from: sponsor });
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Verify nav and balances.
    let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
    let changeInNav = expectedNav.sub(actualNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = longBalance.add(changeInNav);
    expectedSponsorAccountBalance = shortBalance.sub(changeInNav);
    longBalance = await derivativeContract.longBalance();
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(actualNav.toString(), expectedNav.toString());
    assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
    assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());

    // Move the price another 10% up.
    await pushPrice(web3.utils.toWei("1.21", "ether"));
    await derivativeContract.remargin({ from: sponsor });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Verify nav and balance.
    priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
    changeInNav = expectedNav.sub(actualNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = longBalance.add(changeInNav);
    expectedSponsorAccountBalance = shortBalance.sub(changeInNav);
    longBalance = await derivativeContract.longBalance();
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(actualNav.toString(), expectedNav.toString());
    assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
    assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());

    // Now push to contract into expiry, moving down by 10% (which isn't the same as reversing the previous move).
    await pushPrice(web3.utils.toWei("1.089", "ether"));
    const expirationTime = await deployedManualPriceFeed.getCurrentTime();
    await derivativeContract.remargin({ from: sponsor });

    // Contract should go to EXPIRED, and then on settle(), go to SETTLED.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "2");
    await deployedCentralizedOracle.pushPrice(identifierBytes, expirationTime, web3.utils.toWei("1.089", "ether"));
    await derivativeContract.settle();
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Verify NAV and balances at expiry.
    priceReturn = web3.utils.toBN(web3.utils.toWei("0.9", "ether"));
    expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
    changeInNav = expectedNav.sub(actualNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = longBalance.add(changeInNav);
    expectedSponsorAccountBalance = shortBalance.sub(changeInNav);
    longBalance = await derivativeContract.longBalance();
    shortBalance = await derivativeContract.shortBalance();
    assert.equal(actualNav.toString(), expectedNav.toString());
    assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
    assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
  });

  it("Live -> Create -> Create fails on expiry", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    // One time step until expiry.
    await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

    // Sponsor initializes contract
    await derivativeContract.depositAndCreateTokens(web3.utils.toWei("1", "ether"), {
      from: sponsor,
      value: web3.utils.toWei("1.6", "ether")
    });

    // Push time forward, so that the contract will expire when remargin is called.
    await pushPrice(web3.utils.toWei("1", "ether"));

    // Tokens cannot be created because the contract has expired.
    assert(
      await didContractThrow(derivativeContract.createTokens({ from: sponsor, value: web3.utils.toWei("1", "ether") }))
    );
  });

  it("DepositAndCreateTokens failure", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    // One time step until expiry.
    await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

    // Token creation should fail because the sponsor doesn't supply enough margin.
    assert(
      await didContractThrow(
        derivativeContract.depositAndCreateTokens(web3.utils.toWei("1", "ether"), {
          from: sponsor,
          value: web3.utils.toWei("1.05", "ether")
        })
      )
    );
  });

  it("Constructor assertions", async function() {
    // Product unsupported by the Oracle.
    const productUnsupportedByOracle = web3.utils.hexToBytes(web3.utils.utf8ToHex("unsupportedByOracle"));
    const time = 100000;
    await deployedManualPriceFeed.setCurrentTime(time);
    await deployedManualPriceFeed.pushLatestPrice(productUnsupportedByOracle, time, web3.utils.toWei("1", "ether"));
    assert(
      await didContractThrow(
        tokenizedDerivativeCreator.createTokenizedDerivative(
          sponsor,
          admin,
          web3.utils.toWei("0.05", "ether") /*_defaultPenalty*/,
          web3.utils.toWei("0.1", "ether") /*_requiredMargin*/,
          productUnsupportedByOracle,
          web3.utils.toWei("0.01", "ether") /*_fixedYearlyFee*/,
          web3.utils.toWei("0.05", "ether") /*_disputeDeposit*/,
          noLeverageCalculator.address /*_returnCalculator*/,
          web3.utils.toWei("1", "ether") /*_startingTokenPrice*/,
          "0",
          { from: sponsor }
        )
      )
    );

    // Product unsupported by price feed.
    const productUnsupportedByPriceFeed = web3.utils.hexToBytes(web3.utils.utf8ToHex("unsupportedByFeed"));
    await deployedCentralizedOracle.addSupportedIdentifier(productUnsupportedByPriceFeed);
    assert(
      await didContractThrow(
        tokenizedDerivativeCreator.createTokenizedDerivative(
          sponsor,
          admin,
          web3.utils.toWei("0.05", "ether") /*_defaultPenalty*/,
          web3.utils.toWei("0.1", "ether") /*_requiredMargin*/,
          productUnsupportedByPriceFeed,
          web3.utils.toWei("0.01", "ether") /*_fixedYearlyFee*/,
          web3.utils.toWei("0.05", "ether") /*_disputeDeposit*/,
          noLeverageCalculator.address /*_returnCalculator*/,
          web3.utils.toWei("1", "ether") /*_startingTokenPrice*/,
          "0",
          { from: sponsor }
        )
      )
    );

    // Default penalty above margin requirement.
    assert(
      await didContractThrow(
        tokenizedDerivativeCreator.createTokenizedDerivative(
          sponsor,
          admin,
          web3.utils.toWei("0.5", "ether") /*_defaultPenalty*/,
          web3.utils.toWei("0.1", "ether") /*_requiredMargin*/,
          identifierBytes,
          web3.utils.toWei("0.01", "ether") /*_fixedYearlyFee*/,
          web3.utils.toWei("0.05", "ether") /*_disputeDeposit*/,
          noLeverageCalculator.address /*_returnCalculator*/,
          web3.utils.toWei("1", "ether") /*_startingTokenPrice*/,
          "0",
          { from: sponsor }
        )
      )
    );

    // Margin requirement above 100%.
    assert(
      await didContractThrow(
        tokenizedDerivativeCreator.createTokenizedDerivative(
          sponsor,
          admin,
          web3.utils.toWei("0.05", "ether") /*_defaultPenalty*/,
          web3.utils.toWei("2", "ether") /*_requiredMargin*/,
          identifierBytes,
          web3.utils.toWei("0.01", "ether") /*_fixedYearlyFee*/,
          web3.utils.toWei("0.05", "ether") /*_disputeDeposit*/,
          noLeverageCalculator.address /*_returnCalculator*/,
          web3.utils.toWei("1", "ether") /*_startingTokenPrice*/,
          "0",
          { from: sponsor }
        )
      )
    );

    // Starting token price too high.
    assert(
      await didContractThrow(
        tokenizedDerivativeCreator.createTokenizedDerivative(
          sponsor,
          admin,
          web3.utils.toWei("0.05", "ether") /*_defaultPenalty*/,
          web3.utils.toWei("0.1", "ether") /*_requiredMargin*/,
          identifierBytes,
          web3.utils.toWei("0.01", "ether") /*_fixedYearlyFee*/,
          web3.utils.toWei("0.05", "ether") /*_disputeDeposit*/,
          noLeverageCalculator.address /*_returnCalculator*/,
          web3.utils.toWei("2000000000", "ether") /*_startingTokenPrice*/,
          "0",
          { from: sponsor }
        )
      )
    );

    // Starting token price too low.
    assert(
      await didContractThrow(
        tokenizedDerivativeCreator.createTokenizedDerivative(
          sponsor,
          admin,
          web3.utils.toWei("0.05", "ether") /*_defaultPenalty*/,
          web3.utils.toWei("0.1", "ether") /*_requiredMargin*/,
          identifierBytes,
          web3.utils.toWei("0.01", "ether") /*_fixedYearlyFee*/,
          web3.utils.toWei("0.05", "ether") /*_disputeDeposit*/,
          noLeverageCalculator.address /*_returnCalculator*/,
          web3.utils.toWei("1", "picoether") /*_startingTokenPrice*/,
          "0",
          { from: sponsor }
        )
      )
    );

    // Expiry time before current time.
    const currentTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];
    assert(
      await didContractThrow(
        tokenizedDerivativeCreator.createTokenizedDerivative(
          sponsor,
          admin,
          web3.utils.toWei("0.05", "ether") /*_defaultPenalty*/,
          web3.utils.toWei("0.1", "ether") /*_requiredMargin*/,
          identifierBytes,
          web3.utils.toWei("0.01", "ether") /*_fixedYearlyFee*/,
          web3.utils.toWei("0.05", "ether") /*_disputeDeposit*/,
          noLeverageCalculator.address /*_returnCalculator*/,
          web3.utils.toWei("1", "ether") /*_startingTokenPrice*/,
          web3.utils.toBN(currentTime).subn(1).toString(),
          { from: sponsor }
        )
      )
    );
  });
});
