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
  let productSymbolBytes;
  let derivativeContract;
  let deployedRegistry;
  let deployedCentralizedOracle;
  let deployedManualPriceFeed;
  let tokenizedDerivativeCreator;
  let noLeverageCalculator;

  const ownerAddress = accounts[0];
  const provider = accounts[1];
  const investor = accounts[2];
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
    await deployedManualPriceFeed.pushLatestPrice(productSymbolBytes, latestTime, price);
  };

  const deployNewTokenizedDerivative = async expiryDelay => {
    await pushPrice(web3.utils.toWei("1", "ether"));
    const startTime = (await deployedManualPriceFeed.latestPrice(productSymbolBytes))[0];

    let expiry = 0;
    if (expiryDelay != undefined) {
      expiry = startTime.addn(expiryDelay);
    }

    await tokenizedDerivativeCreator.createTokenizedDerivative(
      provider,
      investor,
      web3.utils.toWei("0.05", "ether") /*_defaultPenalty*/,
      web3.utils.toWei("0.1", "ether") /*_providerRequiredMargin*/,
      productSymbolBytes,
      web3.utils.toWei("0.01", "ether") /*_fixedYearlyFee*/,
      web3.utils.toWei("0.05", "ether") /*_disputeDeposit*/,
      noLeverageCalculator.address /*_returnCalculator*/,
      web3.utils.toWei("1", "ether") /*_startingTokenPrice*/,
      expiry.toString(),
      { from: provider }
    );

    const numRegisteredContracts = await deployedRegistry.getNumRegisteredContractsBySender({ from: provider });
    const derivativeAddress = await deployedRegistry.getRegisteredContractBySender(
      numRegisteredContracts.subn(1).toString(),
      { from: provider }
    );
    derivativeContract = await TokenizedDerivative.at(derivativeAddress);

    const feesPerSecond = await derivativeContract.fixedFeePerSecond();
    feesPerInterval = feesPerSecond.muln(priceFeedUpdatesInterval);
  };

  before(async function() {
    productSymbolBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("ETH/USD"));
    // Set the deployed registry and oracle.
    deployedRegistry = await Registry.deployed();
    deployedCentralizedOracle = await CentralizedOracle.deployed();
    deployedManualPriceFeed = await ManualPriceFeed.deployed();
    tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    noLeverageCalculator = await NoLeverage.deployed();

    // Make sure the Oracle and PriceFeed support the underlying product.
    await deployedCentralizedOracle.addSupportedSymbol(productSymbolBytes);
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

    let providerStruct = await derivativeContract.provider();
    let investorStruct = await derivativeContract.investor();

    assert.equal(providerStruct[0], provider);
    assert.equal(investorStruct[0].investor);

    // Ensure the balance of the provider is 0 ETH (as is deposited in beforeEach()).
    assert.equal(providerStruct[1].toString(), web3.utils.toWei("0", "ether"));

    // Check that the deposit function correctly credits the provider account.
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.2", "ether") });
    providerStruct = await derivativeContract.provider();
    assert.equal(providerStruct[1].toString(), web3.utils.toWei("0.2", "ether"));

    // Check that the withdraw function correctly withdraws from the provider account.
    await derivativeContract.withdraw(web3.utils.toWei("0.1", "ether"), { from: provider });
    providerStruct = await derivativeContract.provider();
    assert.equal(providerStruct[1].toString(), web3.utils.toWei("0.1", "ether"));

    // Contract doesn't have enough of a deposit to authorize that 2 ETH worth of new tokens.
    assert(
      await didContractThrow(derivativeContract.authorizeTokens(web3.utils.toWei("2", "ether"), { from: provider }))
    );

    // Succeeds when we send enough ETH to cover the additional margin.
    await derivativeContract.authorizeTokens(web3.utils.toWei("2", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });

    // Fails because exact is true with a requested NAV of 3 ETH, but authorized NAV is only 2 ETH.
    assert(
      await didContractThrow(
        derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("3", "ether") })
      )
    );

    // Fails because the provider is not allowed to create tokens.
    assert(
      await didContractThrow(
        derivativeContract.createTokens(true, { from: provider, value: web3.utils.toWei("1", "ether") })
      )
    );

    // Succeeds because exact is true and requested NAV (1 ETH) is within the authorized NAV (2 ETH).
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    let investorTokenBalance = await derivativeContract.balanceOf(investor);
    let additionalAuthorizedNav = await derivativeContract.additionalAuthorizedNav();
    investorStruct = await derivativeContract.investor();
    nav = await derivativeContract.nav();

    assert.equal(investorTokenBalance.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(additionalAuthorizedNav.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(investorStruct[1].toString(), web3.utils.toWei("1", "ether"));
    assert.equal(nav.toString(), web3.utils.toWei("1", "ether"));

    // Succeeds, but should only provide up to the max authorized NAV, which is 1 ETH, since exact is false.
    await derivativeContract.createTokens(false, { from: investor, value: web3.utils.toWei("3", "ether") });

    investorTokenBalance = await derivativeContract.balanceOf(investor);
    additionalAuthorizedNav = await derivativeContract.additionalAuthorizedNav();
    investorStruct = await derivativeContract.investor();
    nav = await derivativeContract.nav();

    assert.equal(investorTokenBalance.toString(), web3.utils.toWei("2", "ether"));
    assert.equal(additionalAuthorizedNav.toString(), web3.utils.toWei("0", "ether"));
    assert.equal(investorStruct[1].toString(), web3.utils.toWei("2", "ether"));
    assert.equal(nav.toString(), web3.utils.toWei("2", "ether"));

    // This number was chosen so that once the price doubles, the provider will not default.
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("2.6", "ether") });

    providerStruct = await derivativeContract.provider();

    assert.equal(providerStruct[1].toString(), web3.utils.toWei("2.8", "ether"));

    // Change the price to ensure the new NAV and redemption value is computed correctly.
    await pushPrice(web3.utils.toWei("2", "ether"));

    tokensOutstanding = await derivativeContract.totalSupply();

    assert.equal(tokensOutstanding.toString(), web3.utils.toWei("2", "ether"));

    // Compute NAV with fees and expected return on initial price.
    let expectedReturnWithoutFees = web3.utils.toBN(web3.utils.toWei("2", "ether"));
    let expectedNav = computeNewNav(nav, expectedReturnWithoutFees, feesPerInterval);

    // Remargin to the new price.
    await derivativeContract.remargin({ from: provider });

    // Ensure that a remargin with no new price works appropriately and doesn't create any balance issues.
    await derivativeContract.remargin({ from: provider });

    // Check new nav after price change.
    nav = await derivativeContract.nav();
    investorStruct = await derivativeContract.investor();

    assert.equal(nav.toString(), expectedNav.toString());
    assert.equal(investorStruct[1].toString(), expectedNav.toString());

    // Should fail because the ERC20 tokens have not been authorized.
    assert(await didContractThrow(derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: investor })));

    let initialContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));

    // Attempt redemption of half of the tokens.
    await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: investor });
    await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: investor });

    nav = await derivativeContract.nav();

    // Verify token deduction and ETH payout.
    totalSupply = await derivativeContract.totalSupply();
    investorStruct = await derivativeContract.investor();
    let allowance = await derivativeContract.allowance(investor, derivativeContract.address);
    let newContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));

    expectedNav = expectedNav.divn(2);
    assert.equal(totalSupply.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(investorStruct[1].toString(), expectedNav.toString());
    assert.equal(nav.toString(), expectedNav.toString());
    assert.equal(allowance.toString(), "0");

    let expectedBalanceChange = expectedNav;
    let actualBalanceChange = initialContractBalance.sub(newContractBalance);
    assert.equal(actualBalanceChange.toString(), expectedBalanceChange.toString());

    // Force the provider into default by further increasing the unverified price.
    providerStruct = await derivativeContract.provider();
    await pushPrice(web3.utils.toWei("2.6", "ether"));
    await derivativeContract.remargin({ from: investor });

    // Add an unverified price to ensure that post-default the contract ceases updating.
    await pushPrice(web3.utils.toWei("10.0", "ether"));

    // Compute the expected new NAV and compare.
    expectedNav = computeNewNav(nav, web3.utils.toBN(web3.utils.toWei("1.3", "ether")), feesPerInterval);
    let expectedPenalty = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));

    let expectedNavChange = expectedNav.sub(nav);
    state = await derivativeContract.state();
    nav = await derivativeContract.nav();
    let initialProviderBalance = providerStruct[1];
    providerStruct = await derivativeContract.provider();
    let providerBalancePostRemargin = providerStruct[1];

    assert.equal(state.toString(), "3");
    assert.equal(nav.toString(), expectedNav.toString());
    assert.equal(initialProviderBalance.sub(providerBalancePostRemargin).toString(), expectedNavChange.toString());

    // Verify that after both parties confirm, the state is moved to settled.
    await derivativeContract.confirmPrice({ from: investor });
    assert(
      await didContractThrow(derivativeContract.withdraw(providerBalancePostRemargin.toString(), { from: provider }))
    );
    assert(await didContractThrow(derivativeContract.confirmPrice({ from: thirdParty })));
    await derivativeContract.confirmPrice({ from: provider });

    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Now that the contract is settled, verify that all parties can extract their tokens/balances.
    providerStruct = await derivativeContract.provider();
    investorStruct = await derivativeContract.investor();
    let providerBalancePostSettlement = providerStruct[1];
    let expectedBalance = providerBalancePostRemargin.sub(expectedPenalty);
    assert.equal(providerBalancePostSettlement.toString(), expectedBalance.toString());

    initialContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    await derivativeContract.withdraw(providerBalancePostSettlement.toString(), { from: provider });
    newContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    assert.equal(initialContractBalance.sub(newContractBalance).toString(), providerBalancePostSettlement.toString());

    // Investor should never be able to use the withdraw function.
    assert(await didContractThrow(derivativeContract.withdraw(investorStruct[1].toString(), { from: investor })));

    // Tokens should be able to be transferred post-settlement. Anyone should be able to redeem them for the frozen price.
    let remainingBalance = await derivativeContract.balanceOf(investor);
    await derivativeContract.transfer(thirdParty, remainingBalance.toString(), { from: investor });

    await derivativeContract.approve(derivativeContract.address, remainingBalance.toString(), { from: thirdParty });
    initialContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    let initialUserBalance = web3.utils.toBN(await web3.eth.getBalance(thirdParty));
    await derivativeContract.redeemTokens(remainingBalance.toString(), { from: thirdParty });
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

    // Provider initializes the contract.
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.2", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    // The price increases, forcing the provider into default.
    const navPreDefault = await derivativeContract.nav();
    await pushPrice(web3.utils.toWei("1.1", "ether"));
    const defaultTime = (await deployedManualPriceFeed.latestPrice(productSymbolBytes))[0];

    // Remargin to the new price, and verify that the contract is pushed into default.
    await derivativeContract.remargin({ from: investor });
    assert.equal((await derivativeContract.state()).toString(), "3");

    const timeBasedFees = BigNumber(web3.utils.fromWei(feesPerInterval)).times(BigNumber(navPreDefault));

    // Verify NAV and balances after default but before settlement. These should reflect the price feed price, and no
    // default penalty should be charged yet.
    const expectedNavPostDefault = computeNewNav(
      navPreDefault,
      web3.utils.toBN(web3.utils.toWei("1.1", "ether")),
      feesPerInterval
    );
    let expectedInvestorAccountBalanceWithoutFees = BigNumber(web3.utils.toWei("1.1", "ether"));
    let expectedProviderAccountBalanceWithoutFees = BigNumber(web3.utils.toWei("0.1", "ether"));
    const actualNavPostDefault = await derivativeContract.nav();
    let investorStruct = await derivativeContract.investor();
    let providerStruct = await derivativeContract.provider();
    assert.equal(actualNavPostDefault.toString(), expectedNavPostDefault.toString());
    assert.equal(
      investorStruct[1].toString(),
      expectedInvestorAccountBalanceWithoutFees.minus(timeBasedFees).toString()
    );
    assert.equal(
      providerStruct[1].toString(),
      expectedProviderAccountBalanceWithoutFees.plus(timeBasedFees).toString()
    );

    // Nobody confirms anything, just wait for the Oracle. This is a different price from the price feed.
    // In fact, the provider isn't in default with this new price, but the contract still terminates.
    await deployedCentralizedOracle.pushPrice(productSymbolBytes, defaultTime, web3.utils.toWei("1.05", "ether"));

    // The contract should be settled.
    await derivativeContract.settle();
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Verify NAV and balances at settlement. No default penalty should be paid.
    const expectedNavAtSettle = computeNewNav(
      navPreDefault,
      web3.utils.toBN(web3.utils.toWei("1.05", "ether")),
      feesPerInterval
    );
    expectedInvestorAccountBalanceWithoutFees = BigNumber(web3.utils.toWei("1.05", "ether"));
    expectedProviderAccountBalanceWithoutFees = BigNumber(web3.utils.toWei("0.15", "ether"));
    const actualNavAtSettle = await derivativeContract.nav();
    investorStruct = await derivativeContract.investor();
    providerStruct = await derivativeContract.provider();
    assert.equal(actualNavAtSettle.toString(), expectedNavAtSettle.toString());
    assert.equal(
      investorStruct[1].toString(),
      expectedInvestorAccountBalanceWithoutFees.minus(timeBasedFees).toString()
    );
    assert.equal(
      providerStruct[1].toString(),
      expectedProviderAccountBalanceWithoutFees.plus(timeBasedFees).toString()
    );
  });

  it("Live -> Default -> Settled (oracle) [price available]", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    await deployNewTokenizedDerivative();

    // Provider initializes contract.
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.2", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    // The price increases, forcing the provider into default.
    const navPreDefault = await derivativeContract.nav();
    await pushPrice(web3.utils.toWei("1.1", "ether"));
    const defaultTime = (await deployedManualPriceFeed.latestPrice(productSymbolBytes))[0];

    // The Oracle price is already available.
    await deployedCentralizedOracle.getPrice(productSymbolBytes, defaultTime);
    await deployedCentralizedOracle.pushPrice(productSymbolBytes, defaultTime, web3.utils.toWei("1.1", "ether"));

    // Remargin to the new price, which should immediately settle the contract.
    await derivativeContract.remargin({ from: investor });
    assert.equal((await derivativeContract.state()).toString(), "4");

    // Verify NAV and balances at settlement. A default penalty should be paid.
    const timeBasedFees = BigNumber(web3.utils.fromWei(feesPerInterval)).times(BigNumber(navPreDefault));
    const defaultPenalty = computeExpectedPenalty(navPreDefault, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
    const expectedNavPostDefault = computeNewNav(
      navPreDefault,
      web3.utils.toBN(web3.utils.toWei("1.1", "ether")),
      feesPerInterval
    );
    const expectedInvestorAccountBalanceWithoutFees = BigNumber(web3.utils.toWei("1.1", "ether"));
    const expectedProviderAccountBalanceWithoutFees = BigNumber(web3.utils.toWei("0.1", "ether"));
    const actualNavPostDefault = await derivativeContract.nav();
    const investorStruct = await derivativeContract.investor();
    const providerStruct = await derivativeContract.provider();
    assert.equal(actualNavPostDefault.toString(), expectedNavPostDefault.toString());
    assert.equal(
      investorStruct[1].toString(),
      expectedInvestorAccountBalanceWithoutFees
        .minus(timeBasedFees)
        .plus(defaultPenalty)
        .toString()
    );
    assert.equal(
      providerStruct[1].toString(),
      expectedProviderAccountBalanceWithoutFees
        .plus(timeBasedFees)
        .minus(defaultPenalty)
        .toString()
    );
  });

  it("Live -> Dispute (correctly) [price available] -> Settled", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    await deployNewTokenizedDerivative();

    // Provider initializes contract
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.4", "ether") });
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    let nav = await derivativeContract.nav();
    const disputeTime = (await deployedManualPriceFeed.latestPrice(productSymbolBytes))[0];
    // Provide oracle price for the disputed time.
    await deployedCentralizedOracle.getPrice(productSymbolBytes, disputeTime);
    await deployedCentralizedOracle.pushPrice(productSymbolBytes, disputeTime, web3.utils.toWei("0.9", "ether"));

    // Pushing these prices doesn't remargin the contract, so it doesn't affect what we dispute.
    await pushPrice(web3.utils.toWei("1.1", "ether"));

    // Dispute the price.
    const presettlementNav = await derivativeContract.nav();
    const presettlementProviderBalance = (await derivativeContract.provider())[1];

    const disputeFee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
    await derivativeContract.dispute({ from: investor, value: disputeFee.toString() });

    // Auto-settles with the Oracle price.
    assert.equal((await derivativeContract.state()).toString(), "4");
    nav = await derivativeContract.nav();

    const providerStruct = await derivativeContract.provider();
    const investorStruct = await derivativeContract.investor();

    // Verify that the dispute fee went to the counterparty and that the NAV changed.
    assert.notEqual(presettlementNav.toString(), nav.toString());
    assert.equal(investorStruct[1].toString(), nav.toString());
    const navDiff = nav.sub(presettlementNav);
    assert.equal(
      providerStruct[1].toString(),
      presettlementProviderBalance
        .sub(navDiff)
        .add(disputeFee)
        .toString()
    );

    // Redeem tokens and withdraw money.
    await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: investor });
    await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: investor });
    await derivativeContract.withdraw(providerStruct[1].toString(), { from: provider });

    contractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    assert.equal(contractBalance.toString(), "0");
  });

  it("Live -> Dispute (incorrectly) -> Settled", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    await deployNewTokenizedDerivative();

    // Provider initializes contract
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.4", "ether") });
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    let nav = await derivativeContract.nav();

    const disputeTime = (await deployedManualPriceFeed.latestPrice(productSymbolBytes))[0];
    // Dispute the current price.
    let disputeFee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
    await derivativeContract.dispute({ from: investor, value: disputeFee.toString() });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "1");

    // Provide the Oracle price.
    await deployedCentralizedOracle.pushPrice(productSymbolBytes, disputeTime, web3.utils.toWei("1", "ether"));

    // Settle with the Oracle price.
    let presettlementNav = await derivativeContract.nav();
    let presettlementProviderBalance = (await derivativeContract.provider())[1];
    await derivativeContract.settle({ from: thirdParty });

    // Verify that you can't call dispute once the contract is settled.
    assert(didContractThrow(derivativeContract.dispute()));

    nav = await derivativeContract.nav();
    let providerStruct = await derivativeContract.provider();
    let investorStruct = await derivativeContract.investor();

    // Verify that the dispute fee was refunded and the nav didn't change.
    assert.equal(presettlementNav.toString(), nav.toString());
    assert.equal(investorStruct[1].toString(), nav.add(disputeFee).toString());

    // Provider should have the exact same amount of ETH that they deposited (one deposit was part of the
    // authorizeTokens() call).
    assert.equal(providerStruct[1].toString(), web3.utils.toWei("0.5", "ether"));

    // Redeem tokens and withdraw money.
    await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: investor });
    await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: investor });
    await derivativeContract.withdraw(providerStruct[1].toString(), { from: provider });

    contractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    assert.equal(contractBalance.toString(), "0");
  });

  it("Live -> Expired -> Settled (oracle price)", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    // One time step until expiry.
    await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

    // Provider initializes contract
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.4", "ether") });
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    // Verify initial state.
    const initialNav = await derivativeContract.nav();
    let investorStruct = await derivativeContract.investor();
    let providerStruct = await derivativeContract.provider();
    assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(investorStruct[1].toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
    assert.equal(providerStruct[1].toString(), web3.utils.toBN(web3.utils.toWei("0.5", "ether")));
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Push the contract to expiry. and provide Oracle price beforehand.
    await pushPrice(web3.utils.toWei("100", "ether"));
    const expirationTime = await deployedManualPriceFeed.getCurrentTime();

    // Contract should go to expired.
    await derivativeContract.remargin({ from: provider });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "2");

    // Verify that you can't call settle before the Oracle provides a price.
    assert(didContractThrow(derivativeContract.dispute()));

    // Then the Oracle price should be provided, which settles the contract.
    await deployedCentralizedOracle.pushPrice(productSymbolBytes, expirationTime, web3.utils.toWei("1.1", "ether"));
    await derivativeContract.settle();
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Verify nav and balances at settlement.
    let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
    let changeInNav = expectedSettlementNav.sub(initialNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = investorStruct[1].add(changeInNav);
    expectedProviderAccountBalance = providerStruct[1].sub(changeInNav);
    investorStruct = await derivativeContract.investor();
    providerStruct = await derivativeContract.provider();
    assert.equal(actualNav.toString(), expectedSettlementNav.toString());
    assert.equal(investorStruct[1].toString(), expectedInvestorAccountBalance.toString());
    assert.equal(providerStruct[1].toString(), expectedProviderAccountBalance.toString());
  });

  it("Live -> Expired -> Settled (oracle price) [price available]", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    // One time step until expiry.
    await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

    // Provider initializes contract
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.4", "ether") });
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    // Verify initial state.
    const initialNav = await derivativeContract.nav();
    let investorStruct = await derivativeContract.investor();
    let providerStruct = await derivativeContract.provider();
    assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(investorStruct[1].toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
    assert.equal(providerStruct[1].toString(), web3.utils.toBN(web3.utils.toWei("0.5", "ether")));
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Push the contract to expiry, and provide Oracle price beforehand.
    await pushPrice(web3.utils.toWei("100", "ether"));
    const expirationTime = await deployedManualPriceFeed.getCurrentTime();
    await deployedCentralizedOracle.getPrice(productSymbolBytes, expirationTime);
    await deployedCentralizedOracle.pushPrice(productSymbolBytes, expirationTime, web3.utils.toWei("1.1", "ether"));

    // Contract should go straight to settled.
    await derivativeContract.remargin({ from: provider });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Verify nav and balances at settlement.
    let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
    let changeInNav = expectedSettlementNav.sub(initialNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = investorStruct[1].add(changeInNav);
    expectedProviderAccountBalance = providerStruct[1].sub(changeInNav);
    investorStruct = await derivativeContract.investor();
    providerStruct = await derivativeContract.provider();
    assert.equal(actualNav.toString(), expectedSettlementNav.toString());
    assert.equal(investorStruct[1].toString(), expectedInvestorAccountBalance.toString());
    assert.equal(providerStruct[1].toString(), expectedProviderAccountBalance.toString());
  });

  it("Live -> Remargin -> Remargin -> Expired -> Settled (oracle price)", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    // Three time steps until expiry.
    await deployNewTokenizedDerivative(priceFeedUpdatesInterval * 3);

    // Provider initializes contract
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.4", "ether") });
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    // Verify initial nav and balances. No time based fees have been assessed yet.
    let expectedNav = web3.utils.toBN(web3.utils.toWei("1", "ether"));
    let actualNav = await derivativeContract.nav();
    let investorStruct = await derivativeContract.investor();
    let providerStruct = await derivativeContract.provider();
    assert.equal(actualNav.toString(), expectedNav.toString());
    assert.equal(investorStruct[1].toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
    assert.equal(providerStruct[1].toString(), web3.utils.toBN(web3.utils.toWei("0.5", "ether")));

    // Move the price 10% up.
    await pushPrice(web3.utils.toWei("1.1", "ether"));
    await derivativeContract.remargin({ from: provider });
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Verify nav and balances.
    let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
    let changeInNav = expectedNav.sub(actualNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = investorStruct[1].add(changeInNav);
    expectedProviderAccountBalance = providerStruct[1].sub(changeInNav);
    investorStruct = await derivativeContract.investor();
    providerStruct = await derivativeContract.provider();
    assert.equal(actualNav.toString(), expectedNav.toString());
    assert.equal(investorStruct[1].toString(), expectedInvestorAccountBalance.toString());
    assert.equal(providerStruct[1].toString(), expectedProviderAccountBalance.toString());

    // Move the price another 10% up.
    await pushPrice(web3.utils.toWei("1.21", "ether"));
    await derivativeContract.remargin({ from: provider });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Verify nav and balance.
    priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
    expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
    changeInNav = expectedNav.sub(actualNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = investorStruct[1].add(changeInNav);
    expectedProviderAccountBalance = providerStruct[1].sub(changeInNav);
    investorStruct = await derivativeContract.investor();
    providerStruct = await derivativeContract.provider();
    assert.equal(actualNav.toString(), expectedNav.toString());
    assert.equal(investorStruct[1].toString(), expectedInvestorAccountBalance.toString());
    assert.equal(providerStruct[1].toString(), expectedProviderAccountBalance.toString());

    // Now push to contract into expiry, moving down by 10% (which isn't the same as reversing the previous move).
    await pushPrice(web3.utils.toWei("1.089", "ether"));
    const expirationTime = await deployedManualPriceFeed.getCurrentTime();
    await derivativeContract.remargin({ from: provider });

    // Contract should go to EXPIRED, and then on settle(), go to SETTLED.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "2");
    await deployedCentralizedOracle.pushPrice(productSymbolBytes, expirationTime, web3.utils.toWei("1.089", "ether"));
    await derivativeContract.settle();
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Verify NAV and balances at expiry.
    priceReturn = web3.utils.toBN(web3.utils.toWei("0.9", "ether"));
    expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
    changeInNav = expectedNav.sub(actualNav);
    actualNav = await derivativeContract.nav();
    expectedInvestorAccountBalance = investorStruct[1].add(changeInNav);
    expectedProviderAccountBalance = providerStruct[1].sub(changeInNav);
    investorStruct = await derivativeContract.investor();
    providerStruct = await derivativeContract.provider();
    assert.equal(actualNav.toString(), expectedNav.toString());
    assert.equal(investorStruct[1].toString(), expectedInvestorAccountBalance.toString());
    assert.equal(providerStruct[1].toString(), expectedProviderAccountBalance.toString());
  });

  it("Live -> Create -> Create fails on expiry", async function() {
    // A new TokenizedDerivative must be deployed before the start of each test case.
    // One time step until expiry.
    await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

    // Provider initializes contract
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.4", "ether") });
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    // Authorize some tokens.
    await derivativeContract.authorizeTokens(web3.utils.toWei("2", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });

    // Push time forward, so that the contract will expire when remargin is called.
    await pushPrice(web3.utils.toWei("1", "ether"));

    // Tokens cannot be created because the contract has expired.
    assert(
      didContractThrow(derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") }))
    );
  });

  it("Unsupported product", async function() {
    let unsupportedProduct = web3.utils.hexToBytes(web3.utils.utf8ToHex("unsupported"));
    assert(
      didContractThrow(
        tokenizedDerivativeCreator.createTokenizedDerivative(
          provider,
          investor,
          web3.utils.toWei("0.05", "ether"),
          web3.utils.toWei("0.05", "ether"),
          web3.utils.toWei("0.1", "ether"),
          unsupportedProduct,
          web3.utils.toWei("0.01", "ether"),
          web3.utils.toWei("0.05", "ether"),
          noLeverageCalculator.address,
          web3.utils.toWei("1", "ether"),
          0,
          { from: provider }
        )
      )
    );
  });
});
