const { didContractThrow } = require("./utils/DidContractThrow.js");

const Derivative = artifacts.require("Derivative");
const Registry = artifacts.require("Registry");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const CentralizedOracle = artifacts.require("CentralizedOracle");
const DerivativeCreator = artifacts.require("DerivativeCreator");

contract("Derivative", function(accounts) {
  let identifierBytes;
  let derivativeContract;
  let deployedRegistry;
  let deployedDerivativeCreator;

  const ownerAddress = accounts[0];
  const takerAddress = accounts[1];
  const makerAddress = accounts[2];

  const priceFeedUpdatesInterval = 60;

  const pushPrice = async price => {
    const latestTime = parseInt(await deployedManualPriceFeed.getCurrentTime(), 10) + priceFeedUpdatesInterval;
    await deployedManualPriceFeed.setCurrentTime(latestTime);
    await deployedManualPriceFeed.pushLatestPrice(identifierBytes, latestTime, price);
  };

  before(async function() {
    identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex("ETH/USD"));
    // Set the deployed registry and oracle.
    deployedRegistry = await Registry.deployed();
    deployedCentralizedOracle = await CentralizedOracle.deployed();
    deployedManualPriceFeed = await ManualPriceFeed.deployed();
    deployedDerivativeCreator = await DerivativeCreator.deployed();

    deployedCentralizedOracle.addSupportedIdentifier(identifierBytes);
    deployedManualPriceFeed.setCurrentTime(100);
    // deployedManualPriceFeed.pushLatestPrice(identifierBytes, 100, web3.utils.toWei("0", "ether"));

    // Set two unverified prices to get the unverified feed slightly ahead of the verified feed.
    await pushPrice(web3.utils.toWei("0", "ether"));
  });

  beforeEach(async () => {
    await pushPrice(web3.utils.toWei("0", "ether"));

    // Create a quick expiry for testing purposes. It is set to the current unverified feed time plus 2 oracle time
    // steps. Note: Make sure all tests end with same number of unverified/verified prices then this function will
    // add one additional unverified price
    const expiry = (await deployedManualPriceFeed.getCurrentTime()).addn(120);

    await deployedDerivativeCreator.createDerivative(
      makerAddress,
      web3.utils.toWei("0.05", "ether"),
      web3.utils.toWei("0.1", "ether"),
      expiry.toString(),
      identifierBytes,
      web3.utils.toWei("1", "ether"),
      { from: takerAddress, value: web3.utils.toWei("1", "ether") }
    );

    const derivativeArray = await deployedRegistry.getRegisteredDerivatives(takerAddress);
    const derivativeAddress = derivativeArray[derivativeArray.length - 1].derivativeAddress;
    derivativeContract = await Derivative.at(derivativeAddress);
  });

  it("Prefunded -> Live -> Expired -> Settled", async function() {
    let state = await derivativeContract.state();

    // TODO: add a javascript lib that will map from enum name to uint value.
    // '0' == State.Prefunded
    assert.equal(state.toString(), "0");

    // Note: the originator of the contract is, by definition, the taker.
    let takerStruct = await derivativeContract.taker();

    // Ensure the taker is the first account.
    assert.equal(takerStruct[0], takerAddress);

    // Ensure the balance of the taker is 1 ETH (as is deposited in beforeEach()).
    assert.equal(takerStruct[1].toString(), web3.utils.toWei("1", "ether"));

    // Check that the deposit function correctly credits the taker account.
    await derivativeContract.deposit({ from: takerAddress, value: web3.utils.toWei("1", "ether") });
    takerStruct = await derivativeContract.taker();
    assert.equal(takerStruct[1].toString(), web3.utils.toWei("2", "ether"));

    // Check that the withdraw function correctly withdraws from the taker account.
    await derivativeContract.withdraw(web3.utils.toWei("1", "ether"), { from: takerAddress });
    takerStruct = await derivativeContract.taker();
    assert.equal(takerStruct[1].toString(), web3.utils.toWei("1", "ether"));

    // Check that the withdraw function fails to withdraw from the maker account (no balance).
    assert(await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("1", "ether"), { from: makerAddress })));

    // Maker deposit below the margin requirement should not change the contract state.
    await derivativeContract.deposit({ from: makerAddress, value: web3.utils.toWei("0.07", "ether") });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "0");
    let makerStruct = await derivativeContract.maker();
    assert.equal(makerStruct[1], web3.utils.toWei("0.07", "ether"));

    // Maker deposit above the margin requirement should send the contract into the Live state.
    await derivativeContract.deposit({ from: makerAddress, value: web3.utils.toWei("0.03", "ether") });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "1");

    // Attempt to withdraw past the min margin once live. Should throw.
    assert(
      await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.05", "ether"), { from: makerAddress }))
    );

    // Change the price to -0.5 ETH.
    await pushPrice(web3.utils.toWei("-0.5", "ether"));

    // Right now, oracle price decreases hurt the taker and help the maker, which means the amount the taker needs in
    // their account to survive the a -0.5 remargin is 0.6 (0.1 normal requirement + 0.5 price change).
    let takerRequiredBalance = await derivativeContract.requiredAccountBalanceOnRemargin({ from: takerAddress });
    assert.equal(takerRequiredBalance.toString(), web3.utils.toWei("0.6", "ether"));

    // Since the price is moving toward the maker, the required balance to survive the remargin is 0.
    let makerRequiredBalance = await derivativeContract.requiredAccountBalanceOnRemargin({ from: makerAddress });
    assert.equal(makerRequiredBalance.toString(), web3.utils.toWei("0", "ether"));

    let expectedNpv = await derivativeContract.npvIfRemarginedImmediately();
    await derivativeContract.remargin({ from: takerAddress });

    // Ensure that the npvIfRemarginedImmediately() matches the actual result of the remargin.
    let newNpv = await derivativeContract.npv();
    assert.equal(newNpv.toString(), web3.utils.toWei("-0.5", "ether"));
    assert.equal(expectedNpv.toString(), newNpv.toString());

    // Ensure that the balances were reassessed properly by the remargin.
    let makerBalance = (await derivativeContract.maker())[1];
    assert.equal(makerBalance.toString(), web3.utils.toWei("0.6", "ether"));

    let takerBalance = (await derivativeContract.taker())[1];
    assert.equal(takerBalance.toString(), web3.utils.toWei("0.5", "ether"));

    // Push the contract to expiry. We can't compute NPV anymore.
    await pushPrice(web3.utils.toWei("-0.5", "ether"));
    const expirationTime = await deployedManualPriceFeed.getCurrentTime();
    await derivativeContract.remargin({ from: takerAddress });

    // Check that the state is expiry.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "3");

    // Attempt to withdraw past the min margin. Should throw.
    assert(
      await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.6", "ether"), { from: makerAddress }))
    );

    // Confirming is not allowed on an expired contract.
    assert(await didContractThrow(derivativeContract.confirmPrice({ from: takerAddress })));

    // Make sure that prices pushed past expiry won't affect the contract.
    await pushPrice(web3.utils.toWei("-0.6", "ether"));

    // Provide an Oracle price for the expiry time.
    await deployedCentralizedOracle.pushPrice(identifierBytes, expirationTime, web3.utils.toWei("-0.5", "ether"));

    // Settle the contract.
    await derivativeContract.settle();
    state = await derivativeContract.state();
    assert.equal(state.toString(), "5");

    // Attempt to withdraw more than the maker has in the contract.
    assert(
      await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.7", "ether"), { from: makerAddress }))
    );

    await derivativeContract.withdraw(web3.utils.toWei("0.6", "ether"), { from: makerAddress });
    makerBalance = (await derivativeContract.maker())[1];
    assert.equal(makerBalance.toString(), web3.utils.toWei("0", "ether"));

    await derivativeContract.withdraw(web3.utils.toWei("0.5", "ether"), { from: takerAddress });
    takerBalance = (await derivativeContract.taker())[1];
    assert.equal(takerBalance.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Prefunded -> Live -> Defaulted (maker) -> Confirmed", async function() {
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Maker deposit below the margin requirement should not change the contract state.
    await derivativeContract.deposit({ from: makerAddress, value: web3.utils.toWei("0.1", "ether") });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "1");

    // Change the price to -0.01 ETH to send the maker into default.
    await pushPrice(web3.utils.toWei("0.01", "ether"));

    // Since the price is moving toward the maker, the required balance to survive the remargin is 0.
    let makerRequiredBalance = await derivativeContract.requiredAccountBalanceOnRemargin({ from: makerAddress });
    assert.equal(makerRequiredBalance.toString(), web3.utils.toWei("0.11", "ether"));

    await derivativeContract.remargin({ from: takerAddress });

    // Check that the state is default.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Attempt to withdraw while in default (even if the withdrawal amount is below the amount that will be left after
    // settlement). Should throw.
    assert(
      await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.03", "ether"), { from: makerAddress }))
    );
    assert(
      await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.5", "ether"), { from: takerAddress }))
    );

    // One party confirms the unverified price.
    await derivativeContract.confirmPrice({ from: makerAddress });

    // Check that the state is still expiry since both have not confirmed.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Settle the contract now that both parties have confirmed.
    await derivativeContract.confirmPrice({ from: takerAddress });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "5");

    await derivativeContract.withdraw(web3.utils.toWei("0.04", "ether"), { from: makerAddress });
    makerBalance = (await derivativeContract.maker())[1];
    assert.equal(makerBalance.toString(), web3.utils.toWei("0", "ether"));

    await derivativeContract.withdraw(web3.utils.toWei("1.06", "ether"), { from: takerAddress });
    takerBalance = (await derivativeContract.taker())[1];
    assert.equal(takerBalance.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Prefunded -> Live -> Defaulted (taker) -> No Confirm -> Settled", async function() {
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Maker deposit to start contract
    await derivativeContract.deposit({ from: makerAddress, value: web3.utils.toWei("1.00", "ether") });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "1");

    // Change the price to 0.16 ETH to send the taker into default.
    await pushPrice(web3.utils.toWei("-0.91", "ether"));
    const defaultTime = await deployedManualPriceFeed.getCurrentTime();
    await derivativeContract.remargin({ from: makerAddress });

    // Check that the state is default.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Attempt to withdraw while in default (even if the withdrawal amount is below the amount that will be left after
    // settlement). Should throw.
    assert(
      await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.03", "ether"), { from: makerAddress }))
    );
    assert(
      await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.5", "ether"), { from: takerAddress }))
    );

    // One party confirms the unverified price.
    await derivativeContract.confirmPrice({ from: makerAddress });

    // Check that the state is still in default since both have not confirmed.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Verify the price that caused default and have taker call settle
    await deployedCentralizedOracle.pushPrice(identifierBytes, defaultTime, web3.utils.toWei("-0.91", "ether"));
    await derivativeContract.settle({ from: takerAddress });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "5");

    await derivativeContract.withdraw(web3.utils.toWei("1.96", "ether"), { from: makerAddress });
    makerBalance = (await derivativeContract.maker())[1];
    assert.equal(makerBalance.toString(), web3.utils.toWei("0", "ether"));

    await derivativeContract.withdraw(web3.utils.toWei("0.04", "ether"), { from: takerAddress });
    takerBalance = (await derivativeContract.taker())[1];
    assert.equal(takerBalance.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Pre -> Live -> Default (m) ->  No Confirm -> Settled", async function() {
    let state = await derivativeContract.state();
    assert.equal(state.toString(), "0");

    // Maker deposit to start contract
    await derivativeContract.deposit({ from: makerAddress, value: web3.utils.toWei("1.00", "ether") });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "1");

    // Change the price to 0.91 ETH to send the maker into default.
    await pushPrice(web3.utils.toWei("0.91", "ether"));
    const defaultTime = await deployedManualPriceFeed.getCurrentTime();
    await derivativeContract.remargin({ from: makerAddress });

    // Check that the state is default.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Attempt to withdraw while in default (even if the withdrawal amount is below the amount that will be left after
    // settlement). Should throw.
    assert(
      await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.03", "ether"), { from: makerAddress }))
    );
    assert(
      await didContractThrow(derivativeContract.withdraw(web3.utils.toWei("0.5", "ether"), { from: takerAddress }))
    );

    // Can't settle because no Oracle price yet.
    assert(await didContractThrow(derivativeContract.settle({ from: takerAddress })));

    // Push Oracle price that is -1 * price feed price so that taker will now be in default
    await deployedCentralizedOracle.pushPrice(identifierBytes, defaultTime, web3.utils.toWei("-0.91", "ether"));

    // Check that the state is still in default since not confirmed or settled yet
    state = await derivativeContract.state();
    assert.equal(state.toString(), "4");

    // Call settle
    await derivativeContract.settle({ from: makerAddress });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "5");

    await derivativeContract.withdraw(web3.utils.toWei("1.96", "ether"), { from: makerAddress });
    makerBalance = (await derivativeContract.maker())[1];
    assert.equal(makerBalance.toString(), web3.utils.toWei("0", "ether"));

    await derivativeContract.withdraw(web3.utils.toWei("0.04", "ether"), { from: takerAddress });
    takerBalance = (await derivativeContract.taker())[1];
    assert.equal(takerBalance.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Unsupported product", async function() {
    let unsupportedProduct = web3.utils.hexToBytes(web3.utils.utf8ToHex("unsupported"));
    assert(
      didContractThrow(
        deployedDerivativeCreator.createDerivative(
          makerAddress,
          web3.utils.toWei("0.05", "ether"),
          web3.utils.toWei("0.1", "ether"),
          0,
          unsupportedProduct,
          web3.utils.toWei("1", "ether"),
          { from: takerAddress, value: web3.utils.toWei("1", "ether") }
        )
      )
    );
  });
});
