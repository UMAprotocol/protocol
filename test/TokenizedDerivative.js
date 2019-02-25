const { didContractThrow } = require("./utils/DidContractThrow.js");

const CentralizedOracle = artifacts.require("CentralizedOracle");
const CentralizedStore = artifacts.require("CentralizedStore");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const Registry = artifacts.require("Registry");
const TokenizedDerivative = artifacts.require("TokenizedDerivative");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");

// Pull in contracts from dependencies.
const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

const BigNumber = require("bignumber.js");
const truffleAssert = require("truffle-assertions");

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
  let returnCalculatorWhitelist;

  const owner = accounts[0];
  const sponsor = accounts[1];
  const thirdParty = accounts[2];
  const apDelegate = accounts[3];

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
    let marginCurrencyWhitelist = await AddressWhitelist.at(await tokenizedDerivativeCreator.marginCurrencyWhitelist());
    marginCurrencyWhitelist.addToWhitelist(marginToken.address);

    // Set return calculator whitelist for later use.
    returnCalculatorWhitelist = await AddressWhitelist.at(await tokenizedDerivativeCreator.returnCalculatorWhitelist());

    // Make sure the Oracle and PriceFeed support the underlying product.
    await deployedCentralizedOracle.addSupportedIdentifier(identifierBytes);
    await deployedManualPriceFeed.setCurrentTime(100000);
    await pushPrice(web3.utils.toWei("1", "ether"));

    // Add the owner to the list of registered derivatives so it's allowed to query oracle prices.
    let creator = accounts[5];
    await deployedRegistry.addDerivativeCreator(creator);
    await deployedRegistry.registerDerivative([], owner, { from: creator });

    // Set an Oracle fee.
    await deployedCentralizedStore.setFixedOracleFeePerSecond(oracleFeePerSecond);
  });

  const computeNewNav = (previousNav, priceReturn, fees) => {
    const expectedReturnWithFees = priceReturn.sub(fees);
    const retVal = BigNumber(web3.utils.fromWei(expectedReturnWithFees.mul(previousNav), "ether"));
    const flooredRetVal = retVal.integerValue(BigNumber.ROUND_FLOOR);
    return web3.utils.toBN(flooredRetVal);
  };

  const computeExpectedMarginRequirement = (nav, marginRequirementPercentage) => {
    return nav.mul(marginRequirementPercentage).div(web3.utils.toBN(web3.utils.toWei("1", "ether")));
  };

  const computeExpectedPenalty = (navToPenalize, penaltyPercentage) => {
    return web3.utils.toBN(web3.utils.fromWei(navToPenalize.mul(penaltyPercentage), "ether"));
  };

  const computeExpectedOracleFees = (longBalance, shortBalance) => {
    const pfc = longBalance.cmp(shortBalance) == 1 ? longBalance : shortBalance;
    const oracleFeeRatio = oracleFeePerSecond.mul(web3.utils.toBN(priceFeedUpdatesInterval));
    return pfc.mul(oracleFeeRatio).div(web3.utils.toBN(web3.utils.toWei("1", "ether")));
  };

  // Pushes a price to the ManualPriceFeed, incrementing time by `priceFeedUpdatesInterval`.
  const pushPrice = async price => {
    const latestTime = parseInt(await deployedManualPriceFeed.getCurrentTime(), 10) + priceFeedUpdatesInterval;
    await deployedManualPriceFeed.setCurrentTime(latestTime);
    await deployedManualPriceFeed.pushLatestPrice(identifierBytes, latestTime, price);
  };

  // All test cases are run for each "variant" (or test parameterization) listed in this array.
  let testVariants = [
    { useErc20: true, preAuth: true },
    { useErc20: true, preAuth: false },
    { usrErc20: false, preAuth: false }
  ];

  testVariants.forEach(testVariant => {
    // The following function declarations depend on the testVariant. To avoid passing it around, they are declared
    // in this scope so the testVariant is implicitly visible to them.

    // The contract assumes that ETH is the margin currency if passed 0x0 as the margin token address.
    const marginTokenAddress = () => {
      return testVariant.useErc20 ? marginToken.address : "0x0000000000000000000000000000000000000000";
    };

    const deployNewTokenizedDerivative = async (overrideConstructorParams = {}) => {
      await pushPrice(web3.utils.toWei("1", "ether"));
      const startTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];

      let defaultConstructorParams = {
        sponsor: sponsor,
        defaultPenalty: web3.utils.toWei("0.5", "ether"),
        supportedMove: web3.utils.toWei("0.1", "ether"),
        product: identifierBytes,
        fixedYearlyFee: web3.utils.toWei("0.01", "ether"),
        disputeDeposit: web3.utils.toWei("0.5", "ether"),
        returnCalculator: noLeverageCalculator.address,
        startingTokenPrice: web3.utils.toWei("1", "ether"),
        expiry: 0,
        marginCurrency: marginTokenAddress(),
        withdrawLimit: web3.utils.toWei("0.33", "ether"),
        returnType: "1", // Compound
        startingUnderlyingPrice: "0", // Use price feed
        name: name,
        symbol: symbol
      };

      let constructorParams = { ...defaultConstructorParams, ...overrideConstructorParams };

      // The provided expiry is described as a delay from the current time. To get the expiry in absolute terms, it
      // must be offset from the current time.
      if (constructorParams.expiry != 0) {
        constructorParams.expiry = startTime.addn(constructorParams.expiry).toString();
      }

      await tokenizedDerivativeCreator.createTokenizedDerivative(constructorParams, { from: sponsor });

      const derivativeArray = await deployedRegistry.getRegisteredDerivatives(sponsor);
      const derivativeAddress = derivativeArray[derivativeArray.length - 1].derivativeAddress;
      derivativeContract = await TokenizedDerivative.at(derivativeAddress);

      const feesPerSecond = web3.utils.toBN(
        (await derivativeContract.derivativeStorage()).fixedParameters.fixedFeePerSecond
      );
      feesPerInterval = feesPerSecond.muln(priceFeedUpdatesInterval);

      // Pre-auth when required.
      if (testVariant.preAuth) {
        const uintMax = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

        // Pre auth the margin currency.
        await marginToken.approve(derivativeContract.address, uintMax, { from: sponsor });
        await marginToken.approve(derivativeContract.address, uintMax, { from: thirdParty });
        await marginToken.approve(derivativeContract.address, uintMax, { from: apDelegate });

        // Pre auth the derivative token.
        await derivativeContract.approve(derivativeContract.address, uintMax, { from: sponsor });
        await derivativeContract.approve(derivativeContract.address, uintMax, { from: thirdParty });
        await derivativeContract.approve(derivativeContract.address, uintMax, { from: apDelegate });
      }
    };

    const getMarginParams = async (value, sender) => {
      if (sender === undefined) {
        sender = sponsor;
      }

      let callParams = { from: sender };
      if (value) {
        if (!testVariant.useErc20) {
          callParams.value = value;
        } else if (!testVariant.preAuth) {
          await marginToken.approve(derivativeContract.address, value, { from: sender });
        }
      }
      return callParams;
    };

    const approveDerivativeTokens = async (value, sender) => {
      if (testVariant.preAuth) {
        return;
      }

      if (sender === undefined) {
        sender = sponsor;
      }

      await derivativeContract.approve(derivativeContract.address, value, { from: sender });
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
      return (
        (testVariant.useErc20 ? "ERC20 Margin " : "ETH Margin   ") +
        (testVariant.preAuth ? "(Pre-Authorized) | " : "                 | ") +
        title
      );
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
      assert.equal(contractAdmin, deployedCentralizedOracle.address);

      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      const initialStoreBalance = await getMarginBalance(deployedCentralizedStore.address);
      let totalOracleFeesPaid = web3.utils.toBN(web3.utils.toWei("0", "ether"));

      // Ensure the short balance is 0 ETH (as is deposited in beforeEach()).
      assert.equal(shortBalance.toString(), web3.utils.toWei("0", "ether"));

      // Check that the deposit function correctly credits the short account.
      let result = await derivativeContract.deposit(
        web3.utils.toWei("0.21", "ether"),
        await getMarginParams(web3.utils.toWei("0.21", "ether"))
      );
      truffleAssert.eventEmitted(result, "Deposited", ev => {
        return ev.amount.toString() === web3.utils.toWei("0.21", "ether");
      });
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(shortBalance.toString(), web3.utils.toWei("0.21", "ether"));

      // Check that the withdraw function correctly withdraws from the sponsor account.
      result = await derivativeContract.withdraw(web3.utils.toWei("0.01", "ether"), { from: sponsor });
      truffleAssert.eventEmitted(result, "Withdrawal", ev => {
        return ev.amount.toString() === web3.utils.toWei("0.01", "ether");
      });
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(shortBalance.toString(), web3.utils.toWei("0.2", "ether"));

      // Fails because there is not enough short margin for 3 ETH of tokens.
      assert(
        await didContractThrow(
          derivativeContract.createTokens(
            web3.utils.toWei("3", "ether"),
            web3.utils.toWei("3", "ether"),
            await getMarginParams(web3.utils.toWei("3", "ether"))
          )
        )
      );

      // Succeeds because exact is true and requested NAV (1 ETH) would not cause the short account to go below its
      // margin requirement.
      result = await derivativeContract.createTokens(
        web3.utils.toWei("1", "ether"),
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1", "ether"))
      );
      truffleAssert.eventEmitted(result, "TokensCreated", ev => {
        return ev.numTokensCreated.toString() === web3.utils.toWei("1", "ether");
      });

      let sponsorTokenBalance = await derivativeContract.balanceOf(sponsor);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      nav = (await derivativeContract.derivativeStorage()).nav;

      assert.equal(sponsorTokenBalance.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(longBalance.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(nav.toString(), web3.utils.toWei("1", "ether"));

      // Succeeds because there is enough margin to support an additional 1 ETH of NAV.
      await derivativeContract.createTokens(
        web3.utils.toWei("1", "ether"),
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1", "ether"))
      );

      sponsorTokenBalance = await derivativeContract.balanceOf(sponsor);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      nav = (await derivativeContract.derivativeStorage()).nav;

      assert.equal(sponsorTokenBalance.toString(), web3.utils.toWei("2", "ether"));
      assert.equal(longBalance.toString(), web3.utils.toWei("2", "ether"));
      assert.equal(nav.toString(), web3.utils.toWei("2", "ether"));

      // This number was chosen so that once the price doubles, the sponsor will not default.
      await derivativeContract.deposit(
        web3.utils.toWei("2.6", "ether"),
        await getMarginParams(web3.utils.toWei("2.6", "ether"))
      );

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
      let storage = await derivativeContract.derivativeStorage();
      expectedOracleFee = computeExpectedOracleFees(storage.longBalance, storage.shortBalance);
      result = await derivativeContract.remargin({ from: sponsor });
      truffleAssert.eventEmitted(result, "NavUpdated", ev => {
        return ev.newNav.toString() === expectedNav.toString();
      });
      totalOracleFeesPaid = totalOracleFeesPaid.add(expectedOracleFee);
      const expectedLastRemarginTime = await deployedManualPriceFeed.getCurrentTime();
      let lastRemarginTime = (await derivativeContract.derivativeStorage()).currentTokenState.time;
      const expectedPreviousRemarginTime = (await derivativeContract.derivativeStorage()).referenceTokenState.time;
      assert.equal(lastRemarginTime.toString(), expectedLastRemarginTime.toString());

      // Ensure that a remargin with no new price works appropriately and doesn't create any balance issues.
      // The prevTokenState also shouldn't get blown away.
      await deployedCentralizedOracle.callRemargin(derivativeContract.address, { from: owner });
      lastRemarginTime = (await derivativeContract.derivativeStorage()).currentTokenState.time;
      let previousRemarginTime = (await derivativeContract.derivativeStorage()).referenceTokenState.time;
      assert.equal(lastRemarginTime.toString(), expectedLastRemarginTime.toString());
      assert.equal(previousRemarginTime.toString(), expectedPreviousRemarginTime.toString());

      // Check new nav after price change.
      nav = (await derivativeContract.derivativeStorage()).nav;
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;

      assert.equal(nav.toString(), expectedNav.toString());
      assert.equal(longBalance.toString(), expectedNav.toString());

      // Should fail because the ERC20 tokens have not been authorized (only valid when the test didn't pre authorize token usage.)
      if (!testVariant.preAuth) {
        assert(
          await didContractThrow(derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: sponsor }))
        );
      }

      let initialContractBalance = await getContractBalance();

      // Attempt redemption of half of the tokens.
      await approveDerivativeTokens(web3.utils.toWei("1", "ether"));
      result = await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: sponsor });
      truffleAssert.eventEmitted(result, "TokensRedeemed", ev => {
        return ev.numTokensRedeemed.toString() === web3.utils.toWei("1", "ether");
      });

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

      // The allowance shouldn't be compared against zero when pre-authorized.
      if (!testVariant.preAuth) {
        assert.equal(allowance.toString(), "0");
      }

      let expectedBalanceChange = expectedNav;
      let actualBalanceChange = initialContractBalance.sub(newContractBalance);
      assert.equal(actualBalanceChange.toString(), expectedBalanceChange.toString());

      // Force the sponsor into default by further increasing the unverified price.
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      await pushPrice(web3.utils.toWei("2.6", "ether"));
      const defaultTime = await deployedManualPriceFeed.getCurrentTime();
      expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
      result = await derivativeContract.remargin({ from: sponsor });
      totalOracleFeesPaid = totalOracleFeesPaid.add(expectedOracleFee);

      // Add an unverified price to ensure that post-default the contract ceases updating.
      await pushPrice(web3.utils.toWei("10.0", "ether"));

      // Compute the expected new NAV and compare.
      expectedNav = computeNewNav(nav, web3.utils.toBN(web3.utils.toWei("1.3", "ether")), feesPerInterval);
      truffleAssert.eventEmitted(result, "Default", ev => {
        return (
          ev.defaultNav.toString() === expectedNav.toString() && ev.defaultTime.toString() === defaultTime.toString()
        );
      });
      let expectedPenalty = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));

      let expectedNavChange = expectedNav.sub(nav);
      state = (await derivativeContract.derivativeStorage()).state;
      nav = (await derivativeContract.derivativeStorage()).nav;
      let initialSponsorBalance = shortBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      let sponsorBalancePostRemargin = shortBalance;

      assert.equal(state.toString(), "3");

      assert.equal(nav.toString(), expectedNav.toString());
      // The sponsor's balance decreases, and we have to add the Oracle fee to the amount of decrease.
      assert.equal(
        initialSponsorBalance.sub(sponsorBalancePostRemargin).toString(),
        expectedNavChange.add(expectedOracleFee).toString()
      );

      // Can't call emergency shutdown while in default.
      assert(
        await didContractThrow(
          deployedCentralizedOracle.callEmergencyShutdown(derivativeContract.address, { from: owner })
        )
      );

      // Only the sponsor can confirm.
      assert(await didContractThrow(derivativeContract.acceptPriceAndSettle({ from: thirdParty })));

      // Verify that the sponsor cannot withdraw before settlement.
      assert(
        await didContractThrow(derivativeContract.withdraw(sponsorBalancePostRemargin.toString(), { from: sponsor }))
      );

      // Verify that after the sponsor confirms, the state is moved to settled.
      result = await derivativeContract.acceptPriceAndSettle({ from: sponsor });
      truffleAssert.eventEmitted(result, "Settled");

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

      await approveDerivativeTokens(remainingBalance.toString(), thirdParty);
      initialContractBalance = await getContractBalance();
      let initialUserBalance = await getMarginBalance(thirdParty);
      await derivativeContract.redeemTokens(remainingBalance.toString(), { from: thirdParty });
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
        web3.utils.toWei("3", "ether"),
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
      let calcExcessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(calcNav.toString(), web3.utils.toWei("2", "ether"));
      assert.equal(calcTokenValue.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(calcShortMarginBalance.toString(), web3.utils.toWei("1", "ether"));
      assert.equal(calcExcessMargin.toString(), web3.utils.toWei("0.8", "ether"));

      // Change the price but don't remargin (yet).
      await pushPrice(web3.utils.toWei("1.1", "ether"));

      // The estimation methods should provide the values after remargining.
      let expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
      let expectedReturnWithoutFees = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
      let expectedNav = computeNewNav(nav, expectedReturnWithoutFees, feesPerInterval);
      let changeInNav = expectedNav.sub(nav);
      let expectedShortBalance = shortBalance.sub(expectedOracleFee).sub(changeInNav);
      let expectedMarginRequirement = computeExpectedMarginRequirement(
        expectedNav,
        web3.utils.toBN(web3.utils.toWei("0.1", "ether"))
      );
      calcNav = await derivativeContract.calcNAV();
      calcTokenValue = await derivativeContract.calcTokenValue();
      calcShortMarginBalance = await derivativeContract.calcShortMarginBalance();
      calcExcessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(calcNav.toString(), expectedNav);
      // There are 2 tokens outstading, so each token's value is 1/2 the NAV.
      assert.equal(calcTokenValue.toString(), expectedNav.divn(2).toString());
      assert.equal(calcShortMarginBalance.toString(), expectedShortBalance.toString());
      assert.equal(calcExcessMargin.toString(), expectedShortBalance.sub(expectedMarginRequirement).toString());

      // Remargin and double check estimation methods.
      await derivativeContract.remargin({ from: sponsor });
      calcNav = await derivativeContract.calcNAV();
      calcTokenValue = await derivativeContract.calcTokenValue();
      calcShortMarginBalance = await derivativeContract.calcShortMarginBalance();
      calcExcessMargin = await derivativeContract.calcExcessMargin();
      nav = (await derivativeContract.derivativeStorage()).nav;
      let tokenValue = (await derivativeContract.derivativeStorage()).currentTokenState.tokenPrice;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      assert.equal(calcNav.toString(), expectedNav);
      assert.equal(nav.toString(), expectedNav);
      // There are 2 tokens outstading, so each token's value is 1/2 the NAV.
      assert.equal(calcTokenValue.toString(), expectedNav.divn(2));
      assert.equal(tokenValue.toString(), expectedNav.divn(2));
      assert.equal(calcShortMarginBalance.toString(), expectedShortBalance.toString());
      assert.equal(shortBalance.toString(), expectedShortBalance.toString());
      assert.equal(calcExcessMargin.toString(), expectedShortBalance.sub(expectedMarginRequirement).toString());

      // Increase the price to push the provider into default (but don't remargin). This price tests the case where
      // calcExcessMargin() returns a negative value.
      await pushPrice(web3.utils.toWei("1.43", "ether"));

      expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
      expectedReturnWithoutFees = web3.utils.toBN(web3.utils.toWei("1.3", "ether"));
      // TODO(ptare): Due to a rounding difference, the computed NAV is off by 1 wei. Figure out why this happens.
      expectedNav = computeNewNav(nav, expectedReturnWithoutFees, feesPerInterval).sub(
        web3.utils.toBN(web3.utils.toWei("1", "wei"))
      );
      changeInNav = expectedNav.sub(nav);
      expectedShortBalance = shortBalance.sub(expectedOracleFee).sub(changeInNav);
      expectedMarginRequirement = computeExpectedMarginRequirement(
        expectedNav,
        web3.utils.toBN(web3.utils.toWei("0.1", "ether"))
      );
      calcNav = await derivativeContract.calcNAV();
      calcShortMarginBalance = await derivativeContract.calcShortMarginBalance();
      calcExcessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(calcNav.toString(), expectedNav.toString());
      assert.equal(calcShortMarginBalance.toString(), expectedShortBalance.toString());
      assert.equal(calcExcessMargin.toString(), expectedShortBalance.sub(expectedMarginRequirement).toString());

      // Remargin into default.
      await derivativeContract.remargin({ from: sponsor });

      // Verify that the "off by 1 wei" affects both the updates and the calc* methods. I.e., it's a difference between
      // the contract code and this JS test, not between the remargin() and calc* methods on the contract.
      nav = (await derivativeContract.derivativeStorage()).nav;
      tokenValue = (await derivativeContract.derivativeStorage()).currentTokenState.tokenPrice;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      state = (await derivativeContract.derivativeStorage()).state;
      assert(state.toString(), "3");
      assert.equal(nav.toString(), expectedNav);
      assert.equal(tokenValue.toString(), expectedNav.divn(2));
      assert.equal(shortBalance.toString(), expectedShortBalance.toString());

      // Can't call calc* methods on a defaulted contract.
      assert(await didContractThrow(derivativeContract.calcNAV()));
      assert(await didContractThrow(derivativeContract.calcTokenValue()));
      assert(await didContractThrow(derivativeContract.calcShortMarginBalance()));
      assert(await didContractThrow(derivativeContract.calcExcessMargin()));
    });

    it(annotateTitle("Live -> Default -> Settled (oracle)"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract.
      let result = await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.2", "ether"),
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.2", "ether"))
      );
      truffleAssert.eventEmitted(result, "Deposited", ev => {
        return ev.amount.toString() === web3.utils.toWei("0.2", "ether");
      });
      truffleAssert.eventEmitted(result, "TokensCreated", ev => {
        return ev.numTokensCreated.toString() === web3.utils.toWei("1", "ether");
      });

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
      const expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
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
      assert(await didContractThrow(derivativeContract.calcExcessMargin()));
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
        web3.utils.toWei("1.2", "ether"),
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
      const expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
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
        web3.utils.toWei("1.2", "ether"),
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
      let result = await derivativeContract.dispute(
        disputeFee.toString(),
        await getMarginParams(disputeFee.toString())
      );
      truffleAssert.eventEmitted(result, "Disputed", ev => {
        return ev.navDisputed.toString() === nav.toString() && ev.timeDisputed.toString() === disputeTime.toString();
      });

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
      await approveDerivativeTokens(web3.utils.toWei("1", "ether"));
      await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: sponsor });
      await derivativeContract.withdraw(shortBalance.toString(), { from: sponsor });

      contractBalance = await getContractBalance();
      assert.equal(contractBalance.toString(), "0");
    });

    it(annotateTitle("Live -> Dispute (incorrectly) -> Settled"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.5", "ether"),
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.5", "ether"))
      );

      let nav = (await derivativeContract.derivativeStorage()).nav;

      const disputeTime = (await deployedManualPriceFeed.latestPrice(identifierBytes))[0];
      // Dispute the current price.
      let disputeFee = computeExpectedPenalty(nav, web3.utils.toBN(web3.utils.toWei("0.05", "ether")));
      await derivativeContract.dispute(disputeFee.toString(), await getMarginParams(disputeFee.toString()));
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "1");

      // Can't call calc* methods when disputed.
      assert(await didContractThrow(derivativeContract.calcNAV()));
      assert(await didContractThrow(derivativeContract.calcTokenValue()));
      assert(await didContractThrow(derivativeContract.calcShortMarginBalance()));
      assert(await didContractThrow(derivativeContract.calcExcessMargin()));

      // Can't call emergency shutdown while expired.
      assert(
        await didContractThrow(
          deployedCentralizedOracle.callEmergencyShutdown(derivativeContract.address, { from: owner })
        )
      );

      // Provide the Oracle price.
      await deployedCentralizedOracle.pushPrice(identifierBytes, disputeTime, web3.utils.toWei("1", "ether"));

      // Settle with the Oracle price.
      let presettlementNav = (await derivativeContract.derivativeStorage()).nav;
      let presettlementSponsorBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      let result = await derivativeContract.settle({ from: thirdParty });
      truffleAssert.eventEmitted(result, "NavUpdated", ev => {
        return ev.newNav.toString() === presettlementNav.toString();
      });

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
      await approveDerivativeTokens(web3.utils.toWei("1", "ether"));
      await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: sponsor });
      await derivativeContract.withdraw(shortBalance.toString(), { from: sponsor });

      contractBalance = await getContractBalance();
      assert.equal(contractBalance.toString(), "0");
    });

    it(annotateTitle("Live -> Expired -> Settled (oracle price)"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // One time step until expiry.
      await deployNewTokenizedDerivative({ expiry: priceFeedUpdatesInterval });

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.5", "ether"),
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

      // Push the contract past expiry and provide Oracle price beforehand.
      await pushPrice(web3.utils.toWei("100", "ether"));
      const expirationTime = await deployedManualPriceFeed.getCurrentTime();

      // Can't call calc* methods on a contract that will expire on remargin, even if it hasn't remargined yet.
      assert(await didContractThrow(derivativeContract.calcNAV()));
      assert(await didContractThrow(derivativeContract.calcTokenValue()));
      assert(await didContractThrow(derivativeContract.calcShortMarginBalance()));
      assert(await didContractThrow(derivativeContract.calcExcessMargin()));

      // Contract should go to expired.
      let result = await derivativeContract.remargin({ from: sponsor });
      truffleAssert.eventEmitted(result, "Expired", ev => {
        return ev.expiryTime.toString() === expirationTime.toString();
      });
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "2");

      // Can't call calc* methods when expired.
      assert(await didContractThrow(derivativeContract.calcNAV()));
      assert(await didContractThrow(derivativeContract.calcTokenValue()));
      assert(await didContractThrow(derivativeContract.calcShortMarginBalance()));
      assert(await didContractThrow(derivativeContract.calcExcessMargin()));

      // Verify that you can't call settle before the Oracle provides a price.
      assert(await didContractThrow(derivativeContract.dispute()));

      // Then the Oracle price should be provided, which settles the contract.
      await deployedCentralizedOracle.pushPrice(identifierBytes, expirationTime, web3.utils.toWei("1.1", "ether"));
      result = await derivativeContract.settle();
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "5");

      // Verify nav and balances at settlement.
      let priceReturn = web3.utils.toBN(web3.utils.toWei("1.1", "ether"));
      const expectedSettlementNav = computeNewNav(initialNav, priceReturn, feesPerInterval);
      const expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
      let changeInNav = expectedSettlementNav.sub(initialNav);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      expectedInvestorAccountBalance = longBalance.add(changeInNav);
      expectedSponsorAccountBalance = shortBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      truffleAssert.eventEmitted(result, "Settled", ev => {
        return (
          ev.finalNav.toString() === expectedSettlementNav.toString() &&
          ev.settleTime.toString() === expirationTime.toString()
        );
      });
      assert.equal(actualNav.toString(), expectedSettlementNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());
    });

    it(annotateTitle("Live -> Expired -> Settled (oracle price) [price available]"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // One time step until expiry.
      await deployNewTokenizedDerivative({ expiry: priceFeedUpdatesInterval });

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.5", "ether"),
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
      const expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
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
      await deployNewTokenizedDerivative({ expiry: priceFeedUpdatesInterval * 3 });

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.5", "ether"),
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
      let expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
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
      expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
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
      expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
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
      await deployNewTokenizedDerivative({ expiry: priceFeedUpdatesInterval * 3 });

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
        web3.utils.toWei("1.5", "ether"),
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
      await derivativeContract.deposit(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1", "ether"))
      );

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

      // Set the Oracle fee to 0 for this withdraw. This is required because the oracle fee is set so high in these
      // tests that, when we skip a full day, the fee will add up to > 100% (8640%, specifically) driving the contract
      // balance to 0.
      await deployedCentralizedStore.setFixedOracleFeePerSecond(0);

      // // Now that 24 hours has passed, the limit has been reset, so 0.1 should be withdrawable.
      await derivativeContract.withdraw(web3.utils.toWei("0.1", "ether"), { from: sponsor });

      // Reset the Oracle fee.
      await deployedCentralizedStore.setFixedOracleFeePerSecond(oracleFeePerSecond);
    });

    it(annotateTitle("Live -> Remargin -> Emergency shutdown"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.6", "ether"),
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
      await deployedCentralizedOracle.callEmergencyShutdown(derivativeContract.address, { from: owner });

      // TODO: add back this test once we determine how to listen for indirect events (not declared within the called contract).
      // truffleAssert.eventEmitted(result, "EmergencyShutdownTransition", ev => {
      //   return ev.shutdownTime.toString() === lastRemarginTime.toString();
      // });

      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "4");

      // Can't call emergency shutdown while already in emergency shutdown.
      assert(
        await didContractThrow(
          deployedCentralizedOracle.callEmergencyShutdown(derivativeContract.address, { from: owner })
        )
      );

      // Provide Oracle price and call settle().
      await deployedCentralizedOracle.pushPrice(identifierBytes, lastRemarginTime, web3.utils.toWei("1.3", "ether"));
      await derivativeContract.settle();
      state = (await derivativeContract.derivativeStorage()).state;
      assert.equal(state.toString(), "5");

      // Verify that balances and NAV reflect the Oracle price.
      const priceReturn = web3.utils.toBN(web3.utils.toWei("1.3", "ether"));
      const expectedNav = computeNewNav(actualNav, priceReturn, feesPerInterval);
      const changeInNav = expectedNav.sub(actualNav);
      const expectedOracleFee = computeExpectedOracleFees(longBalance, shortBalance);
      actualNav = (await derivativeContract.derivativeStorage()).nav;
      const expectedInvestorAccountBalance = longBalance.add(changeInNav);
      const expectedSponsorAccountBalance = shortBalance.sub(changeInNav).sub(expectedOracleFee);
      longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;
      assert.equal(actualNav.toString(), expectedNav.toString());
      assert.equal(longBalance.toString(), expectedInvestorAccountBalance.toString());
      assert.equal(shortBalance.toString(), expectedSponsorAccountBalance.toString());

      // Can't call emergency shutdown in the Settled state.
      assert(
        await didContractThrow(
          deployedCentralizedOracle.callEmergencyShutdown(derivativeContract.address, { from: owner })
        )
      );
    });

    it(annotateTitle("Live -> Expiry -> Settled (Default)"), async function() {
      // Deploy TokenizedDerivative with 0 fee to make computations simpler.
      await deployNewTokenizedDerivative({ fixedYearlyFee: "0", expiry: priceFeedUpdatesInterval });

      // Set oracle fee to 0 for ease of computing expected penalties.
      await deployedCentralizedStore.setFixedOracleFeePerSecond("0");

      // Sponsor initializes contract.
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.075", "ether"),
        web3.utils.toWei("0.5", "ether"),
        await getMarginParams(web3.utils.toWei("1.075", "ether"))
      );

      // Push a new price to push the contract into expiry.
      await pushPrice(web3.utils.toWei("1", "ether"));
      await derivativeContract.remargin({ from: sponsor });

      // Resolve it to a defaulting price.
      const expireTime = (await deployedManualPriceFeed.getCurrentTime()).toString();
      await deployedCentralizedOracle.pushPrice(identifierBytes, expireTime, web3.utils.toWei("2", "ether"));
      await derivativeContract.settle({ from: sponsor });

      // This resolution should leave 0.075 left in the short margin account with a margin requirement of 0.1.
      // Therefore a default penalty of 0.025 should be charged to the short margin account leaving 0.05 in the short
      // margin account.
      // The long account should get the final nav of 1 and a 0.025 default penalty leaving a final balance of 1.025.
      const storage = await derivativeContract.derivativeStorage();
      assert.equal(storage.shortBalance.toString(), web3.utils.toWei("0.05"));
      assert.equal(storage.longBalance.toString(), web3.utils.toWei("1.025"));

      // Make sure the balances are withdrawable.
      await derivativeContract.withdraw(web3.utils.toWei("0.05"), { from: sponsor });
      await approveDerivativeTokens(web3.utils.toWei("0.5", "ether"));
      await derivativeContract.redeemTokens(web3.utils.toWei("0.5", "ether"), { from: sponsor });
      assert.equal((await getContractBalance()).toString(), "0");

      // Reset Oracle fee.
      await deployedCentralizedStore.setFixedOracleFeePerSecond(oracleFeePerSecond);
    });

    it(annotateTitle("Live -> EmergencyShutdown -> Settled (Default)"), async function() {
      // Deploy TokenizedDerivative with 0 fee to make computations simpler.
      await deployNewTokenizedDerivative({ fixedYearlyFee: "0" });

      // Set oracle fee to 0 for ease of computing expected penalties.
      await deployedCentralizedStore.setFixedOracleFeePerSecond("0");

      // Sponsor initializes contract.
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.075", "ether"),
        web3.utils.toWei("0.5", "ether"),
        await getMarginParams(web3.utils.toWei("1.075", "ether"))
      );

      // Push a new price and emergency shut down the contract.
      await pushPrice(web3.utils.toWei("1", "ether"));
      await derivativeContract.remargin({ from: sponsor });
      await deployedCentralizedOracle.callEmergencyShutdown(derivativeContract.address, { from: owner });

      // Resolve it to a defaulting price.
      const shutdownTime = (await deployedManualPriceFeed.getCurrentTime()).toString();
      await deployedCentralizedOracle.pushPrice(identifierBytes, shutdownTime, web3.utils.toWei("2", "ether"));
      await derivativeContract.settle({ from: sponsor });

      // This resolution should leave 0.075 left in the short margin account with a margin requirement of 0.1.
      // Therefore a default penalty of 0.025 should be charged to the short margin account leaving 0.05 in the short
      // margin account.
      // The long account should get the final nav of 1 and a 0.025 default penalty leaving a final balance of 1.025.
      const storage = await derivativeContract.derivativeStorage();
      assert.equal(storage.shortBalance.toString(), web3.utils.toWei("0.05"));
      assert.equal(storage.longBalance.toString(), web3.utils.toWei("1.025"));

      // Make sure the balances are withdrawable.
      await derivativeContract.withdraw(web3.utils.toWei("0.05"), { from: sponsor });
      await approveDerivativeTokens(web3.utils.toWei("0.5", "ether"));
      await derivativeContract.redeemTokens(web3.utils.toWei("0.5", "ether"), { from: sponsor });
      assert.equal((await getContractBalance()).toString(), "0");

      // Reset Oracle fee.
      await deployedCentralizedStore.setFixedOracleFeePerSecond(oracleFeePerSecond);
    });

    it(annotateTitle("Live -> Dispute -> Settled (Default)"), async function() {
      // Deploy TokenizedDerivative with 0 fee to make computations simpler.
      await deployNewTokenizedDerivative({ fixedYearlyFee: "0" });

      // Set oracle fee to 0 for ease of computing expected penalties.
      await deployedCentralizedStore.setFixedOracleFeePerSecond("0");

      // Sponsor initializes contract.
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.075", "ether"),
        web3.utils.toWei("0.5", "ether"),
        await getMarginParams(web3.utils.toWei("1.075", "ether"))
      );

      // Push a new price and dispute it.
      await pushPrice(web3.utils.toWei("1", "ether"));
      await derivativeContract.remargin({ from: sponsor });
      await derivativeContract.dispute(
        web3.utils.toWei("0.025", "ether"),
        await getMarginParams(web3.utils.toWei("0.025", "ether"))
      );

      // Resolve it to a defaulting price.
      const disputeTime = (await derivativeContract.derivativeStorage()).currentTokenState.time.toString();
      await deployedCentralizedOracle.pushPrice(identifierBytes, disputeTime, web3.utils.toWei("2", "ether"));
      await derivativeContract.settle({ from: sponsor });

      // This resolution should leave 0.075 left in the short margin account with a margin requirement of 0.1.
      // Therefore a default penalty of 0.025 should be charged to the short margin account. The 0.025 dispute deposit
      // should be added to the short account leaving exactly 0.075.
      // The long account should get the final nav of 1 and a 0.025 default penalty leaving a final balance of 1.025.
      const storage = await derivativeContract.derivativeStorage();
      assert.equal(storage.shortBalance.toString(), web3.utils.toWei("0.075"));
      assert.equal(storage.longBalance.toString(), web3.utils.toWei("1.025"));

      // Make sure the balances are withdrawable.
      await derivativeContract.withdraw(web3.utils.toWei("0.075"), { from: sponsor });
      await approveDerivativeTokens(web3.utils.toWei("0.5", "ether"));
      await derivativeContract.redeemTokens(web3.utils.toWei("0.5", "ether"), { from: sponsor });
      assert.equal((await getContractBalance()).toString(), "0");

      // Reset Oracle fee.
      await deployedCentralizedStore.setFixedOracleFeePerSecond(oracleFeePerSecond);
    });

    it(annotateTitle("Live -> Create -> Create fails on expiry"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // One time step until expiry.
      await deployNewTokenizedDerivative({ expiry: priceFeedUpdatesInterval });

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.6", "ether"),
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.6", "ether"))
      );

      // Push time forward, so that the contract will expire when remargin is called.
      await pushPrice(web3.utils.toWei("1", "ether"));

      // Tokens cannot be created because the contract has expired.
      assert(
        await didContractThrow(
          derivativeContract.createTokens(
            web3.utils.toWei("1", "ether"),
            await getMarginParams(web3.utils.toWei("1", "ether"))
          )
        )
      );
    });

    it(annotateTitle("DepositAndCreateTokens failure"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      // One time step until expiry.
      await deployNewTokenizedDerivative({ expiry: priceFeedUpdatesInterval });

      // Token creation should fail because the sponsor doesn't supply enough margin.
      assert(
        await didContractThrow(
          derivativeContract.depositAndCreateTokens(
            web3.utils.toWei("1.05", "ether"),
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
            web3.utils.toWei("1.5", "ether"),
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
        web3.utils.toWei("1.5", "ether"),
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("1.5", "ether"), apDelegate)
      );

      // AP Delegate can call createTokens.
      await derivativeContract.createTokens(
        web3.utils.toWei("0.1", "ether"),
        web3.utils.toWei("0.1", "ether"),
        await getMarginParams(web3.utils.toWei("0.1", "ether"), apDelegate)
      );

      // AP Delegate can call redeemTokens.
      await approveDerivativeTokens(web3.utils.toWei("1.1", "ether"), apDelegate);
      await derivativeContract.redeemTokens(web3.utils.toWei("1.1", "ether"), { from: apDelegate });

      assert(
        await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.1", "ether"), { from: apDelegate }))
      );
      assert(
        await didContractThrow(
          derivativeContract.deposit(
            web3.utils.toWei("0.1", "ether"),
            await getMarginParams(web3.utils.toWei("0.1", "ether"), apDelegate)
          )
        )
      );

      // Reset AP Delegate to a random address.
      await derivativeContract.setApDelegate(web3.utils.randomHex(20), { from: sponsor });

      // Previous AP Delegate cannot call depositAndCreateTokens now that it has been changed.
      assert(
        await didContractThrow(
          derivativeContract.depositAndCreateTokens(
            web3.utils.toWei("1.5", "ether"),
            web3.utils.toWei("1", "ether"),
            await getMarginParams(web3.utils.toWei("1.5", "ether"), apDelegate)
          )
        )
      );
    });

    it(annotateTitle("Basic Linear NAV"), async function() {
      // To detect the difference between linear and compounded, the contract requires |leverage| > 1.
      const levered2x = await LeveragedReturnCalculator.new(2);
      await returnCalculatorWhitelist.addToWhitelist(levered2x.address);

      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative({
        returnType: "0", // Linear
        fixedYearlyFee: "0",
        returnCalculator: levered2x.address,
        startingTokenPrice: web3.utils.toWei("0.5"),
        startingUnderlyingPrice: web3.utils.toWei("2")
      });

      let state = (await derivativeContract.derivativeStorage()).state;
      let tokensOutstanding = await derivativeContract.totalSupply();
      let nav = (await derivativeContract.derivativeStorage()).nav;

      assert.equal(state.toString(), "0");
      assert.equal(tokensOutstanding.toString(), "0");
      assert.equal(nav.toString(), "0");

      let longBalance = (await derivativeContract.derivativeStorage()).longBalance;
      let shortBalance = (await derivativeContract.derivativeStorage()).shortBalance;

      // Ensure the short balance is 0 ETH (as is deposited in beforeEach()).
      assert.equal(shortBalance.toString(), web3.utils.toWei("0", "ether"));
      assert.equal(longBalance.toString(), web3.utils.toWei("0", "ether"));

      // The margin requirement should start at 0.
      let excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(excessMargin.toString(), "0");

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("3", "ether"),
        web3.utils.toWei("2", "ether"),
        await getMarginParams(web3.utils.toWei("3", "ether"))
      );

      // Underlying Price -> 1.5
      await pushPrice(web3.utils.toWei("1.5", "ether"));
      await derivativeContract.remargin({ from: sponsor });

      // nav = quantity * startingTokenPrice * (1 + leverage * ((currentUnderlyingPrice - startingUnderlyingPrice) / startingUnderlyingPrice))
      //     = 2 * 0.5 * (1 + 2 * ((1 - 1.5) / 2))
      //     = 1 * (1 + 2 * (-1/4))
      //     = 1 * 0.5
      //     = 0.5
      nav = await derivativeContract.calcNAV();
      assert.equal(nav.toString(), web3.utils.toWei("0.5", "ether"));

      // Margin requirement = quantity * |leverage| * startingTokenPrice / startingUnderlyingPrice * currentUnderlyingPrice * supportedMove
      //                    = 2 * 2 * 0.5 / 2 * 1.5 * 0.1
      //                    = 0.15
      let expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0.15", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());

      // Underlying Price -> 2
      await pushPrice(web3.utils.toWei("2", "ether"));
      await derivativeContract.remargin({ from: sponsor });

      // nav = quantity * startingTokenPrice * (1 + leverage * ((currentUnderlyingPrice - startingUnderlyingPrice) / startingUnderlyingPrice))
      //     = 2 * 0.5 * (1 + 2 * ((2 - 2) / 2))
      //     = 1 * 1
      //     = 1
      nav = await derivativeContract.calcNAV();
      assert.equal(nav.toString(), web3.utils.toWei("1", "ether"));

      // Margin requirement = quantity * |leverage| * startingTokenPrice / startingUnderlyingPrice * currentUnderlyingPrice * supportedMove
      //                    = 2 * 2 * 0.5 / 2 * 2 * 0.1
      //                    = 0.2
      expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0.2", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());
    });

    it(annotateTitle("Basic Compound NAV"), async function() {
      // To detect the difference between linear and compounded, the contract requires |leverage| > 1.
      const levered2x = await LeveragedReturnCalculator.new(2);
      await returnCalculatorWhitelist.addToWhitelist(levered2x.address);

      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative({
        returnType: "1", // Compound
        fixedYearlyFee: "0",
        returnCalculator: levered2x.address,
        startingTokenPrice: web3.utils.toWei("0.5"),
        startingUnderlyingPrice: web3.utils.toWei("2")
      });

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("3", "ether"),
        web3.utils.toWei("2", "ether"),
        await getMarginParams(web3.utils.toWei("3", "ether"))
      );

      // Underlying Price -> 1.5
      await pushPrice(web3.utils.toWei("1.5", "ether"));
      await derivativeContract.remargin({ from: sponsor });

      // nav = quantity * lastTokenPrice * (1 + leverage * ((currentUnderlyingPrice - lastUnderlyingPrice) / lastUnderlyingPrice))
      //     = 2 * 0.5 * (1 + 2 * ((1 - 1.5) / 2))
      //     = 1 * (1 + 2 * (-1/4))
      //     = 1 * 0.5
      //     = 0.5
      let nav = await derivativeContract.calcNAV();
      assert.equal(nav.toString(), web3.utils.toWei("0.5", "ether"));

      // Margin requirement = quantity * tokenPrice * |leverage| * supportedMove
      //                    = 2 * 0.25 * 2 * 0.1
      //                    = 0.1
      let expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0.1", "ether"));
      let shortBalance = await derivativeContract.calcShortMarginBalance();
      let excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());

      // Underlying Price -> 2
      await pushPrice(web3.utils.toWei("2", "ether"));
      await derivativeContract.remargin({ from: sponsor });

      // nav = quantity * lastTokenPrice * (1 + leverage * ((currentUnderlyingPrice - lastUnderlyingPrice) / lastUnderlyingPrice))
      //     = 2 * 0.25 * (1 + 2 * ((2 - 1.5) / 1.5))
      //     = 2 * 0.25 * (1 + 2/3)
      //     = 2 * 0.25 * 5/3
      //     = 5/6
      nav = await derivativeContract.calcNAV();
      const oneEth = BigNumber(web3.utils.toWei("1", "ether"));
      const five = BigNumber(5);
      const six = BigNumber(6);
      const one = BigNumber(1);

      // Note: as mentioned elsewhere, because of the intermediate values in the fixed point solidity math, we
      // occassionally see 1 wei rounding errors. The .minus(one) is to compensate for this rounding error.
      assert.equal(
        nav.toString(),
        five
          .times(oneEth)
          .div(six)
          .integerValue(BigNumber.ROUND_FLOOR)
          .minus(one)
          .toString()
      );

      // Margin requirement = quantity * tokenPrice * |leverage| * supportedMove
      //                    = 2 * 5/12 * 2 * 0.1
      //                    = 5/30
      //                    = 1/6
      expectedMarginRequirement = oneEth
        .div(six)
        .integerValue(BigNumber.ROUND_FLOOR)
        .toString();
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());
    });

    it(annotateTitle("Linear NAV - Negative Token Price"), async function() {
      // To detect the difference between linear and compounded, the contract requires |leverage| > 1.
      const levered2x = await LeveragedReturnCalculator.new(2);
      await returnCalculatorWhitelist.addToWhitelist(levered2x.address);

      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative({
        returnType: "0", // Linear
        fixedYearlyFee: "0",
        returnCalculator: levered2x.address,
        startingTokenPrice: web3.utils.toWei("0.5"),
        startingUnderlyingPrice: web3.utils.toWei("2")
      });

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("3", "ether"),
        web3.utils.toWei("2", "ether"),
        await getMarginParams(web3.utils.toWei("3", "ether"))
      );

      // Underlying Price -> 0.5
      await pushPrice(web3.utils.toWei("0.5", "ether"));
      await derivativeContract.remargin({ from: sponsor });

      // nav = quantity * startingTokenPrice * (1 + leverage * ((currentUnderlyingPrice - startingUnderlyingPrice) / startingUnderlyingPrice))
      //     = 2 * 0.5 * (1 + 2 * ((0.5 - 2) / 2))
      //     = 1 * (1 + 2 * (-3/4))
      //     = 1 * -0.5
      //     = -0.5
      nav = await derivativeContract.calcNAV();
      assert.equal(nav.toString(), web3.utils.toWei("-0.5", "ether"));

      // Margin requirement = quantity * |leverage| * startingTokenPrice / startingUnderlyingPrice * currentUnderlyingPrice * supportedMove
      //                    = 2 * 2 * 0.5 / 2 * 0.5 * 0.1
      //                    = 0.05
      let expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0.05", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());

      let storage = await derivativeContract.derivativeStorage();
      let contractBalance = await getContractBalance();

      // The long account should be completely drained and the short account should have all the margin in the contract.
      assert.equal(storage.longBalance.toString(), "0");
      assert.equal(storage.shortBalance.toString(), contractBalance.toString());

      // Redeem half of the tokens.
      await approveDerivativeTokens(web3.utils.toWei("1", "ether"));
      await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: sponsor });

      // nav = quantity * startingTokenPrice * (1 + leverage * ((currentUnderlyingPrice - startingUnderlyingPrice) / startingUnderlyingPrice))
      //     = 1 * 0.5 * (1 + 2 * ((0.5 - 2) / 2))
      //     = 0.5 * (1 + 2 * (-3/4))
      //     = 0.5 * -0.5
      //     = -0.25
      nav = await derivativeContract.calcNAV();
      assert.equal(nav.toString(), web3.utils.toWei("-0.25", "ether"));

      // Margin requirement = quantity * |leverage| * startingTokenPrice / startingUnderlyingPrice * currentUnderlyingPrice * supportedMove
      //                    = 1 * 2 * 0.5 / 2 * 0.5 * 0.1
      //                    = 0.025
      expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0.025", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());

      // Get updated storage and balance.
      storage = await derivativeContract.derivativeStorage();
      let newContractBalance = await getContractBalance();

      // The contract balance shouldn't have changed during the token redemption call.
      assert.equal(newContractBalance.toString(), contractBalance.toString());

      // Balances should still be exactly the same as they were before.
      assert.equal(storage.longBalance.toString(), "0");
      assert.equal(storage.shortBalance.toString(), newContractBalance.toString());

      // Total supply should be 1 token.
      let totalSupply = await derivativeContract.totalSupply();
      assert.equal(totalSupply.toString(), web3.utils.toWei("1", "ether"));

      // Ensure token creation is still limited by the margin requirement.
      assert(
        await didContractThrow(derivativeContract.createTokens(web3.utils.toWei("125", "ether"), { from: sponsor }))
      );

      // Should be able to create tokens without sending any margin, since the token price is negative.
      await derivativeContract.createTokens("0", web3.utils.toWei("1", "ether"), { from: sponsor });

      // Total supply should be 2 tokens after creation.
      totalSupply = await derivativeContract.totalSupply();
      assert.equal(totalSupply.toString(), web3.utils.toWei("2", "ether"));

      // nav = quantity * startingTokenPrice * (1 + leverage * ((currentUnderlyingPrice - startingUnderlyingPrice) / startingUnderlyingPrice))
      //     = 2 * 0.5 * (1 + 2 * ((0.5 - 2) / 2))
      //     = 1 * (1 + 2 * (-3/4))
      //     = 1 * -0.5
      //     = -0.5
      nav = await derivativeContract.calcNAV();
      assert.equal(nav.toString(), web3.utils.toWei("-0.5", "ether"));

      // Margin requirement = quantity * |leverage| * startingTokenPrice / startingUnderlyingPrice * currentUnderlyingPrice * supportedMove
      //                    = 2 * 2 * 0.5 / 2 * 0.5 * 0.1
      //                    = 0.05
      expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0.05", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());

      // Ensure the price can rebound from a negative value.
      // Underlying Price -> 2
      await pushPrice(web3.utils.toWei("2", "ether"));

      // Calculate calcNav pre-remargin to ensure it uses the linear NAV function.
      let calcNav = await derivativeContract.calcNAV();

      await derivativeContract.remargin({ from: sponsor });

      // nav = quantity * startingTokenPrice * (1 + leverage * ((currentUnderlyingPrice - startingUnderlyingPrice) / startingUnderlyingPrice))
      //     = 2 * 0.5 * (1 + 2 * ((2 - 2) / 2))
      //     = 1 * 1
      //     = 1
      nav = (await derivativeContract.derivativeStorage()).nav;

      // Ensure calcNav accurately predicted the correct NAV change.
      assert.equal(calcNav.toString(), nav.toString());
      assert.equal(nav.toString(), web3.utils.toWei("1", "ether"));

      // Margin requirement = quantity * |leverage| * startingTokenPrice / startingUnderlyingPrice * currentUnderlyingPrice * supportedMove
      //                    = 2 * 2 * 0.5 / 2 * 2 * 0.1
      //                    = 0.2
      expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0.2", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());
    });

    it(annotateTitle("Compound NAV - Zero Token Price"), async function() {
      // To detect the difference between linear and compounded, the contract requires |leverage| > 1.
      const levered2x = await LeveragedReturnCalculator.new(2);
      await returnCalculatorWhitelist.addToWhitelist(levered2x.address);

      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative({
        returnType: "1", // Compound
        fixedYearlyFee: "0",
        returnCalculator: levered2x.address,
        startingTokenPrice: web3.utils.toWei("0.5"),
        startingUnderlyingPrice: web3.utils.toWei("2")
      });

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("3", "ether"),
        web3.utils.toWei("2", "ether"),
        await getMarginParams(web3.utils.toWei("3", "ether"))
      );

      // Underlying Price -> 0.5
      await pushPrice(web3.utils.toWei("0.5", "ether"));
      await derivativeContract.remargin({ from: sponsor });

      // nav = quantity * lastTokenPrice * (1 + leverage * ((currentUnderlyingPrice - lastUnderlyingPrice) / lastUnderlyingPrice))
      //     = 2 * 0.5 * (1 + 2 * ((0.5 - 2) / 2))
      //     = 1 * (1 + 2 * (-3/4))
      //     = 1 * -0.5
      //     = -0.5 -> 0 becuase compound NAV bottoms out at 0.
      nav = await derivativeContract.calcNAV();
      assert.equal(nav.toString(), web3.utils.toWei("0", "ether"));

      // Margin requirement = quantity * tokenPrice * |leverage| * supportedMove
      //                    = 2 * 0 * 2 * 0.1
      //                    = 0
      let expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());

      let storage = await derivativeContract.derivativeStorage();
      let contractBalance = await getContractBalance();

      // The long account should be completely drained and the short account should have all the margin in the contract.
      assert.equal(storage.longBalance.toString(), "0");
      assert.equal(storage.shortBalance.toString(), contractBalance.toString());

      // Redeem half of the tokens.
      await approveDerivativeTokens(web3.utils.toWei("1", "ether"));
      await derivativeContract.redeemTokens(web3.utils.toWei("1", "ether"), { from: sponsor });

      // nav = quantity * lastTokenPrice * (1 + leverage * ((currentUnderlyingPrice - lastUnderlyingPrice) / lastUnderlyingPrice))
      //     = 1 * 0.5 * (1 + 2 * ((0.5 - 2) / 2))
      //     = 0.5 * (1 + 2 * (-3/4))
      //     = 0.5 * -0.5
      //     = -0.25 -> 0 becuase compound NAV bottoms out at 0.
      nav = await derivativeContract.calcNAV();
      assert.equal(nav.toString(), web3.utils.toWei("0", "ether"));

      // Margin requirement = quantity * tokenPrice * |leverage| * supportedMove
      //                    = 1 * 0 * 2 * 0.1
      //                    = 0
      expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());

      // Get updated storage and balance.
      storage = await derivativeContract.derivativeStorage();
      let newContractBalance = await getContractBalance();

      // The contract balance shouldn't have changed during the token redemption call.
      assert.equal(newContractBalance.toString(), contractBalance.toString());

      // Balances should still be exactly the same as they were before.
      assert.equal(storage.longBalance.toString(), "0");
      assert.equal(storage.shortBalance.toString(), newContractBalance.toString());

      // Total supply should be 1 token.
      let totalSupply = await derivativeContract.totalSupply();
      assert.equal(totalSupply.toString(), web3.utils.toWei("1", "ether"));

      // Should be able to create tokens without sending any margin, since the token price is negative.
      await derivativeContract.createTokens("0", web3.utils.toWei("1", "ether"), { from: sponsor });

      // Total supply should be 2 tokens after creation.
      totalSupply = await derivativeContract.totalSupply();
      assert.equal(totalSupply.toString(), web3.utils.toWei("2", "ether"));

      // nav = quantity * lastTokenPrice * (1 + leverage * ((currentUnderlyingPrice - lastUnderlyingPrice) / lastUnderlyingPrice))
      //     = 2 * 0 * (1 + 2 * ((0.5 - 2) / 2))
      //     = 0 * (1 + 2 * (-3/4))
      //     = 0 * -0.5
      //     = 0
      nav = await derivativeContract.calcNAV();
      assert.equal(nav.toString(), web3.utils.toWei("0", "ether"));

      // Margin requirement = quantity * tokenPrice * |leverage| * supportedMove
      //                    = 2 * 0 * 0.5 / 2 * 0.5 * 0.1
      //                    = 0
      expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());

      // Ensure the price cannot rebound from a negative value.
      // Underlying Price -> 2
      await pushPrice(web3.utils.toWei("2", "ether"));

      // Calculate calcNav pre-remargin to ensure it uses the compound NAV function.
      let calcNav = await derivativeContract.calcNAV();

      await derivativeContract.remargin({ from: sponsor });

      // nav = quantity * lastTokenPrice * (1 + leverage * ((currentUnderlyingPrice - lastUnderlyingPrice) / lastUnderlyingPrice))
      //     = 2 * 0 * (1 + 2 * ((2 - 2) / 2))
      //     = 0 * 1
      //     = 0
      nav = (await derivativeContract.derivativeStorage()).nav;

      // Ensure calcNav accurately predicted the correct NAV change.
      assert.equal(calcNav.toString(), nav.toString());
      assert.equal(nav.toString(), web3.utils.toWei("0", "ether"));

      // Margin requirement = quantity * tokenPrice * |leverage| * supportedMove
      //                    = 2 * 0 * 2 * 0.1
      //                    = 0
      expectedMarginRequirement = web3.utils.toBN(web3.utils.toWei("0", "ether"));
      shortBalance = await derivativeContract.calcShortMarginBalance();
      excessMargin = await derivativeContract.calcExcessMargin();
      assert.equal(expectedMarginRequirement.toString(), shortBalance.sub(excessMargin).toString());
    });

    it(annotateTitle("Argument/value sent inconsistency"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Test deposit and create for correct margin handling.
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("2", "ether"),
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("3", "ether"))
      );

      assert.equal((await getContractBalance()).toString(), web3.utils.toWei("2", "ether"));

      // Test deposit for correct margin handling.
      await derivativeContract.deposit(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("2", "ether"))
      );

      assert.equal((await getContractBalance()).toString(), web3.utils.toWei("3", "ether"));

      // Check redeem for correct token handling.
      await approveDerivativeTokens(web3.utils.toWei("1", "ether"));
      await derivativeContract.redeemTokens(web3.utils.toWei("0.5", "ether"), { from: sponsor });

      assert.equal(await derivativeContract.balanceOf(sponsor), web3.utils.toWei("0.5", "ether"));

      // Verify that if less margin is sent (in the non pre-approval case) than specified in the arguments, all methods
      // that add margin or tokens will revert.
      if (!testVariant.preAuth) {
        // All methods should revert if less margin is specified than is sent.
        assert(
          await didContractThrow(
            derivativeContract.depositAndCreateTokens(
              web3.utils.toWei("3", "ether"),
              web3.utils.toWei("1", "ether"),
              await getMarginParams(web3.utils.toWei("2", "ether"))
            )
          )
        );

        assert(
          await didContractThrow(
            derivativeContract.deposit(
              web3.utils.toWei("2", "ether"),
              await getMarginParams(web3.utils.toWei("1", "ether"))
            )
          )
        );

        await approveDerivativeTokens(web3.utils.toWei("0.25", "ether"));
        assert(
          await didContractThrow(derivativeContract.redeemTokens(web3.utils.toWei("0.5", "ether"), { from: sponsor }))
        );

        assert(
          await didContractThrow(
            derivativeContract.dispute(
              web3.utils.toWei("2", "ether"),
              await getMarginParams(web3.utils.toWei("1", "ether"))
            )
          )
        );
      }

      // Verify correct handling of margin in dispute.
      await derivativeContract.dispute(
        web3.utils.toWei("1", "ether"),
        await getMarginParams(web3.utils.toWei("2", "ether"))
      );

      const derivativeStorage = await derivativeContract.derivativeStorage();
      const depositAmount = web3.utils.toBN((await derivativeContract.derivativeStorage()).disputeInfo.deposit);
      const startingContractBalance = web3.utils.toBN(web3.utils.toWei("2.5", "ether"));

      assert.equal((await getContractBalance()).toString(), startingContractBalance.add(depositAmount).toString());
    });

    it(annotateTitle("Withdraw unexpected ERC20"), async function() {
      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      // Sponsor initializes contract
      await derivativeContract.depositAndCreateTokens(
        web3.utils.toWei("1.075", "ether"),
        web3.utils.toWei("0.5", "ether"),
        await getMarginParams(web3.utils.toWei("1.075", "ether"))
      );

      // Transfer 0.5 tokens of the margin currency to the derivative address.
      // Note: this tests when the ERC20 token is the margin currency and when it isn't because this test is also
      // run with ETH as the margin currency.
      await marginToken.transfer(derivativeContract.address, web3.utils.toWei("0.5", "ether"), { from: sponsor });

      // Tranfer some of the derivative contract's tokens back to ensure they can be withdrawn.
      await derivativeContract.transfer(derivativeContract.address, web3.utils.toWei("0.25", "ether"), {
        from: sponsor
      });

      // Push a new price and remargin.
      await pushPrice(web3.utils.toWei("1", "ether"));
      await derivativeContract.remargin({ from: sponsor });

      // Attempt to withdraw more tokens than erroneously transferred.
      assert(
        await didContractThrow(
          derivativeContract.withdrawUnexpectedErc20(marginToken.address, web3.utils.toWei("0.51", "ether"), {
            from: sponsor
          })
        )
      );

      // Partially withdraw the erroneous tokens pre-dispute.
      await derivativeContract.withdrawUnexpectedErc20(marginToken.address, web3.utils.toWei("0.1", "ether"), {
        from: sponsor
      });

      // Dispute the new price.
      await derivativeContract.dispute(
        web3.utils.toWei("0.025", "ether"),
        await getMarginParams(web3.utils.toWei("0.025", "ether"))
      );

      // Resolve it to a defaulting price.
      const disputeTime = (await derivativeContract.derivativeStorage()).currentTokenState.time.toString();

      // Attempt to withdraw more than was transferred in.
      assert(
        await didContractThrow(
          derivativeContract.withdrawUnexpectedErc20(marginToken.address, web3.utils.toWei("0.41", "ether"), {
            from: sponsor
          })
        )
      );
      assert(
        await didContractThrow(
          derivativeContract.withdrawUnexpectedErc20(derivativeContract.address, web3.utils.toWei("0.26", "ether"), {
            from: sponsor
          })
        )
      );

      // Attempt to withdraw from a non-sponsor address.
      assert(
        await didContractThrow(
          derivativeContract.withdrawUnexpectedErc20(marginToken.address, web3.utils.toWei("0.4", "ether"), {
            from: thirdParty
          })
        )
      );

      // Withdraw the tokens that were erroneously deposited.
      await derivativeContract.withdrawUnexpectedErc20(marginToken.address, web3.utils.toWei("0.4", "ether"), {
        from: sponsor
      });
      await derivativeContract.withdrawUnexpectedErc20(derivativeContract.address, web3.utils.toWei("0.25", "ether"), {
        from: sponsor
      });
    });

    it(annotateTitle("Creation Time"), async function() {
      // Set the current time in the creator and expect that that time will propagate to the derivative.
      const creationTime = "1550878663";
      tokenizedDerivativeCreator.setCurrentTime(creationTime);

      // A new TokenizedDerivative must be deployed before the start of each test case.
      await deployNewTokenizedDerivative();

      assert.equal((await derivativeContract.derivativeStorage()).fixedParameters.creationTime, creationTime);
    });

    it(annotateTitle("Constructor assertions"), async function() {
      const defaultConstructorParams = {
        sponsor: sponsor,
        defaultPenalty: web3.utils.toWei("0.5", "ether"),
        supportedMove: web3.utils.toWei("0.1", "ether"),
        product: identifierBytes,
        fixedYearlyFee: web3.utils.toWei("0.01", "ether"),
        disputeDeposit: web3.utils.toWei("0.5", "ether"),
        returnCalculator: noLeverageCalculator.address,
        startingTokenPrice: web3.utils.toWei("1", "ether"),
        expiry: "0",
        marginCurrency: marginTokenAddress(),
        withdrawLimit: web3.utils.toWei("0.33", "ether"),
        returnType: "1", // Compound
        startingUnderlyingPrice: "0", // Use price feed
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
        defaultPenalty: web3.utils.toWei("1.1", "ether")
      };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(defaultPenaltyAboveMrParams, { from: sponsor })
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

      // Unapproved sponsor.
      const unapprovedSponsorParams = defaultConstructorParams;
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(unapprovedSponsorParams, { from: thirdParty })
        )
      );

      // Unapproved returnCalculator.
      const unapprovedReturnCalculator = await LeveragedReturnCalculator.new(1);
      const unapprovedReturnCalculatorParams = {
        ...defaultConstructorParams,
        returnCalculator: unapprovedReturnCalculator.address
      };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(unapprovedReturnCalculatorParams, { from: sponsor })
        )
      );

      // Unapproved margin currency.
      const unapprovedCurrency = await ERC20Mintable.new({ from: sponsor });
      const unapprovedCurrencyParams = { ...defaultConstructorParams, marginCurrency: unapprovedCurrency.address };
      assert(
        await didContractThrow(
          tokenizedDerivativeCreator.createTokenizedDerivative(unapprovedCurrencyParams, { from: sponsor })
        )
      );
    });
  });
});
