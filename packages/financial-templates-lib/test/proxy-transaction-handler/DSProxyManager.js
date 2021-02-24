const { toWei } = web3.utils;

const { GasEstimator, SpyTransport, spyLogIncludes } = require("../../index");

const { getTruffleContract } = require("@uma/core");

const winston = require("winston");
const sinon = require("sinon");

// Script to test
const { DSProxyManager } = require("../../src/proxy-transaction-handler/DSProxyManager.js");

const TokenSender = getTruffleContract("TokenSender", web3, "latest");
const DSProxyFactory = getTruffleContract("DSProxyFactory", web3, "latest");
const DSProxy = getTruffleContract("DSProxy", web3, "latest");
const Token = getTruffleContract("ExpandedERC20", web3, "latest");

contract("DSProxyManager", function(accounts) {
  let contractCreator = accounts[0];

  // Common contract objects.
  let tokenSender;
  let dsProxyFactory;
  let testToken;

  // Js Objects, clients and helpers
  let dsProxyManager;
  let spy;
  let spyLogger;
  let gasEstimator;

  beforeEach(async () => {
    dsProxyFactory = await DSProxyFactory.new();

    spy = sinon.spy();

    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
    });
    gasEstimator = new GasEstimator(spyLogger);

    // should not throw
    dsProxyManager = new DSProxyManager({
      logger: spyLogger,
      web3,
      gasEstimator,
      account: contractCreator,
      dsProxyFactoryAddress: dsProxyFactory.address,
      dsProxyFactoryAbi: DSProxyFactory.abi,
      dsProxyAbi: DSProxy.abi
    });

    testToken = await Token.new("Wrapped Ether", "WETH", 18);
    await testToken.addMember(1, contractCreator, { from: contractCreator });
  });
  it("Can reject invalid constructor params correctly construct DSProxyManager", async function() {
    // should throw with invalid addresses
    assert.throws(() => {
      new DSProxyManager({
        logger: spyLogger,
        web3,
        gasEstimator,
        account: "not an address",
        dsProxyFactoryAddress: dsProxyFactory.address,
        dsProxyFactoryAbi: DSProxyFactory.abi,
        dsProxyAbi: DSProxy.abi
      });
    });
  });

  it("Initialization correctly deploys a DSProxy if the user has not deployed one", async function() {
    await dsProxyManager.initializeDSProxy();

    dsProxyFactory = await DSProxyFactory.at(dsProxyManager.getDSProxyFactoryAddress());

    // Seeing the EOA had no DSProxy before, it should have deployed a new DSProxy with the contractCreator set as owner.
    const logs = await dsProxyFactory.getPastEvents("Created", { fromBlock: 0 });

    assert.equal(logs.length, 1);
    assert.equal(logs[0].returnValues.owner, contractCreator);
    assert.equal(await (await DSProxy.at(logs[0].returnValues.proxy)).owner(), contractCreator);

    assert.isTrue(spyLogIncludes(spy, -1, "DSProxy has been deployed for the EOA"));
    assert.isTrue(spyLogIncludes(spy, -1, contractCreator));
    assert.isTrue(spyLogIncludes(spy, -1, logs[0].returnValues.proxy));
  });

  it("Initialization correctly detects an existing DSProxy if the user has one already", async function() {
    const createDSProxyTx = await dsProxyFactory.build();
    await dsProxyManager.initializeDSProxy();
    assert.isTrue(spyLogIncludes(spy, -1, "DSProxy has been loaded in for the EOA"));
    assert.isTrue(spyLogIncludes(spy, -1, contractCreator)); // The EOA should be included.
    assert.isTrue(spyLogIncludes(spy, -1, createDSProxyTx.logs[0].args.proxy)); // The log should contain our previous DSProxy.
  });

  it("Can send functions to DSProxy using an existing deployed library", async function() {
    await dsProxyManager.initializeDSProxy();
    const dsProxyAddress = dsProxyManager.getDSProxyAddress();

    await testToken.mint(dsProxyAddress, toWei("1000"), { from: contractCreator });

    // Deploy a tokenSender contract containing library code for the tx. the TokenSender contract enables a DSProxy to send
    // any tokens that it might have within it's wallet. It is used to showcase how a more complex transaction would occur
    // with the DSProxy acting in place of an EOA.
    tokenSender = await TokenSender.new();

    // Encode the send transaction. This is what will be executed within the DSProxy.
    const sendTokenTx = tokenSender.contract.methods
      .transferERC20(testToken.address, contractCreator, toWei("10"))
      .encodeABI();

    // Call the method on the tokenSender(library) with the sendTokenTxData. Note this is called from the perspective
    // of the DSProxy and should send some of the DSProxy tokens.
    const dsProxyCallReturn = await dsProxyManager.callFunctionOnExistingLibrary(tokenSender.address, sendTokenTx);

    // We can get the events to double check token transferers were correct.
    let tokenEvents = await testToken.getPastEvents("Transfer");

    // The transaction hash should equal that in the transaction from the dsProxyManager.
    assert.equal(tokenEvents[0].transactionHash, dsProxyCallReturn.transactionHash);

    // The tokens should have been transferred out of the DSProxy wallet ant to the contractCreator.
    assert.equal((await testToken.balanceOf(contractCreator)).toString(), toWei("10"));
    assert.equal((await testToken.balanceOf(dsProxyAddress)).toString(), toWei("990"));
    assert.isTrue(spyLogIncludes(spy, -1, "Executed function on deployed library"));
    assert.isTrue(spyLogIncludes(spy, -1, tokenEvents[0].transactionHash)); // The transaction hash should be included.
  });
  it("Can send functions to DSProxy using an not deployed bytecode library", async function() {
    // In this test we do the same execution as before (send tokens from DSProxy) but this time we dont deploy the
    // contract library and rather do it in the same tx at the DSProxy call. This works by first deploying the library
    // then making the call on it. Note this is still from the context of the DSProxy so msg.sender is the DSProxy address.
    await dsProxyManager.initializeDSProxy();
    const dsProxyAddress = dsProxyManager.getDSProxyAddress();

    await testToken.mint(dsProxyAddress, toWei("1000"), { from: contractCreator });

    // As before we encode the tx to send to the library.
    const contract = new web3.eth.Contract(TokenSender.abi);
    const callData = contract.methods.transferERC20(testToken.address, contractCreator, toWei("10")).encodeABI();

    // The library also needs to code of the contract to deploy.
    const callCode = TokenSender.bytecode;

    const dsProxyCallReturn = await dsProxyManager.callFunctionOnNewlyDeployedLibrary(callCode, callData);

    // We can get the events to double check token transferers were correct.
    let tokenEvents = await testToken.getPastEvents("Transfer");

    // The transaction hash should equal that in the transaction from the dsProxyManager.
    assert.equal(tokenEvents[0].transactionHash, dsProxyCallReturn.transactionHash);

    // The tokens should have been transferred out of the DSProxy wallet ant to the contractCreator.
    assert.equal((await testToken.balanceOf(contractCreator)).toString(), toWei("10"));
    assert.equal((await testToken.balanceOf(dsProxyAddress)).toString(), toWei("990"));
    assert.isTrue(spyLogIncludes(spy, -1, "Executed function on a freshly minted library"));
    assert.isTrue(spyLogIncludes(spy, -1, tokenEvents[0].transactionHash)); // The transaction hash should be included.
  });
});
