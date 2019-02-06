const { didContractThrow } = require("./utils/DidContractThrow.js");

const CentralizedOracle = artifacts.require("CentralizedOracle");
const CentralizedStore = artifacts.require("CentralizedStore");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const Registry = artifacts.require("Registry");
const TokenizedDerivative = artifacts.require("TokenizedDerivative");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");

// Pull in contracts from dependencies.
const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

const BigNumber = require("bignumber.js");

contract("TokenizedDerivative", function(accounts) {
  let identifierBytes;
  let derivativeContract;
  let deployedRegistry;
  let deployedCentralizedOracle;
  let deployedCentralizedStore;
  let deployedManualPriceFeed;
  let tokenizedDerivativeCreator;
  let noLeverageCalculator;
  let marginToken;

  const ownerAddress = accounts[0];
  const sponsor = accounts[1];
  const admin = accounts[2];
  const thirdParty = accounts[3];
  const apDelegate = accounts[4];

  const name = "1x Bitcoin-Ether";
  const symbol = "BTCETH";

  // The ManualPriceFeed can support prices at arbitrary intervals, but for convenience, we send updates at this
  // interval.
  const priceFeedUpdatesInterval = 60;
  let feesPerInterval;

  const oracleFeePerSecond = web3.utils.toBN(web3.utils.toWei("0.0001", "ether"));

  before(async function() {
    identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("ETH/USD"));
    // Set the deployed registry and oracle.
    deployedRegistry = await Registry.deployed();
    deployedCentralizedOracle = await CentralizedOracle.deployed();
    deployedCentralizedStore = await CentralizedStore.deployed();
    deployedManualPriceFeed = await ManualPriceFeed.deployed();
    tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    noLeverageCalculator = await LeveragedReturnCalculator.deployed();

    // Create an arbitrary ERC20 margin token.
    marginToken = await ERC20Mintable.new({ from: sponsor });
    await marginToken.mint(sponsor, web3.utils.toWei("100", "ether"), { from: sponsor });
    await marginToken.mint(apDelegate, web3.utils.toWei("100", "ether"), { from: sponsor });

    // Make sure the Oracle and PriceFeed support the underlying product.
    await deployedCentralizedOracle.addSupportedIdentifier(identifierBytes);
    await deployedManualPriceFeed.setCurrentTime(100000);
    await pushPrice(web3.utils.toWei("1", "ether"));

    // Add the owner to the list of registered derivatives so it's allowed to query oracle prices.
    let creator = accounts[5];
    await deployedRegistry.addDerivativeCreator(creator);
    await deployedRegistry.registerDerivative([], ownerAddress, { from: creator });

    // Set an Oracle fee.
    await deployedCentralizedStore.setFixedOracleFeePerSecond(oracleFeePerSecond);
  });

  const computeNewNav = (previousNav, priceReturn, fees) => {
    const expectedReturnWithFees = priceReturn.sub(fees);
    const retVal = BigNumber(web3.utils.fromWei(expectedReturnWithFees.mul(previousNav), "ether"));
    const flooredRetVal = retVal.integerValue(BigNumber.ROUND_FLOOR);
    return web3.utils.toBN(flooredRetVal);
  };

  const computeExpectedPenalty = (navToPenalize, penaltyPercentage) => {
    return web3.utils.toBN(web3.utils.fromWei(navToPenalize.mul(penaltyPercentage), "ether"));
  };

  const computeExpectedOracleFees = startingNav => {
    const oracleFeeRatio = oracleFeePerSecond.mul(web3.utils.toBN(priceFeedUpdatesInterval));
    return startingNav.mul(oracleFeeRatio).div(web3.utils.toBN(web3.utils.toWei("1", "ether")));
  };

  // Pushes a price to the ManualPriceFeed, incrementing time by `priceFeedUpdatesInterval`.
  const pushPrice = async price => {
    const latestTime = parseInt(await deployedManualPriceFeed.getCurrentTime(), 10) + priceFeedUpdatesInterval;
    await deployedManualPriceFeed.setCurrentTime(latestTime);
    await deployedManualPriceFeed.pushLatestPrice(identifierBytes, latestTime, price);
  };

  // All test cases are run for each "variant" (or test parameterization) listed in this array.
  let testVariants = [{ useErc20: true }, { usrErc20: false }];

  testVariants.forEach(testVariant => {
    // The following function declarations depend on the testVariant. To avoid passing it around, they are declared
    // in this scope so the testVariant is implicitly visible to them.

    // The contract assumes that ETH is the margin currency if passed 0x0 as the margin token address.
    const marginTokenAddress = () => {
      return testVariant.useErc20 ? marginToken.address : "0x0000000000000000000000000000000000000000";
    };

    const deployNewTokenizedDerivative = async expiryDelay => {
      await pushPrice(web3.utils.toWei("1", "ether"));
      const startTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];

      let expiry = 0;
      if (expiryDelay != undefined) {
        expiry = startTime.addn(expiryDelay);
      }

      let constructorParams = {
        sponsor: sponsor,
        admin: admin,
        defaultPenalty: web3.utils.toWei("0.05", "ether"),
        requiredMargin: web3.utils.toWei("0.1", "ether"),
        product: identifierBytes,
        fixedYearlyFee: web3.utils.toWei("0.01", "ether"),
        disputeDeposit: web3.utils.toWei("0.05", "ether"),
        returnCalculator: noLeverageCalculator.address,
        startingTokenPrice: web3.utils.toWei("1", "ether"),
        expiry: expiry.toString(),
        marginCurrency: marginTokenAddress(),
        withdrawLimit: web3.utils.toWei("0.33", "ether"),
        name: name,
        symbol: symbol
      };

      await tokenizedDerivativeCreator.createTokenizedDerivative(constructorParams, { from: sponsor });

      const derivativeArray = await deployedRegistry.getRegisteredDerivatives(sponsor);
      const derivativeAddress = derivativeArray[derivativeArray.length - 1].derivativeAddress;
      derivativeContract = await TokenizedDerivative.at(derivativeAddress);

      const feesPerSecond = web3.utils.toBN(
        (await derivativeContract.derivativeStorage()).fixedParameters.fixedFeePerSecond
      );
      feesPerInterval = feesPerSecond.muln(priceFeedUpdatesInterval);
    };

    const getMarginParams = async (value, sender) => {
      if (sender === undefined) {
        sender = sponsor;
      }

      let callParams = { from: sender };
      if (value) {
        if (testVariant.useErc20) {
          await marginToken.approve(derivativeContract.address, value, { from: sender });
        } else {
          callParams.value = value;
        }
      }
      return callParams;
    };

    const getMarginBalance = async address => {
      if (testVariant.useErc20) {
        return await marginToken.balanceOf(address);
      } else {
        return web3.utils.toBN(await web3.eth.getBalance(address));
      }
    };

    const getContractBalance = async () => {
      return await getMarginBalance(derivativeContract.address);
    };

    const annotateTitle = title => {
      return (testVariant.useErc20 ? "ERC20 Margin | " : "ETH Margin   | ") + title;
    };

    // Test cases.
    it(annotateTitle("Live -> Default -> Settled (confirmed)"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      assert.equal(await derivativeContract.name(), name);
      assert.equal(await derivativeContract.symbol(), symbol);

      let state = (await derivativeContract.derivativeStorage()).state;
      let tokensOutstanding = await derivativeContract.totalSupply();
      let nav = (await derivativeContract.derivativeStorage()).nav;

      // TODO: add a javascript lib that will map from enum name to uint value.
      // '0' == State.Live
      assert.equal(state.toString(), "0");
      assert.equal(tokensOutstanding.toString(), "0");
      assert.equal(nav.toString(), "0");

      let contractSponsor = (await derivativeContract.derivativeStorage()).externalAddresses.sponsor;
      let contractAdmin = (await derivativeContract.derivativeStorage()).externalAddresses.admin;

      assert.equal(contractSponsor, sponsor);
      assert.equal(contractAdmin, admin);

      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      const initialStoreBalance = await getMarginBalance(deployedCentralizedStore.address);
      let totalOracleFeesPaid = web3.utils.toBN(web3.utils.toWei("0", "ether"));

      // Ensure the short balance is 0 ETH (as is deposited in beforeEach()).
      assert.equal(shortBalance.toString(), web3.utils.toWei("0", "ether"));

      // Check that the deposit function correctly credits the short account.
      await derivativeContract.deposit(await getMarginParams(web3.utils.toWei("0.21", "ether")));
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(shortBalance.toString(), web3.utils.toWei("0.21", "ether"));

      // Check that the withdraw function correctly withdraws from the sponsor account.
      await derivativeContract.withdraw(web3.utils.toWei("0.01", "ether"), { from: sponsor });
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(shortBalance.toString(), web3.utils.toWei("0.2", "ether"));

      // Fails because there is not enough short margin for 3 ETH of tokens.
      assert(
        await didContractThrow(derivativeContract.createTokens(await getMarginParams(web3.utils.toWei("3", "ether"))))
      );

      // Fails because the admin is not allowed to create tokens.
      assert(
        await didContractThrow(
          derivativeContract.createTokens(await getMarginParams(web3.utils.toWei("1", "ether"), admin))
        )
      );

      // Succeeds because exact is true and requested NAV (1 ETH) would not cause the short account to go below its
      // margin requirement.
      await derivativeContract.createTokens(await getMarginParams(web3.utils.toWei("1", "ether")));

      let sponsorTokenBalance = await derivativeContract.balanceOf(sponsor);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      nav = (await derivativeContract.derivativeStorage()).nav;

      assert.equal(sponsorTokenBalance.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(longBalance.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(nav.toString(), web3.utils.toWei("1", "ether"));

      // Succeeds because there is enough margin to support an additional 1 ETH of NAV.
      await derivativeContract.createTokens(await getMarginParams(web3.utils.toWei("1", "ether")));

      sponsorTokenBalance = await derivativeContract.balanceOf(sponsor);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      nav = (await derivativeContract.derivativeStorage()).nav;

      assert.equal(sponsorTokenBalance.toString(), web3.utils.toWei("2", "ether"));
      assert.equal(longBalance.toString(), web3.utils.toWei("2", "ether"));
      assert.equal(nav.toString(), web3.utils.toWei("2", "ether"));

      // This number was chosen so that once the price doubles, the sponsor will not default.
      await derivativeContract.deposit(await getMarginParams(web3.utils.toWei("2.6", "ether")));

      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;

      assert.equal(shortBalance.toString(), web3.utils.toWei("2.8", "ether"));

      // Change the price to ensure the new NAV and redemption value is computed correctly.
      await pushPrice(web3.utils.toWei("2", "ether"));

      tokensOutstanding = await derivativeContract.totalSupply();

      assert.equal(tokensOutstanding.toString(), web3.utils.toWei("2", "ether"));

      // Compute NAV with fees and expected return on initial price.
      let expectedReturnWithoutFees = web3.utils.toBN(web3.utils.toWei("2", "ether"));
      let expectedNav = computeNewNav(nav, expectedReturnWithoutFees, feesPerInterval);

      // Remargin to the new price.
      expectedOracleFee = computeExpectedOracleFees((await derivativeContract.derivativeStorage()).nav);
      await derivativeContract.remargin({ from: sponsor });
      totalOracleFeesPaid = totalOracleFeesPaid.add(expectedOracleFee);
      const expectedLastRemarginTime = await deployedManualPriceFeed.getCurrentTime();
      let lastRemarginTime = (await derivativeContract.derivativeStorage()).currentTokenState.time;
      const expectedPreviousRemarginTime = (await derivativeContract.derivativeStorage()).prevTokenState.time;
      assert.equal(lastRemarginTime.toString(), expectedLastRemarginTime.toString());

      // Ensure that a remargin with no new price works appropriately and doesn't create any balance issues.
      // The prevTokenState also shouldn't get blown away.
      await derivativeContract.remargin({ from: admin });
      lastRemarginTime = (await derivativeContract.derivativeStorage()).currentTokenState.time;
      let previousRemarginTime = (await derivativeContract.derivativeStorage()).prevTokenState.time;
      assert.equal(lastRemarginTime.toString(), expectedLastRemarginTime.toString());
      assert.equal(previousRemarginTime.toString(), expectedPreviousRemarginTime.toString());

      // Check new nav after price change.
      nav = (await derivativeContract.derivativeStorage()).nav;
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;

      assert.equal(nav.toString(), expectedNav.toString());
      assert.equal(longBalance.toString(), expectedNav.toString());

      // Should fail because the ERC20 tokens have not been authorized.
      assert(await didContractThrow(derivativeContract.redeemTokens({ from: sponsor })));

      let initialContractBalance = await getContractBalance();

      // Attempt redemption of half of the tokens.
      await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: sponsor });
      await derivativeContract.redeemTokens({ from: sponsor });

      nav = (await derivativeContract.derivativeStorage()).nav;

      // Verify token deduction and ETH payout.
      totalSupply = await derivativeContract.totalSupply();
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let allowance = await derivativeContract.allowance(sponsor, derivativeContract.address);
      let newContractBalance = await getContractBalance();

      expectedNav = expectedNav.divn(2);
      assert.equal(totalSupply.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(longBalance.toString(), expectedNav.toString());
      assert.equal(nav.toString(), expectedNav.toString());
      assert.equal(allowance.toString(), "0");

      let expectedBalanceChange = expectedNav;
      let actualBalanceChange = initialContractBalance.sub(newContractBalance);
      assert.equal(actualBalanceChange.toString(), expectedBalanceChange.toString());

      // Force the sponsor into default by further increasing the unverified price.
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      await pushPrice(web3.utils.toWei("2.6", "ether"));
      expectedOracleFee = computeExpectedOracleFees((await derivativeContract.derivativeStorage()).nav);
      await derivativeContract.remargin({ from: sponsor });
      totalOracleFeesPaid = totalOracleFeesPaid.add(expectedOracleFee);

      // Add an unverified price to ensure that post-default the contract ceases updating.
      await pushPrice(web3.utils.toWei("10.0", "ether"));

      // Compute the expected new NAV and compare.
      expectedNav = computeNewNav(nav, web3.utils.toBN(web3.utils.toWei("1.3", "ether")), feesPerInterval);
      let expectedPenalty = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));

      let expectedNavChange = expectedNav.sub(nav);
      state = (await derivativeContract.derivativeStorage()).state;
      nav = (await derivativeContract.derivativeStorage()).nav;
      let initialSponsorBalance = shortBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      let sponsorBalancePostRemargin = shortBalance;

      assert.equal(state.toString(), "3");

      // Can't call calc* methods on a defaulted contract.
      assert(await didContractThrow(derivativeContract.calcNAV()));
      assert(await didContractThrow(derivativeContract.calcTokenValue()));
      assert(await didContractThrow(derivativeContract.calcShortMarginBalance()));

      assert.equal(nav.toString(), expectedNav.toString());
      // The sponsor's balance decreases, and we have to add the Oracle fee to the amount of decrease.
      assert.equal(
        initialSponsorBalance.sub(sponsorBalancePostRemargin).toString(),
        expectedNavChange.add(expectedOracleFee).toString()
      );

      // Can't call emergency shutdown while in default.
      assert(await didContractThrow(derivativeContract.emergencyShutdown({ from: admin })));

      // Only the sponsor can confirm.
      assert(await didContractThrow(derivativeContract.confirmPrice({ from: admin })));

      // Verify that the sponsor cannot withdraw before settlement.
      assert(
        await didContractThrow(derivativeContract.withdraw(sponsorBalancePostRemargin.toString(), { from: sponsor }))
      );

      // Verify that after the sponsor confirms, the state is moved to settled.
      await derivativeContract.confirmPrice({ from: sponsor });

      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "5");

      // Now that the contract is settled, verify that all parties can extract their tokens/balances.
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let sponsorBalancePostSettlement = shortBalance;
      let expectedBalance = sponsorBalancePostRemargin.sub(expectedPenalty);
      assert.equal(sponsorBalancePostSettlement.toString(), expectedBalance.toString());

      initialContractBalance = await getContractBalance();
      await derivativeContract.withdraw(sponsorBalancePostSettlement.toString(), { from: sponsor });
      newContractBalance = await getContractBalance();
      assert.equal(initialContractBalance.sub(newContractBalance).toString(), sponsorBalancePostSettlement.toString());

      // A third party should never be able to use the withdraw function.
      assert(await didContractThrow(derivativeContract.withdraw(longBalance.toString(), { from: thirdParty })));

      // Tokens should be able to be transferred post-settlement. Anyone should be able to redeem them for the frozen price.
      let remainingBalance = await derivativeContract.balanceOf(sponsor);
      await derivativeContract.transfer(thirdParty, remainingBalance.toString(), { from: sponsor });

      await derivativeContract.approve(derivativeContract.address, remainingBalance.toString(), { from: thirdParty });
      initialContractBalance = await getContractBalance();
      let initialUserBalance = await getMarginBalance(thirdParty);
      await derivativeContract.redeemTokens({ from: thirdParty });
      newContractBalance = await getContractBalance();
      let newUserBalance = await getMarginBalance(thirdParty);

      assert.equal(initialContractBalance.sub(newContractBalance).toString(), nav.add(expectedPenalty).toString());

      // 1 means that newUserBalance > initialUserBalance - the user's balance increased.
      assert.equal(newUserBalance.cmp(initialUserBalance), 1);

      // Contract should be empty.
      assert.equal(newContractBalance.toString(), "0");

      const finalStoreBalance = await getMarginBalance(deployedCentralizedStore.address);
      const oracleFeesPaidToStore = finalStoreBalance.sub(initialStoreBalance);
      assert.equal(oracleFeesPaidToStore.toString(), totalOracleFeesPaid.toString());
    });

    it(annotateTitle("Asset value estimation methods"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract.
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("2", "ether"),
        await getMarginParams(web3.utils.toWei("3", "ether"))
      );

      // Verify initial state, nav, and balances.
      let nav = (await derivativeContract.derivativeStorage()).nav;
      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      let state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(nav.toString(), web3.utils.toWei("2", "ether"));
      assert.equal(longBalance.toString(), web3.utils.toBN(web3.utils.toWei("2", "ether")));
      assert.equal(shortBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
      assert.equal(state.toString(), "0");

      // The estimation methods should line up.
      let calcNav = await derivativeContract.calcNAV();
      let calcTokenValue = await derivativeContract.calcTokenValue();
      let calcShortMarginBalance = await derivativeContract.calcShortMarginBalance();
      assert.equal(calcNav.toString(), web3.utils.toWei("2", "ether"));
      assert.equal(calcTokenValue.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(calcShortMarginBalance.toString(), web3.utils.toWei("1", "ether"));

      // Change the price but don't remargin (yet).
      await pushPrice(web3.utils.toWei("1.1", "ether"));

      // The estimation methods should provide the values after remargining.
      let expectedOracleFee = computeExpectedOracleFees(nav);
      let expectedReturnWithoutFees = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
      let expectedNav = computeNewNav(nav, expectedReturnWithoutFees, feesPerInterval);
      let changeInNav = expectedNav.sub(nav);
      let expectedShortBalance = shortBalance.sub(expectedOracleFee).sub(changeInNav);
      calcNav = await derivativeContract.calcNAV();
      calcTokenValue = await derivativeContract.calcTokenValue();
      calcShortMarginBalance = await derivativeContract.calcShortMarginBalance();
      assert.equal(calcNav.toString(), expectedNav);
      // There are 2 tokens outstading, so each token's value is 1/2 the NAV.
      assert.equal(calcTokenValue.toString(), expectedNav.divn(2).toString());
      assert.equal(calcShortMarginBalance.toString(), expectedShortBalance.toString());

      // Remargin and double check estimation methods.
      await derivativeContract.remargin({ from: sponsor });
      calcNav = await derivativeContract.calcNAV();
      calcTokenValue = await derivativeContract.calcTokenValue();
      calcShortMarginBalance = await derivativeContract.calcShortMarginBalance();
      assert.equal(calcNav.toString(), expectedNav);
      // There are 2 tokens outstading, so each token's value is 1/2 the NAV.
      assert.equal(calcTokenValue.toString(), expectedNav.divn(2));
      assert.equal(calcShortMarginBalance.toString(), expectedShortBalance.toString());
    });

    it(annotateTitle("Live -> Default -> Settled (oracle)"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract.
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.2", "ether"))
      );

      // Verify initial state, nav, and balances.
      const initialNav = (await derivativeContract.derivativeStorage()).nav;
      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      const initialInvestorBalance = longBalance;
      const initialSponsorBalance = shortBalance;
      assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(initialInvestorBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
      assert.equal(initialSponsorBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.2", "ether")));
      let state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "0");

      // The price increases, forcing the sponsor into default.
      const navPreDefault = (await derivativeContract.derivativeStorage()).nav;
      await pushPrice(web3.utils.toWei("1.1", "ether"));
      const defaultTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];
      await derivativeContract.remargin({ from: sponsor });

      // Verify nav and balances. The default penalty shouldn't be charged yet.
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "3");
      let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
      const expectedDefaultNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
      let changeInNav = expectedDefaultNav.sub(initialNav);
      const expectedOracleFee = computeExpectedOracleFees(initialNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      expectedInvestorAccountBalance = initialInvestorBalance.add(changeInNav);
      expectedSponsorAccountBalance = initialSponsorBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedDefaultNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());

      // Provide the Oracle price and call settle. The Oracle price is different from the price feed price, and the
      // sponsor is no longer in default.
      await deployedCentralizedOracle.pushPrice(identifierBytes, defaultTime, web3.utils.toWei("1.05", "ether"));
      await derivativeContract.settle();

      // Verify nav and balances at settlement, no default penalty. Whatever the price feed said before is effectively
      // ignored.
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "5");
      // Can't call calc* methods when Settled.
      assert(await didContractThrow(derivativeContract.calcNAV()));
      assert(await didContractThrow(derivativeContract.calcTokenValue()));
      assert(await didContractThrow(derivativeContract.calcShortMarginBalance()));
      priceReturn = web3.utils.toBN(web3.utils.toWei("1.05", "ether"));
      const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
      changeInNav = expectedSettlementNav.sub(initialNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      expectedInvestorAccountBalance = initialInvestorBalance.add(changeInNav);
      expectedSponsorAccountBalance = initialSponsorBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedSettlementNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
    });

    it(annotateTitle("Live -> Default -> Settled (oracle) [price available]"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract.
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.2", "ether"))
      );

      // Verify initial state, nav, and balances.
      const initialNav = (await derivativeContract.derivativeStorage()).nav;
      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(longBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
      assert.equal(shortBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.2", "ether")));
      let state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "0");

      // The price increases, forcing the sponsor into default.
      const navPreDefault = (await derivativeContract.derivativeStorage()).nav;
      await pushPrice(web3.utils.toWei("1.1", "ether"));
      const defaultTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];

      // The Oracle price is already available.
      await deployedCentralizedOracle.requestPrice(identifierBytes, defaultTime);
      await deployedCentralizedOracle.pushPrice(identifierBytes, defaultTime, web3.utils.toWei("1.1", "ether"));

      // Remargin to the new price, which should immediately settle the contract.
      await derivativeContract.remargin({ from: sponsor });
      assert.equal((await derivativeContract.derivativeStorage()).state.toString(), "5");

      // Verify nav and balances at settlement, including default penalty.
      const expectedOracleFee = computeExpectedOracleFees(initialNav);
      const defaultPenalty = computeExpectedPenalty(initialNav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
      const priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
      const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
      let changeInNav = expectedSettlementNav.sub(initialNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      expectedInvestorAccountBalance = longBalance.add(changeInNav).add(defaultPenalty);
      expectedSponsorAccountBalance = shortBalance
        .sub(changeInNav)
        .sub(defaultPenalty)
        .sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedSettlementNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
    });

    it(annotateTitle("Live -> Dispute (correctly) [price available] -> Settled"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.2", "ether"))
      );

      let nav = (await derivativeContract.derivativeStorage()).nav;
      const disputeTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];
      // Provide oracle price for the disputed time.
      await deployedCentralizedOracle.requestPrice(identifierBytes, disputeTime);
      await deployedCentralizedOracle.pushPrice(identifierBytes, disputeTime, web3.utils.toWei("0.9", "ether"));

      // Pushing these prices doesn't remargin the contract, so it doesn't affect what we dispute.
      await pushPrice(web3.utils.toWei("1.1", "ether"));

      // Dispute the price.
      const presettlementNav = (await derivativeContract.derivativeStorage()).nav;
      const presettlementSponsorBalance = (await derivativeContract.derivativeStorage()).shortBalance;

      const disputeFee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
      await derivativeContract.dispute(await getMarginParams(disputeFee.toString()));

      // Auto-settles with the Oracle price.
      assert.equal((await derivativeContract.derivativeStorage()).state.toString(), "5");
      nav = (await derivativeContract.derivativeStorage()).nav;

      const shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      const longBalance = (await derivativeContract.derivativeStorage()).longBalance;

      // Verify that the dispute fee went to the counterparty and that the NAV changed.
      // No Oracle fee needs to be deducted, because the contract is never remargined.
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

      contractBalance = await getContractBalance();
      assert.equal(contractBalance.toString(), "0");
    });

    it(annotateTitle("Live -> Dispute (incorrectly) -> Settled"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.5", "ether"))
      );

      let nav = (await derivativeContract.derivativeStorage()).nav;

      const disputeTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];
      // Dispute the current price.
      let disputeFee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
      await derivativeContract.dispute(await getMarginParams(disputeFee.toString()));
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "1");

      // Can't call calc* methods when disputed.
      assert(await didContractThrow(derivativeContract.calcNAV()));
      assert(await didContractThrow(derivativeContract.calcTokenValue()));
      assert(await didContractThrow(derivativeContract.calcShortMarginBalance()));

      // Can't call emergency shutdown while expired.
      assert(await didContractThrow(derivativeContract.emergencyShutdown({ from: admin })));

      // Provide the Oracle price.
      await deployedCentralizedOracle.pushPrice(identifierBytes, disputeTime, web3.utils.toWei("1", "ether"));

      // Settle with the Oracle price.
      let presettlementNav = (await derivativeContract.derivativeStorage()).nav;
      let presettlementSponsorBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      await derivativeContract.settle({ from: thirdParty });

      // Verify that you can't call dispute once the contract is settled.
      assert(await didContractThrow(derivativeContract.dispute()));

      nav = (await derivativeContract.derivativeStorage()).nav;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;

      // Verify that the dispute fee was refunded and the nav didn't change.
      assert.equal(presettlementNav.toString(), nav.toString());
      assert.equal(longBalance.toString(), nav.add(disputeFee).toString());

      // Sponsor should have the exact same amount of ETH that they deposited.
      assert.equal(shortBalance.toString(), web3.utils.toWei("0.5", "ether"));

      // Redeem tokens and withdraw money.
      await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1", "ether"), { from: sponsor });
      await derivativeContract.redeemTokens({ from: sponsor });
      await derivativeContract.withdraw(shortBalance.toString(), { from: sponsor });

      contractBalance = await getContractBalance();
      assert.equal(contractBalance.toString(), "0");
    });

    it(annotateTitle("Live -> Expired -> Settled (oracle price)"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // One time step until expiry.
      await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.5", "ether"))
      );

      // Verify initial state.
      const initialNav = (await derivativeContract.derivativeStorage()).nav;
      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(longBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
      assert.equal(shortBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.5", "ether")));
      let state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "0");

      // Push the contract to expiry. and provide Oracle price beforehand.
      await pushPrice(web3.utils.toWei("100", "ether"));
      const expirationTime = await deployedManualPriceFeed.getCurrentTime();

      // Can't call calc* methods on a contract that will expire on remargin, even if it hasn't remargined yet.
      assert(await didContractThrow(derivativeContract.calcNAV()));
      assert(await didContractThrow(derivativeContract.calcTokenValue()));
      assert(await didContractThrow(derivativeContract.calcShortMarginBalance()));

      // Contract should go to expired.
      await derivativeContract.remargin({ from: sponsor });
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "2");

      // Can't call calc* methods when expired.
      assert(await didContractThrow(derivativeContract.calcNAV()));
      assert(await didContractThrow(derivativeContract.calcTokenValue()));
      assert(await didContractThrow(derivativeContract.calcShortMarginBalance()));

      // Verify that you can't call settle before the Oracle provides a price.
      assert(await didContractThrow(derivativeContract.dispute()));

      // Then the Oracle price should be provided, which settles the contract.
      await deployedCentralizedOracle.pushPrice(identifierBytes, expirationTime, web3.utils.toWei("1.1", "ether"));
      await derivativeContract.settle();
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "5");

      // Verify nav and balances at settlement.
      let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
      const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
      const expectedOracleFee = computeExpectedOracleFees(initialNav);
      let changeInNav = expectedSettlementNav.sub(initialNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      expectedInvestorAccountBalance = longBalance.add(changeInNav);
      expectedSponsorAccountBalance = shortBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedSettlementNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
    });

    it(annotateTitle("Live -> Expired -> Settled (oracle price) [price available]"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // One time step until expiry.
      await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.5", "ether"))
      );

      // Verify initial state.
      const initialNav = (await derivativeContract.derivativeStorage()).nav;
      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(initialNav.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(longBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
      assert.equal(shortBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.5", "ether")));
      let state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "0");

      // Push the contract to expiry, and provide Oracle price beforehand.
      await pushPrice(web3.utils.toWei("100", "ether"));
      const expirationTime = await deployedManualPriceFeed.getCurrentTime();
      await deployedCentralizedOracle.requestPrice(identifierBytes, expirationTime);
      await deployedCentralizedOracle.pushPrice(identifierBytes, expirationTime, web3.utils.toWei("1.1", "ether"));

      // Contract should go straight to settled.
      await derivativeContract.remargin({ from: sponsor });
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "5");

      // Verify nav and balances at settlement.
      let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
      const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
      const expectedOracleFee = computeExpectedOracleFees(initialNav);
      let changeInNav = expectedSettlementNav.sub(initialNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      expectedInvestorAccountBalance = longBalance.add(changeInNav);
      expectedSponsorAccountBalance = shortBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedSettlementNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
    });

    it(annotateTitle("Live -> Remargin -> Remargin -> Expired -> Settled (oracle price)"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // Three time steps until expiry.
      await deployNewTokenizedDerivative(priceFeedUpdatesInterval * 3);

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.5", "ether"))
      );

      // Verify initial nav and balances. No time based fees have been assessed yet.
      let expectedNav = web3.utils.toBN(web3.utils.toWei("1", "ether"));
      let actualNav = (await derivativeContract.derivativeStorage()).nav;
      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedNav.toString());
      assert.equal(longBalance.toString(), web3.utils.toBN(web3.utils.toWei("1", "ether")));
      assert.equal(shortBalance.toString(), web3.utils.toBN(web3.utils.toWei("0.5", "ether")));

      // Move the price 10% up.
      await pushPrice(web3.utils.toWei("1.1", "ether"));
      await derivativeContract.remargin({ from: sponsor });
      let state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "0");

      // Verify nav and balances.
      let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
      expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
      let expectedOracleFee = computeExpectedOracleFees(actualNav);
      let changeInNav = expectedNav.sub(actualNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      expectedInvestorAccountBalance = longBalance.add(changeInNav);
      expectedSponsorAccountBalance = shortBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());

      // Move the price another 10% up.
      await pushPrice(web3.utils.toWei("1.21", "ether"));
      await derivativeContract.remargin({ from: sponsor });
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "0");

      // Verify nav and balance.
      priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
      expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
      expectedOracleFee = computeExpectedOracleFees(actualNav);
      changeInNav = expectedNav.sub(actualNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      expectedInvestorAccountBalance = longBalance.add(changeInNav);
      expectedSponsorAccountBalance = shortBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());

      // Now push to contract into expiry, moving down by 10% (which isn't the same as reversing the previous move).
      await pushPrice(web3.utils.toWei("1.089", "ether"));
      const expirationTime = await deployedManualPriceFeed.getCurrentTime();
      await derivativeContract.remargin({ from: sponsor });

      // Contract should go to EXPIRED, and then on settle(), go to SETTLED.
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "2");
      await deployedCentralizedOracle.pushPrice(identifierBytes, expirationTime, web3.utils.toWei("1.089", "ether"));
      await derivativeContract.settle();
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "5");

      // Verify NAV and balances at expiry.
      priceReturn = web3.utils.toBN(web3.utils.toWei("0.9", "ether"));
      expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
      expectedOracleFee = computeExpectedOracleFees(actualNav);
      changeInNav = expectedNav.sub(actualNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      expectedInvestorAccountBalance = longBalance.add(changeInNav);
      expectedSponsorAccountBalance = shortBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
    });

    it(annotateTitle("Remargin with zero Oracle fee"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative(priceFeedUpdatesInterval * 3);

      // A contract with 0 NAV can still call remargin().
      await pushPrice(web3.utils.toWei("1.089", "ether"));
      await derivativeContract.remargin({ from: sponsor });
    });

    it(annotateTitle("Remargin with Oracle fee > short balance"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      const initialStoreBalance = web3.utils.toBN(await getMarginBalance(deployedCentralizedStore.address));

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.5", "ether"))
      );

      // Set an absurdly high Oracle fee that will wipe out the short balance when charged.
      const oracleFeePerSecond2 = web3.utils.toBN(web3.utils.toWei("0.9", "ether"));
      await deployedCentralizedStore.setFixedOracleFeePerSecond(oracleFeePerSecond2);
      const shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;

      // Remargin at the next interval.
      await pushPrice(web3.utils.toWei("1", "ether"));
      await derivativeContract.remargin({ from: sponsor });

      // The contract should go into default due to the Oracle fee.
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "3");

      // Verify that the entire short balance got paid to the Oracle.
      const finalStoreBalance = web3.utils.toBN(await getMarginBalance(deployedCentralizedStore.address));
      assert.equal(finalStoreBalance.sub(initialStoreBalance).toString(), shortBalance.toString());

      // Clean up: reset the Oracle fee.
      await deployedCentralizedStore.setFixedOracleFeePerSecond(oracleFeePerSecond);
    });

    it(annotateTitle("Withdraw throttling"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // Three time steps until expiry.
      await deployNewTokenizedDerivative();

      // Deposit 1 ETH with 0 contract NAV to allow the only limiting factor on withdrawals to be the throttling.
      await derivativeContract.deposit(await getMarginParams(web3.utils.toWei("1", "ether")));

      // Cannot withdraw > 33% (or 0.33).
      assert(await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.4", "ether"), { from: sponsor })));

      // Can withdraw 0.3.
      await derivativeContract.withdraw(web3.utils.toWei("0.3", "ether"), { from: sponsor });

      // Move time forward a small amount to ensure the throttle isn't reset by small time movements.
      pushPrice(web3.utils.toWei("0.1", "ether"));

      // Now that 0.3 is withdrawn, cannot withdraw 0.1 because it would go above the 0.03 remaining limit for the
      // current 24 hour period.
      assert(await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.1", "ether"), { from: sponsor })));

      // Manually push feed forward by 1 day.
      const newTime = parseInt(await deployedManualPriceFeed.getCurrentTime(), 10) + 864000;
      await deployedManualPriceFeed.setCurrentTime(newTime);
      await deployedManualPriceFeed.pushLatestPrice(identifierBytes, newTime, web3.utils.toWei("1", "ether"));

      // Now that 24 hours has passed, the limit has been reset, so 0.1 should be withdrawable.
      await derivativeContract.withdraw(web3.utils.toWei("0.1", "ether"), { from: sponsor });
    });

    it(annotateTitle("Live -> Remargin -> Emergency shutdown"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.6", "ether"))
      );
      let state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "0");

      let actualNav = (await derivativeContract.derivativeStorage()).nav;
      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;

      // Remargin the contract.
      await pushPrice(web3.utils.toWei("1", "ether"));
      const lastRemarginTime = await deployedManualPriceFeed.getCurrentTime();
      await derivativeContract.remargin({ from: sponsor });
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "0");

      // Sponsor cannot call emergencyShutdown().
      assert(await didContractThrow(derivativeContract.emergencyShutdown({ from: sponsor })));

      // Admin calls emergency shutdown.
      await derivativeContract.emergencyShutdown({ from: admin });
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "4");

      // Can't call emergency shutdown while already in emergency shutdown.
      assert(await didContractThrow(derivativeContract.emergencyShutdown({ from: admin })));

      // Provide Oracle price and call settle().
      await deployedCentralizedOracle.pushPrice(identifierBytes, lastRemarginTime, web3.utils.toWei("1.3", "ether"));
      await derivativeContract.settle();
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "5");

      // Verify that balances and NAV reflect the Oracle price.
      const priceReturn = web3.utils.toBN(web3.utils.toWei("1.3", "ether"));
      const expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
      const changeInNav = expectedNav.sub(actualNav);
      const expectedOracleFee = computeExpectedOracleFees(actualNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      const expectedInvestorAccountBalance = longBalance.add(changeInNav);
      const expectedSponsorAccountBalance = shortBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());

      // Can't call emergency shutdown in the Settled state.
      assert(await didContractThrow(derivativeContract.emergencyShutdown({ from: admin })));
    });

    it(annotateTitle("Live -> Create -> Create fails on expiry"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // One time step until expiry.
      await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.6", "ether"))
      );

      // Push time forward, so that the contract will expire when remargin is called.
      await pushPrice(web3.utils.toWei("1", "ether"));

      // Tokens cannot be created because the contract has expired.
      assert(
        await didContractThrow(derivativeContract.createTokens(await getMarginParams(web3.utils.toWei("1", "ether"))))
      );
    });

    it(annotateTitle("DepositAndCreateTokens failure"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // One time step until expiry.
      await deployNewTokenizedDerivative(priceFeedUpdatesInterval);

      // Token creation should fail because the sponsor doesn't supply enough margin.
      assert(
        await didContractThrow(
          derivativeContract.depositAndCreateTokens(
            web3.utils.toWei("1", "ether"),
            await getMarginParams(web3.utils.toWei("1.05", "ether"))
          )
        )
      );
    });

    it(annotateTitle("AP Delegate Permissions"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      const initialApDelegate = (await derivativeContract.derivativeStorage()).externalAddresses.apDelegate;
      assert.equal(initialApDelegate, "0x0000000000000000000000000000000000000000");

      // AP Delegate cannot call depositAndCreate because it has not been set yet.
      assert(
        await didContractThrow(
          derivativeContract.depositAndCreateTokens(
            web3.utils.toWei("1", "ether"),
            await getMarginParams(web3.utils.toWei("1.5", "ether"), apDelegate)
          )
        )
      );

      // Only the token sponsor can set the AP Delegate.
      assert(await didContractThrow(derivativeContract.setApDelegate(apDelegate, { from: thirdParty })));

      // Set the AP delegate.
      await derivativeContract.setApDelegate(apDelegate, { from: sponsor });

      // AP Delegate can call depositAndCreate().
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.5", "ether"), apDelegate)
      );

      // AP Delegate can call createTokens.
      await derivativeContract.createTokens(await getMarginParams(web3.utils.toWei("0.1", "ether"), apDelegate));

      // AP Delegate can call redeemTokens.
      await derivativeContract.approve(derivativeContract.address, web3.utils.toWei("1.1", "ether"), {
        from: apDelegate
      });
      await derivativeContract.redeemTokens({ from: apDelegate });

      assert(
        await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.1", "ether"), { from: apDelegate }))
      );
      assert(
        await didContractThrow(
          derivativeContract.deposit(await getMarginParams(web3.utils.toWei("0.1", "ether"), apDelegate))
        )
      );

      // Reset AP Delegate to a random address.
      await derivativeContract.setApDelegate(web3.utils.randomHex(20), { from: sponsor });

      // Previous AP Delegate cannot call depositAndCreateTokens now that it has been changed.
      assert(
        await didContractThrow(
          derivativeContract.depositAndCreateTokens(
            web3.utils.toWei("1", "ether"),
            await getMarginParams(web3.utils.toWei("1.5", "ether"), apDelegate)
          )
        )
      );
    });

    it(annotateTitle("Constructor assertions"), async function() {
      const defaultConstructorParams = {
        sponsor: sponsor,
        admin: admin,
        defaultPenalty: web3.utils.toWei("0.05", "ether"),
        requiredMargin: web3.utils.toWei("0.1", "ether"),
        product: identifierBytes,
        fixedYearlyFee: web3.utils.toWei("0.01", "ether"),
        disputeDeposit: web3.utils.toWei("0.05", "ether"),
        returnCalculator: noLeverageCalculator.address,
        startingTokenPrice: web3.utils.toWei("1", "ether"),
        expiry: "0",
        marginCurrency: marginTokenAddress(),
        withdrawLimit: web3.utils.toWei("0.33", "ether"),
        name: "1x coin",
        symbol: web3.utils.utf8ToHex("BTCETH")
      };

      // Verify that the defaults work.
      await tokenizedDerivativeCreator.createTokenizedDerivative(defaultConstructorParams, { from: sponsor });

      // Product unsupported by the Oracle.
      const productUnsupportedByOracle = web3.utils.hexToBytes(web3.utils.utf8ToHex("unsupportedByOracle"));
      const time = (await deployedManualPriceFeed.getCurrentTime()).addn(100000);
      await deployedManualPriceFeed.setCurrentTime(time);
      await deployedManualPriceFeed.pushLatestPrice(productUnsupportedByOracle, time, web3.utils.toWei("1", "ether"));

      const unsupportedByOracleParams = { ...defaultConstructorParams, product: productUnsupportedByOracle };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(unsupportedByOracleParams, { from: sponsor })
        )
      );

      // Product unsupported by price feed.
      const productUnsupportedByPriceFeed = web3.utils.hexToBytes(web3.utils.utf8ToHex("unsupportedByFeed"));
      await deployedCentralizedOracle.addSupportedIdentifier(productUnsupportedByPriceFeed);

      const unsupportedByPriceFeedParams = { ...defaultConstructorParams, product: productUnsupportedByPriceFeed };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(unsupportedByPriceFeedParams, { from: sponsor })
        )
      );

      // Default penalty above margin requirement.
      const defaultPenaltyAboveMrParams = {
        ...defaultConstructorParams,
        defaultPenalty: web3.utils.toWei("0.5", "ether")
      };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(defaultPenaltyAboveMrParams, { from: sponsor })
        )
      );

      // Margin requirement above 100%.
      const requiredMarginTooHighParams = {
        ...defaultConstructorParams,
        requiredMargin: web3.utils.toWei("2", "ether")
      };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(requiredMarginTooHighParams, { from: sponsor })
        )
      );

      // Starting token price too high.
      const tokenPriceTooHighParams = {
        ...defaultConstructorParams,
        startingTokenPrice: web3.utils.toWei("2000000000", "ether")
      };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(tokenPriceTooHighParams, { from: sponsor })
        )
      );

      // Starting token price too low.
      const tokenPriceTooLowParams = {
        ...defaultConstructorParams,
        startingTokenPrice: web3.utils.toWei("1", "picoether")
      };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(tokenPriceTooLowParams, { from: sponsor })
        )
      );

      // Expiry time before current time.
      const currentTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];
      const expiryTooEarlyParams = {
        ...defaultConstructorParams,
        expiry: web3.utils
          .toBN(currentTime)
          .subn(1)
          .toString()
      };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(expiryTooEarlyParams, { from: sponsor })
        )
      );

      // Withdraw limit is too high.
      const withdrawLimitTooHighParams = { ...defaultConstructorParams, withdrawLimit: web3.utils.toWei("1", "ether") };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(withdrawLimitTooHighParams, { from: sponsor })
        )
      );
    });
  });
});
