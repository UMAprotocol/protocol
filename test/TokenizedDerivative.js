const { didContractThrow } = require("./utils/DidContractThrow.js");

var TokenizedDerivative = artifacts.require("TokenizedDerivative");
var Registry = artifacts.require("Registry");
var Oracle = artifacts.require("OracleMock");
var TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
var NoLeverage = artifacts.require("NoLeverage");
const BigNumber = require("bignumber.js");

contract("TokenizedDerivative", function(accounts) {
  var derivativeContract;
  var deployedRegistry;
  var deployedOracle;
  var tokenizedDerivativeCreator;
  var noLeverageCalculator;

  var ownerAddress = accounts[0];
  var provider = accounts[1];
  var investor = accounts[2];
  var thirdParty = accounts[3];

  var computeNewNav = (previousNav, priceReturn, fees) => {
    var expectedReturnWithFees = priceReturn.sub(fees);
    var retVal = BigNumber(web3.utils.fromWei(expectedReturnWithFees.mul(previousNav), "ether"));
    var flooredRetVal = retVal.integerValue(BigNumber.ROUND_FLOOR);
    return web3.utils.toBN(flooredRetVal);
  };

  var computeExpectedPenalty = (navToPenalize, penaltyPercentage) => {
    return web3.utils.toBN(web3.utils.fromWei(navToPenalize.mul(penaltyPercentage), "ether"));
  };

  before(async function() {
    // Set the deployed registry and oracle.
    deployedRegistry = await Registry.deployed();
    deployedOracle = await Oracle.deployed();
    tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    noLeverageCalculator = await NoLeverage.deployed();

    // Set two unverified prices to get the unverified feed slightly ahead of the verified feed.
    await deployedOracle.addUnverifiedPrice(web3.utils.toWei("1", "ether"), { from: ownerAddress });
    await deployedOracle.addVerifiedPrice(web3.utils.toWei("1", "ether"), { from: ownerAddress });
  });

  beforeEach(async () => {
    await deployedOracle.addUnverifiedPrice(web3.utils.toWei("1", "ether"), { from: ownerAddress });

    // Create a quick expiry for testing purposes. It is set to the current unverified feed time plus 2 oracle time
    // steps. Note: Make sure all tests end with same number of unverified/verified prices then this function will
    // add one additional unverified price
    expiry = (await deployedOracle.latestUnverifiedPrice())[0].addn(120);

    await tokenizedDerivativeCreator.createTokenizedDerivative(
      provider,
      investor,
      web3.utils.toWei("0.05", "ether"),
      web3.utils.toWei("0.05", "ether"),
      web3.utils.toWei("0.1", "ether"),
      "ETH/USD",
      web3.utils.toWei("0.01", "ether"),
      web3.utils.toWei("0.05", "ether"),
      noLeverageCalculator.address,
      web3.utils.toWei("1", "ether"),
      { from: provider }
    );

    var numRegisteredContracts = await deployedRegistry.getNumRegisteredContractsBySender({ from: provider });
    var derivativeAddress = await deployedRegistry.getRegisteredContractBySender(
      numRegisteredContracts.subn(1).toString(),
      { from: provider }
    );
    derivativeContract = await TokenizedDerivative.at(derivativeAddress);
  });

  it("Live -> Default -> Settled", async function() {
    var state = await derivativeContract.state();
    var tokensOutstanding = await derivativeContract.totalSupply();
    var nav = await derivativeContract.nav();

    // TODO: add a javascript lib that will map from enum name to uint value.
    // '0' == State.Live
    assert.equal(state.toString(), "0");
    assert.equal(tokensOutstanding.toString(), "0");
    assert.equal(nav.toString(), "0");

    var providerStruct = await derivativeContract.provider();
    var investorStruct = await derivativeContract.investor();

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

    var investorTokenBalance = await derivativeContract.balanceOf(investor);
    var additionalAuthorizedNav = await derivativeContract.additionalAuthorizedNav();
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
    await deployedOracle.addUnverifiedPrice(web3.utils.toWei("2", "ether"), { from: ownerAddress });

    tokensOutstanding = await derivativeContract.totalSupply();

    assert.equal(tokensOutstanding.toString(), web3.utils.toWei("2", "ether"));

    // Compute NAV with fees and expected return on initial price.
    var expectedReturnWithoutFees = web3.utils.toBN(web3.utils.toWei("2", "ether"));
    var feesPerSecond = await derivativeContract.fixedFeePerSecond();
    var feesPerMinute = feesPerSecond.muln(60);
    var expectedNav = computeNewNav(nav, expectedReturnWithoutFees, feesPerMinute);

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

    var initialContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));

    // Attempt redemption of half of the tokens.
    await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: investor });
    await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: investor });

    nav = await derivativeContract.nav();

    // Verify token deduction and ETH payout.
    totalSupply = await derivativeContract.totalSupply();
    investorStruct = await derivativeContract.investor();
    var allowance = await derivativeContract.allowance(investor, derivativeContract.address);
    var newContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));

    expectedNav = expectedNav.divn(2);
    assert.equal(totalSupply.toString(), web3.utils.toWei("1", "ether"));
    assert.equal(investorStruct[1].toString(), expectedNav.toString());
    assert.equal(nav.toString(), expectedNav.toString());
    assert.equal(allowance.toString(), "0");

    var expectedBalanceChange = expectedNav;
    var actualBalanceChange = initialContractBalance.sub(newContractBalance);
    assert.equal(actualBalanceChange.toString(), expectedBalanceChange.toString());

    // Force the provider into default by further increasing the unverified price.
    providerStruct = await derivativeContract.provider();
    await deployedOracle.addUnverifiedPrice(web3.utils.toWei("2.6", "ether"), { from: ownerAddress });
    await derivativeContract.remargin({ from: investor });

    // Add an unverified price to ensure that post-default the contract ceases updating.
    await deployedOracle.addUnverifiedPrice(web3.utils.toWei("10.0", "ether"), { from: ownerAddress });

    // Compute the expected new NAV and compare.
    expectedNav = computeNewNav(nav, web3.utils.toBN(web3.utils.toWei("1.3", "ether")), feesPerMinute);
    var expectedPenalty = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));

    var expectedNavChange = expectedNav.sub(nav);
    state = await derivativeContract.state();
    nav = await derivativeContract.nav();
    var initialProviderBalance = providerStruct[1];
    providerStruct = await derivativeContract.provider();
    var providerBalancePostRemargin = providerStruct[1];

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

    assert.equal(state.toString(), "5");

    // Now that the contract is settled, verify that all parties can extract their tokens/balances.
    providerStruct = await derivativeContract.provider();
    investorStruct = await derivativeContract.investor();
    var providerBalancePostSettlement = providerStruct[1];
    var expectedBalance = providerBalancePostRemargin.sub(expectedPenalty);
    assert.equal(providerBalancePostSettlement.toString(), expectedBalance.toString());

    initialContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    await derivativeContract.withdraw(providerBalancePostSettlement.toString(), { from: provider });
    newContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    assert.equal(initialContractBalance.sub(newContractBalance).toString(), providerBalancePostSettlement.toString());

    // Investor should never be able to use the withdraw function.
    assert(await didContractThrow(derivativeContract.withdraw(investorStruct[1].toString(), { from: investor })));

    // Tokens should be able to be transferred post-settlement. Anyone should be able to redeem them for the frozen price.
    var remainingBalance = await derivativeContract.balanceOf(investor);
    await derivativeContract.transfer(thirdParty, remainingBalance.toString(), { from: investor });

    await derivativeContract.approve(derivativeContract.address, remainingBalance.toString(), { from: thirdParty });
    initialContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    var initialUserBalance = web3.utils.toBN(await web3.eth.getBalance(thirdParty));
    await derivativeContract.redeemTokens(remainingBalance.toString(), { from: thirdParty });
    newContractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    var newUserBalance = web3.utils.toBN(await web3.eth.getBalance(thirdParty));

    assert.equal(initialContractBalance.sub(newContractBalance).toString(), nav.add(expectedPenalty).toString());

    // 1 means that newUserBalance > initialUserBalance - the user's balance increased.
    assert.equal(newUserBalance.cmp(initialUserBalance), 1);

    // Contract should be empty.
    assert.equal(newContractBalance.toString(), "0");

    await deployedOracle.addVerifiedPrice(web3.utils.toWei("1", "ether"), { from: ownerAddress });
    await deployedOracle.addVerifiedPrice(web3.utils.toWei("2", "ether"), { from: ownerAddress });
    await deployedOracle.addVerifiedPrice(web3.utils.toWei("2.6", "ether"), { from: ownerAddress });
    await deployedOracle.addVerifiedPrice(web3.utils.toWei("10", "ether"), { from: ownerAddress });
  });

  it("Live -> Terminate -> Settled", async function() {
    // Provider initializes contract
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.4", "ether") });
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    var nav = await derivativeContract.nav();

    await deployedOracle.addUnverifiedPrice(web3.utils.toWei("1.1", "ether"), { from: ownerAddress });

    // Move the contract into termination.
    var fee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
    await derivativeContract.terminate({ from: provider, value: fee.toString() });
    var state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Only the counterparty needs to confirm after a terminate to push the contract into settlement.
    await derivativeContract.confirmPrice({ from: investor });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "5");

    // The NAV should have updated based on the new price that came in pre-termination.
    nav = await derivativeContract.nav();
    assert.notEqual(nav.toString(), web3.utils.toWei("1", "ether"));

    var investorStruct = await derivativeContract.investor();
    var expectedInvestorBalance = nav.add(fee);
    assert.equal(investorStruct[1].toString(), expectedInvestorBalance.toString());

    var providerStruct = await derivativeContract.provider();
    var contractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    assert.equal(contractBalance.toString(), providerStruct[1].add(expectedInvestorBalance).toString());

    // Redeem tokens and withdraw money.
    await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: investor });
    await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: investor });
    await derivativeContract.withdraw(providerStruct[1].toString(), { from: provider });

    contractBalance = web3.utils.toBN(await web3.eth.getBalance(derivativeContract.address));
    assert.equal(contractBalance.toString(), "0");

    await deployedOracle.addVerifiedPrice(web3.utils.toWei("1", "ether"), { from: ownerAddress });
    await deployedOracle.addVerifiedPrice(web3.utils.toWei("1.1", "ether"), { from: ownerAddress });
  });

  it("Live -> Dispute (correctly) -> Settled", async function() {
    // Provider initializes contract
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.4", "ether") });
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    var nav = await derivativeContract.nav();
    await deployedOracle.addUnverifiedPrice(web3.utils.toWei("1.1", "ether"), { from: ownerAddress });

    // Dispute the price.
    var disputeFee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
    await derivativeContract.dispute({ from: investor, value: disputeFee.toString() });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "1");

    // Add verified prices.
    await deployedOracle.addVerifiedPrice(web3.utils.toWei("0.9", "ether"), { from: ownerAddress });
    await deployedOracle.addVerifiedPrice(web3.utils.toWei("1.1", "ether"), { from: ownerAddress });

    // Settle with the verified price.
    var presettlementNav = await derivativeContract.nav();
    var presettlementProviderBalance = (await derivativeContract.provider())[1];
    await derivativeContract.settle({ from: thirdParty });
    nav = await derivativeContract.nav();

    var providerStruct = await derivativeContract.provider();
    var investorStruct = await derivativeContract.investor();

    // Verify that the dispute fee went to the counterparty and that the NAV changed.
    assert.notEqual(presettlementNav.toString(), nav.toString());
    assert.equal(investorStruct[1].toString(), nav.toString());
    var navDiff = nav.sub(presettlementNav);
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
    // Provider initializes contract
    await derivativeContract.deposit({ from: provider, value: web3.utils.toWei("0.4", "ether") });
    await derivativeContract.authorizeTokens(web3.utils.toWei("1", "ether"), {
      from: provider,
      value: web3.utils.toWei("0.1", "ether")
    });
    await derivativeContract.createTokens(true, { from: investor, value: web3.utils.toWei("1", "ether") });

    var nav = await derivativeContract.nav();

    await deployedOracle.addUnverifiedPrice(web3.utils.toWei("1.1", "ether"), { from: ownerAddress });

    // Dispute the current price.
    var disputeFee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
    await derivativeContract.dispute({ from: investor, value: disputeFee.toString() });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "1");

    // Add verified prices.
    await deployedOracle.addVerifiedPrice(web3.utils.toWei("1", "ether"), { from: ownerAddress });
    await deployedOracle.addVerifiedPrice(web3.utils.toWei("1.1", "ether"), { from: ownerAddress });

    // Settle with the verified price.
    var presettlementNav = await derivativeContract.nav();
    var presettlementProviderBalance = (await derivativeContract.provider())[1];
    await derivativeContract.settle({ from: thirdParty });
    nav = await derivativeContract.nav();

    var providerStruct = await derivativeContract.provider();
    var investorStruct = await derivativeContract.investor();

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
});
