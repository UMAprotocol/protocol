const { didContractThrow } = require("./utils/DidContractThrow.js");

var Derivative = artifacts.require("Derivative");
var Registry = artifacts.require("Registry");
var Oracle = artifacts.require("VoteTokenMock");

contract("Derivative", function(accounts) {
  var derivativeContract;
  var deployedRegistry;
  var deployedOracle;

  var ownerAddress = accounts[0];
  var takerAddress = accounts[1];
  var makerAddress = accounts[2];

  before(async function() {
    // Set the deployed registry and oracle.
    deployedRegistry = await Registry.deployed();
    deployedOracle = await Oracle.deployed();

    // Set two unverified prices to get the unverified feed slightly ahead of the verified feed.
    await deployedOracle.addUnverifiedPrice(web3.toWei("0", "ether"), { from: ownerAddress });
    await deployedOracle.addUnverifiedPrice(web3.toWei("0", "ether"), { from: ownerAddress });
    await deployedOracle.addVerifiedPrice(web3.toWei("0", "ether"), { from: ownerAddress });
  });

  beforeEach(async () => {
    // Create an quick expiry for testing purposes. It is set to the current unverified feed time plus 2 oracle time steps.
    expiry = (await deployedOracle.latestUnverifiedPrice())[0].add(120);

    await deployedRegistry.createDerivative(
      makerAddress,
      deployedOracle.address,
      web3.toWei("0.05", "ether"),
      web3.toWei("0.1", "ether"),
      expiry.toString(),
      "ETH/USD",
      web3.toWei("1", "ether"),
      { from: takerAddress, value: web3.toWei("1", "ether") }
    );

    var numRegisteredContracts = await deployedRegistry.getNumRegisteredContractsBySender({ from: takerAddress });
    var derivativeAddress = await deployedRegistry.getRegisteredContractBySender(
      numRegisteredContracts.sub(1).toString(),
      { from: takerAddress }
    );
    derivativeContract = Derivative.at(derivativeAddress);
  });

  it("Prefunded -> Live -> Expired -> Settled", async function() {
    var state = await derivativeContract.state();

    // TODO: add a javascript lib that will map from enum name to uint value.
    // '0' == State.Prefunded
    assert.equal(state.toString(), "0");

    // Note: the originator of the contract is, by definition, the taker.
    var takerStruct = await derivativeContract.taker();

    // Ensure the taker is the first account.
    assert.equal(takerStruct[0], takerAddress);

    // Ensure the balance of the taker is 1 ETH (as is deposited in beforeEach()).
    assert.equal(takerStruct[1].toString(), web3.toWei("1", "ether"));

    // Check that the deposit function correctly credits the taker account.
    await derivativeContract.deposit({ from: takerAddress, value: web3.toWei("1", "ether") });
    takerStruct = await derivativeContract.taker();
    assert.equal(takerStruct[1].toString(), web3.toWei("2", "ether"));

    // Check that the withdraw function correctly withdraws from the taker account.
    await derivativeContract.withdraw(web3.toWei("1", "ether"), { from: takerAddress });
    takerStruct = await derivativeContract.taker();
    assert.equal(takerStruct[1].toString(), web3.toWei("1", "ether"));

    // Check that the withdraw function fails to withdraw from the maker account (no balance).
    assert(await didContractThrow(derivativeContract.withdraw(web3.toWei("1", "ether"), { from: makerAddress })));

    // Maker deposit below the margin requirement should not change the contract state.
    await derivativeContract.deposit({ from: makerAddress, value: web3.toWei("0.07", "ether") });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "0");
    var makerStruct = await derivativeContract.maker();
    assert.equal(makerStruct[1], web3.toWei("0.07", "ether"));

    // Maker deposit above the margin requirement should send the contract into the Live state.
    await derivativeContract.deposit({ from: makerAddress, value: web3.toWei("0.03", "ether") });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "1");

    // Attempt to withdraw past the min margin once live. Should throw.
    assert(await didContractThrow(derivativeContract.withdraw(web3.toWei("0.05", "ether"), { from: makerAddress })));

    // Change the price to -0.5 ETH.
    await deployedOracle.addUnverifiedPrice(web3.toWei("-0.5", "ether"), { from: ownerAddress });

    // Right now, oracle price decreases hurt the taker and help the maker, which means the amount the taker needs in their account to survive the a -0.5 remargin is 0.6 (0.1 normal requirement + 0.5 price change).
    var takerRequiredBalance = await derivativeContract.requiredAccountBalanceOnRemargin({ from: takerAddress });
    assert.equal(takerRequiredBalance.toString(), web3.toWei("0.6", "ether"));

    // Since the price is moving toward the maker, the required balance to survive the remargin is 0.
    var makerRequiredBalance = await derivativeContract.requiredAccountBalanceOnRemargin({ from: makerAddress });
    assert.equal(makerRequiredBalance.toString(), web3.toWei("0", "ether"));

    var expectedNpv = await derivativeContract.npvIfRemarginedImmediately();
    await derivativeContract.remargin({ from: takerAddress });

    // Ensure that the npvIfRemarginedImmediately() matches the actual result of the remargin.
    var newNpv = await derivativeContract.npv();
    assert.equal(newNpv.toString(), web3.toWei("-0.5", "ether"));
    assert.equal(expectedNpv.toString(), newNpv.toString());

    // Ensure that the balances were reassessed properly by the remargin.
    var makerBalance = (await derivativeContract.maker())[1];
    assert.equal(makerBalance.toString(), web3.toWei("0.6", "ether"));

    var takerBalance = (await derivativeContract.taker())[1];
    assert.equal(takerBalance.toString(), web3.toWei("0.5", "ether"));

    // Move the verified feed past expiration, but ensure the price stays at the expiry rather than moving to the current.
    await deployedOracle.addUnverifiedPrice(web3.toWei("-0.5", "ether"), { from: ownerAddress });
    await deployedOracle.addUnverifiedPrice(web3.toWei("-0.6", "ether"), { from: ownerAddress });
    await derivativeContract.remargin({ from: takerAddress });
    newNpv = await derivativeContract.npv();
    assert.equal(newNpv.toString(), web3.toWei("-0.5", "ether"));

    // Check that the state is expiry.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "3");

    // One party confirms the unverified price.
    await derivativeContract.confirmPrice({ from: makerAddress });

    // Check that the state is still expiry since both have not confirmed.
    state = await derivativeContract.state();
    assert.equal(state.toString(), "3");

    // Attempt to withdraw past the min margin. Should throw.
    assert(await didContractThrow(derivativeContract.withdraw(web3.toWei("0.6", "ether"), { from: makerAddress })));

    // Settle the contract now that both parties have confirmed.
    await derivativeContract.confirmPrice({ from: takerAddress });
    state = await derivativeContract.state();
    assert.equal(state.toString(), "5");

    // Attempt to withdraw more than the maker has in the contract.
    assert(await didContractThrow(derivativeContract.withdraw(web3.toWei("0.7", "ether"), { from: makerAddress })));

    await derivativeContract.withdraw(web3.toWei("0.6", "ether"), { from: makerAddress });
    makerBalance = (await derivativeContract.maker())[1];
    assert.equal(makerBalance.toString(), web3.toWei("0", "ether"));

    await derivativeContract.withdraw(web3.toWei("0.5", "ether"), { from: takerAddress });
    takerBalance = (await derivativeContract.taker())[1];
    assert.equal(takerBalance.toString(), web3.toWei("0", "ether"));
  });
});
