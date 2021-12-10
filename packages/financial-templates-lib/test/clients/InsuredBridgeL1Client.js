const hre = require("hardhat");
const { web3 } = hre;
const { interfaceName, TokenRolesEnum, InsuredBridgeRelayStateEnum } = require("@uma/common");
const { getContract } = hre;
const { utf8ToHex, toWei, toBN, soliditySha3, toChecksumAddress, randomHex } = web3.utils;

const winston = require("winston");
const { assert } = require("chai");
const chainId = 10;
const Messenger = getContract("MessengerMock");
const BridgeAdmin = getContract("BridgeAdmin");
const BridgePool = getContract("BridgePool");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("SkinnyOptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");
const MockOracle = getContract("MockOracleAncillary");
const RateModelStore = getContract("RateModelStore");

// Client to test
const {
  InsuredBridgeL1Client,
  ClientRelayState,
  SettleableRelay,
} = require("../../dist/clients/InsuredBridgeL1Client");

// tested client
let client;

// Contract objects
let messenger, bridgeAdmin, bridgePool;

let finder,
  store,
  identifierWhitelist,
  collateralWhitelist,
  timer,
  optimisticOracle,
  l1Token,
  mockOracle,
  rateModelStore,
  depositData,
  relayData,
  depositDataAbiEncoded,
  depositHash,
  relayAncillaryData,
  relayAncillaryDataHash,
  expectedRelayedDepositInformation;

// Hard-coded test params:
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const initialPoolLiquidity = toWei("100");
const relayAmount = toWei("10");
const defaultProposerBondPct = toWei("0.05");
const defaultSlowRelayFeePct = toWei("0.01");
const defaultRealizedLpFee = toWei("0.1");
const defaultInstantRelayFeePct = toWei("0.01");
const lpFeeRatePerSecond = toWei("0.0000015");
const finalFee = toWei("1");
const proposerBond = toBN(defaultProposerBondPct)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")))
  .toString();
const defaultGasLimit = 1_000_000;
const defaultGasPrice = toWei("1", "gwei");
const rateModel = { UBar: toWei("0.65"), R0: toWei("0.00"), R1: toWei("0.08"), R2: toWei("1.00") };

describe("InsuredBridgeL1Client", function () {
  let accounts,
    owner,
    depositContractImpersonator,
    depositor,
    relayer,
    instantRelayer,
    liquidityProvider,
    l1Recipient,
    l2Token,
    disputer,
    rando;

  const generateRelayParams = (depositDataOverride = {}, relayDataOverride = {}) => {
    const _depositData = { ...depositData, ...depositDataOverride };
    const _relayData = { ...relayData, ...relayDataOverride };
    return [_depositData, _relayData.realizedLpFeePct];
  };

  const generateRelayData = async (depositData, relayData, bridgePool, l1TokenAddress = l1Token.options.address) => {
    // Save other reused values.
    depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint256", "uint64", "address", "address", "uint256", "uint64", "uint64", "uint32", "address"],
      [
        depositData.chainId,
        depositData.depositId,
        depositData.l1Recipient,
        depositData.l2Sender,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
        l1TokenAddress,
      ]
    );
    depositHash = soliditySha3(depositDataAbiEncoded);
    relayAncillaryData = await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call();
    relayAncillaryDataHash = soliditySha3(relayAncillaryData);
    return { depositHash, relayAncillaryData, relayAncillaryDataHash };
  };

  const syncExpectedRelayedDepositInformation = (_l1TokenAddress = l1Token.options.address) => {
    const parameters = [
      { t: "uint256", v: depositData.chainId },
      { t: "uint64", v: depositData.depositId },
      { t: "address", v: depositData.l1Recipient },
      { t: "address", v: depositData.l2Sender },
      { t: "uint256", v: depositData.amount },
      { t: "uint64", v: depositData.slowRelayFeePct },
      { t: "uint64", v: depositData.instantRelayFeePct },
      { t: "uint32", v: depositData.quoteTimestamp },
      { t: "uint32", v: relayData.relayId },
      { t: "uint64", v: relayData.realizedLpFeePct },
      { t: "address", v: _l1TokenAddress },
    ];
    const relayHash = web3.utils.soliditySha3(
      web3.eth.abi.encodeParameters(
        parameters.map((elt) => elt.t),
        parameters.map((elt) => elt.v)
      )
    );
    expectedRelayedDepositInformation = {
      relayId: relayData.relayId,
      chainId: depositData.chainId,
      depositId: depositData.depositId,
      l2Sender: depositData.l2Sender,
      slowRelayer: relayData.slowRelayer,
      l1Recipient: depositData.l1Recipient,
      l1Token: _l1TokenAddress,
      amount: depositData.amount,
      slowRelayFeePct: depositData.slowRelayFeePct,
      instantRelayFeePct: depositData.instantRelayFeePct,
      quoteTimestamp: Number(depositData.quoteTimestamp),
      realizedLpFeePct: relayData.realizedLpFeePct,
      priceRequestTime: relayData.priceRequestTime,
      depositHash: depositHash,
      relayState: ClientRelayState.Pending,
      relayAncillaryDataHash: relayHash,
      proposerBond,
      finalFee,
      settleable: SettleableRelay.CannotSettle,
      blockNumber: undefined, // We won't know this until the relay is mined
    };
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [
      owner,
      depositContractImpersonator,
      depositor,
      relayer,
      instantRelayer,
      liquidityProvider,
      l1Recipient,
      l2Token,
      disputer,
      rando,
    ] = accounts;

    finder = await Finder.new().send({ from: owner });
    collateralWhitelist = await AddressWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: owner });

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: owner });
    timer = await Timer.new().send({ from: owner });
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: owner });

    // Other contract setup needed to relay deposit:
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: owner });
  });

  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    l1Token = await ERC20.new("TESTERC20", "TESTERC20", 18).send({ from: owner });
    await l1Token.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: owner });
    await store.methods.setFinalFee(l1Token.options.address, { rawValue: finalFee }).send({ from: owner });

    // Deploy new OptimisticOracle so that we can control its timing:
    // - Set initial liveness to something != `defaultLiveness` so we can test that the custom liveness is set
    //   correctly by the BridgePool.
    optimisticOracle = await OptimisticOracle.new(defaultLiveness, finder.options.address, timer.options.address).send({
      from: owner,
    });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.SkinnyOptimisticOracle), optimisticOracle.options.address)
      .send({ from: owner });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });

    // Add rate model for L1 token.
    rateModelStore = await RateModelStore.new().send({ from: owner });
    await rateModelStore.methods
      .updateRateModel(l1Token.options.address, JSON.stringify(rateModel))
      .send({ from: owner });

    // Set up the Insured bridge contracts.

    // Deploy and setup BridgeAdmin
    messenger = await Messenger.new().send({ from: owner });
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: owner });

    await bridgeAdmin.methods
      .setDepositContract(chainId, depositContractImpersonator, messenger.options.address)
      .send({ from: owner });

    // Deploy a bridgePool and whitelist it.
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      false,
      timer.options.address
    ).send({ from: owner });

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(
        chainId,
        l1Token.options.address,
        l2Token,
        bridgePool.options.address,
        0,
        defaultGasLimit,
        defaultGasPrice,
        0
      )
      .send({ from: owner });

    // Add some liquidity to the pool to facilitate bridging actions.
    await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
    await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });

    // Create the InsuredBridgeL1Client to be tested.

    // The InsuredBridgeL1Client does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    client = new InsuredBridgeL1Client(dummyLogger, web3, bridgeAdmin.options.address, rateModelStore.options.address);

    // Create some data for relay the initial relay action.

    // Store expected relay data that we'll use to verify contract state:

    depositData = {
      chainId: chainId,
      depositId: 1,
      l1Recipient: l1Recipient,
      l2Sender: depositor,
      l1Token: l1Token.options.address,
      amount: relayAmount,
      slowRelayFeePct: defaultSlowRelayFeePct,
      instantRelayFeePct: defaultInstantRelayFeePct,
      quoteTimestamp: (await web3.eth.getBlock("latest")).timestamp, // set this to the current block timestamp.
    };
    relayData = {
      relayId: 0,
      relayState: InsuredBridgeRelayStateEnum.UNINITIALIZED,
      priceRequestTime: 0,
      realizedLpFeePct: defaultRealizedLpFee,
      slowRelayer: relayer,
      proposerBond: proposerBond,
      finalFee: finalFee,
    };

    ({ depositHash, relayAncillaryData, relayAncillaryDataHash } = await generateRelayData(
      depositData,
      relayData,
      bridgePool
    ));
    depositData.depositHash = depositHash;

    syncExpectedRelayedDepositInformation();
  });
  it("Client initial setup", async function () {
    // Before the client is updated, client should error out.
    assert.throws(client.getBridgePoolsAddresses, Error);

    // Before updating, optimistic oracle liveness defaults to 0.
    assert.equal(client.optimisticOracleLiveness, 0);

    // After updating the client it should contain the appropriate addresses.
    await client.update();
    assert.equal(JSON.stringify(client.getBridgePoolsAddresses()), JSON.stringify([bridgePool.options.address]));

    // BridgePool client data should update:
    assert.equal(client.getBridgePoolForDeposit(depositData).contract.options.address, bridgePool.options.address);
    assert.equal(
      client.getBridgePoolForDeposit(depositData).currentTime,
      (await bridgePool.methods.getCurrentTime().call()).toString()
    );
    assert.equal(
      client.getBridgePoolForDeposit(depositData).relayNonce,
      (await bridgePool.methods.numberOfRelays().call()).toString()
    );
    assert.equal(Object.keys(client.getBridgePoolForDeposit(depositData).l2Token).length, 1);
    assert.equal(client.getBridgePoolForDeposit(depositData).l2Token[chainId], l2Token);
    // OptimisticOracle liveness should be reset.
    assert.equal(client.optimisticOracleLiveness, defaultLiveness);

    // Whitelisting a new L2 token for this bridge pool adds to L2 token array, but resets the BridgePool address.
    const bridgePool2 = await BridgePool.new(
      "LP Token 2",
      "LPT2",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      false,
      timer.options.address
    ).send({ from: owner });
    const chainId2 = chainId + 1;
    const l2Token2 = toChecksumAddress(randomHex(20));
    await bridgeAdmin.methods
      .setDepositContract(chainId2, depositContractImpersonator, messenger.options.address)
      .send({ from: owner });

    await bridgeAdmin.methods
      .whitelistToken(
        chainId2,
        l1Token.options.address,
        l2Token2,
        bridgePool2.options.address,
        0,
        defaultGasLimit,
        defaultGasPrice,
        0
      )
      .send({ from: owner });
    await client.update();
    assert.equal(JSON.stringify(client.getBridgePoolsAddresses()), JSON.stringify([bridgePool2.options.address]));
    assert.equal(client.getBridgePoolForDeposit(depositData).contract.options.address, bridgePool2.options.address);
    assert.equal(
      client.getBridgePoolForDeposit(depositData).currentTime,
      (await bridgePool2.methods.getCurrentTime().call()).toString()
    );
    assert.equal(
      client.getBridgePoolForDeposit(depositData).relayNonce,
      (await bridgePool2.methods.numberOfRelays().call()).toString()
    );
    assert.equal(client.optimisticOracleLiveness, defaultLiveness);
    assert.equal(Object.keys(client.getBridgePoolForDeposit(depositData).l2Token).length, 2);
    assert.equal(client.getBridgePoolForDeposit(depositData).l2Token[chainId], l2Token);
    assert.equal(client.getBridgePoolForDeposit(depositData).l2Token[chainId2], l2Token2);

    // Rate model for block number after initial rate model update should return that rate model.
    const initialUpdatedRateModelEvent = (await rateModelStore.getPastEvents("UpdatedRateModel", { fromBlock: 0 }))[0];
    let rateModel = client.getRateModelForBlockNumber(
      l1Token.options.address,
      initialUpdatedRateModelEvent.blockNumber
    );
    assert.equal(rateModel.UBar.toString(), rateModel.UBar);
    assert.equal(rateModel.R0.toString(), rateModel.R0);
    assert.equal(rateModel.R1.toString(), rateModel.R1);
    assert.equal(rateModel.R2.toString(), rateModel.R2);
  });
  it("Fetch rate model for block number", async function () {
    // Update once to demonstrate that the rate model state is not deleted between iterations.
    await client.update();

    // Add a new rate model and check that we can fetch rate model for this new block number.
    const newRateModel = { UBar: toWei("0.1"), R0: toWei("0.1"), R1: toWei("0.1"), R2: toWei("10.00") };
    const updatedRateModelTxn = await rateModelStore.methods
      .updateRateModel(l1Token.options.address, JSON.stringify(newRateModel))
      .send({ from: owner });
    await client.update();

    let rateModel = client.getRateModelForBlockNumber(l1Token.options.address, updatedRateModelTxn.blockNumber);
    assert.equal(rateModel.UBar.toString(), newRateModel.UBar);
    assert.equal(rateModel.R0.toString(), newRateModel.R0);
    assert.equal(rateModel.R1.toString(), newRateModel.R1);
    assert.equal(rateModel.R2.toString(), newRateModel.R2);

    // Returns latest rate model when searching for block number far into future
    rateModel = client.getRateModelForBlockNumber(l1Token.options.address, updatedRateModelTxn.blockNumber + 100);
    assert.equal(rateModel.UBar.toString(), newRateModel.UBar);
    assert.equal(rateModel.R0.toString(), newRateModel.R0);
    assert.equal(rateModel.R1.toString(), newRateModel.R1);
    assert.equal(rateModel.R2.toString(), newRateModel.R2);

    // Returns latest rate model when block number is undefined
    rateModel = client.getRateModelForBlockNumber(l1Token.options.address);
    assert.equal(rateModel.UBar.toString(), newRateModel.UBar);
    assert.equal(rateModel.R0.toString(), newRateModel.R0);
    assert.equal(rateModel.R1.toString(), newRateModel.R1);
    assert.equal(rateModel.R2.toString(), newRateModel.R2);

    // Rate model returned for initial update block number should be initial rate model.
    const initialUpdatedRateModelEvent = (await rateModelStore.getPastEvents("UpdatedRateModel", { fromBlock: 0 }))[0];
    rateModel = client.getRateModelForBlockNumber(l1Token.options.address, initialUpdatedRateModelEvent.blockNumber);
    assert.equal(rateModel.UBar.toString(), rateModel.UBar);
    assert.equal(rateModel.R0.toString(), rateModel.R0);
    assert.equal(rateModel.R1.toString(), rateModel.R1);
    assert.equal(rateModel.R2.toString(), rateModel.R2);

    // Fetching rate model for unknown L1 token throws error
    try {
      client.getRateModelForBlockNumber(l2Token, initialUpdatedRateModelEvent.blockNumber);
      assert(false);
    } catch (err) {
      assert.isTrue(err.message.includes("No updated rate model"));
    }

    // Fetching rate model for block number before first event throws error
    try {
      client.getRateModelForBlockNumber(l1Token.options.address, initialUpdatedRateModelEvent.blockNumber - 1);
      assert(false);
    } catch (err) {
      assert.isTrue(err.message.includes("before first UpdatedRateModel event"));
    }

    // If rate model string is not parseable into expected keys, then update skips the event and the rate model is
    // unchanged for the L1 token.
    await rateModelStore.methods
      .updateRateModel(l1Token.options.address, JSON.stringify({ key: "value" }))
      .send({ from: owner });
    await client.update();
    rateModel = client.getRateModelForBlockNumber(l1Token.options.address);
    assert.equal(rateModel.UBar.toString(), newRateModel.UBar);
    assert.equal(rateModel.R0.toString(), newRateModel.R0);
    assert.equal(rateModel.R1.toString(), newRateModel.R1);
    assert.equal(rateModel.R2.toString(), newRateModel.R2);
  });
  it("Fetch l1 tokens from rate model", async function () {
    // Add a new rate model at a different block height from original rate model update.
    const newRateModel = { UBar: toWei("0.1"), R0: toWei("0.1"), R1: toWei("0.1"), R2: toWei("10.00") };
    const newTokenAddress = finder.options.address;
    const latestTxn = await rateModelStore.methods
      .updateRateModel(newTokenAddress, JSON.stringify(newRateModel))
      .send({ from: owner });
    await client.update();

    let l1Tokens = client.getL1TokensFromRateModel(latestTxn.blockNumber);
    assert.equal(l1Tokens.length, 2);
    assert.equal(l1Tokens[0], l1Token.options.address);
    assert.equal(l1Tokens[1], newTokenAddress);

    // When block number is before the second UpdatedRateModel event, should only return the earlier rate model key.
    const initialUpdatedRateModelEvent = (await rateModelStore.getPastEvents("UpdatedRateModel", { fromBlock: 0 }))[0];
    l1Tokens = client.getL1TokensFromRateModel(initialUpdatedRateModelEvent.blockNumber);
    assert.equal(l1Tokens.length, 1);
    assert.equal(l1Tokens[0], l1Token.options.address);

    // When block number is undefined, return all token addresses
    l1Tokens = client.getL1TokensFromRateModel();
    assert.equal(l1Tokens.length, 2);
    assert.equal(l1Tokens[0], l1Token.options.address);
    assert.equal(l1Tokens[1], newTokenAddress);
  });
  describe("Lifecycle tests", function () {
    it("Relayed deposits: deposit, speedup finalize lifecycle", async function () {
      // Before relay should contain no data.
      await client.update();

      // After relaying a deposit, should contain the exacted data.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));

      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });

      const txn = await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Before updating, save expected relayed information based on current contract state. We shouldn't have to make
      // a contract call to fetch this data as it should be stored in the client.
      const relayAttemptData = {
        relayState: ClientRelayState.Pending,
        slowRelayer: relayer,
        relayId: client.getBridgePoolForDeposit(depositData).relayNonce,
        realizedLpFeePct: defaultRealizedLpFee,
        priceRequestTime: client.getBridgePoolForDeposit(depositData).currentTime,
        proposerBond,
        finalFee,
      };
      expectedRelayedDepositInformation.priceRequestTime = relayAttemptData.priceRequestTime;
      expectedRelayedDepositInformation.relayId = relayAttemptData.relayId;
      expectedRelayedDepositInformation.blockNumber = txn.blockNumber;
      await client.update();

      // As there is only one L1Token that has been set up with the bridge, getAllRelayedDeposits and getRelayedDepositsForL1Token
      // should both return the same thing. This should correspond to the expected data.
      assert.equal(
        JSON.stringify(client.getAllRelayedDeposits()),
        JSON.stringify(client.getRelayedDepositsForL1Token(l1Token.options.address))
      );
      assert.equal(
        JSON.stringify(client.getPendingRelayedDepositsForL1Token(l1Token.options.address)),
        JSON.stringify(client.getAllRelayedDeposits())
      );
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));

      assert.equal(
        JSON.stringify(client.getPendingRelayedDeposits()),
        JSON.stringify([expectedRelayedDepositInformation])
      );

      // Next, speed up the relay and check the client updates accordingly.
      const instantRelayAmountSubFee = toBN(relayAmount)
        .sub(
          toBN(defaultRealizedLpFee)
            .mul(toBN(relayAmount))
            .div(toBN(toWei("1")))
        )
        .sub(
          toBN(defaultSlowRelayFeePct)
            .mul(toBN(relayAmount))
            .div(toBN(toWei("1")))
        )
        .sub(
          toBN(defaultInstantRelayFeePct)
            .mul(toBN(relayAmount))
            .div(toBN(toWei("1")))
        )
        .toString();

      // Speed up relay using just the information we have from this test and the client's stored data (i.e. without
      // fetching contract state.)
      await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData, relayAttemptData).send({ from: instantRelayer });

      await client.update();

      // After the fast relay, there should be an instant relayer set. Relay data should be the same.
      assert.isTrue(client.hasInstantRelayer(l1Token.options.address, depositHash, relayData.realizedLpFeePct));
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(
        JSON.stringify(client.getPendingRelayedDeposits()),
        JSON.stringify([expectedRelayedDepositInformation])
      ); // Not pending anymore

      // Next, advance time and settle the relay. State should update accordingly.
      await timer.methods
        .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + defaultLiveness)
        .send({ from: owner });

      // As time has been advanced but the relay has not yet been settled the settleable state should be "true".
      await client.update();
      expectedRelayedDepositInformation.settleable = SettleableRelay.SlowRelayerCanSettle;
      assert.equal(
        JSON.stringify(client.getSettleableRelayedDeposits()),
        JSON.stringify([expectedRelayedDepositInformation])
      );

      assert.equal(
        JSON.stringify(client.getSettleableRelayedDepositsForL1Token(l1Token.options.address)),
        JSON.stringify([expectedRelayedDepositInformation])
      );

      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));

      // Advance time a bit more to enable someone else to settle the relay.
      await timer.methods
        .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + 60 * 60 * 15)
        .send({ from: owner });

      await client.update();
      expectedRelayedDepositInformation.settleable = SettleableRelay.AnyoneCanSettle;
      assert.equal(
        JSON.stringify(client.getSettleableRelayedDeposits()),
        JSON.stringify([expectedRelayedDepositInformation])
      );

      assert.equal(
        JSON.stringify(client.getSettleableRelayedDepositsForL1Token(l1Token.options.address)),
        JSON.stringify([expectedRelayedDepositInformation])
      );

      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));

      // Finally, Settle the relay. Ensure the state is updated accordingly.
      await bridgePool.methods.settleRelay(depositData, relayAttemptData).send({ from: relayer });

      await client.update();
      expectedRelayedDepositInformation.relayState = ClientRelayState.Finalized;
      expectedRelayedDepositInformation.settleable = SettleableRelay.CannotSettle;
      assert.equal(JSON.stringify(client.getSettleableRelayedDeposits()), "[]");

      assert.equal(JSON.stringify(client.getSettleableRelayedDepositsForL1Token(l1Token.options.address)), "[]");
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(JSON.stringify(client.getPendingRelayedDeposits()), JSON.stringify([])); // Not pending anymore
    });
    it("Relayed deposits: deposit, speedup dispute lifecycle", async function () {
      // Before relay should contain no data.
      await client.update();

      // After relaying a deposit, should contain the exacted data.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));

      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      const txn = await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Before updating, save expected relayed information based on current contract state. We shouldn't have to make
      // a contract call to fetch this data as it should be stored in the client.
      const relayAttemptData = {
        relayState: ClientRelayState.Pending,
        slowRelayer: relayer,
        relayId: client.getBridgePoolForDeposit(depositData).relayNonce,
        realizedLpFeePct: defaultRealizedLpFee,
        priceRequestTime: client.getBridgePoolForDeposit(depositData).currentTime,
        proposerBond,
        finalFee,
      };
      expectedRelayedDepositInformation.priceRequestTime = relayAttemptData.priceRequestTime;
      expectedRelayedDepositInformation.relayId = relayAttemptData.relayId;
      expectedRelayedDepositInformation.blockNumber = txn.blockNumber;
      await client.update();

      // As there is only one L1Token that has been set up with the bridge, getAllRelayedDeposits and getRelayedDepositsForL1Token
      // should both return the same thing. This should correspond to the expected data.
      assert.notEqual(client.getRelayForDeposit(l1Token.options.address, depositData), undefined);
      assert.equal(
        JSON.stringify(client.getAllRelayedDeposits()),
        JSON.stringify(client.getRelayedDepositsForL1Token(l1Token.options.address))
      );
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(
        JSON.stringify(client.getPendingRelayedDeposits()),
        JSON.stringify([expectedRelayedDepositInformation])
      );
      // Next, speed up the relay and check the client updates accordingly.
      const instantRelayAmountSubFee = toBN(relayAmount)
        .sub(
          toBN(defaultRealizedLpFee)
            .mul(toBN(relayAmount))
            .div(toBN(toWei("1")))
        )
        .sub(
          toBN(defaultSlowRelayFeePct)
            .mul(toBN(relayAmount))
            .div(toBN(toWei("1")))
        )
        .sub(
          toBN(defaultInstantRelayFeePct)
            .mul(toBN(relayAmount))
            .div(toBN(toWei("1")))
        )
        .toString();

      await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData, relayAttemptData).send({ from: instantRelayer });

      await client.update();

      // After the fast relay, there should be an instant relayer set. Relay data should be the same.
      assert.isTrue(client.hasInstantRelayer(l1Token.options.address, depositHash, relayData.realizedLpFeePct));
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(
        JSON.stringify(client.getPendingRelayedDeposits()),
        JSON.stringify([expectedRelayedDepositInformation])
      ); // Not pending anymore

      // Next, dispute the relay.
      await timer.methods.setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + 1).send({ from: owner });
      await l1Token.methods.mint(disputer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: disputer });
      await bridgePool.methods.disputeRelay(depositData, relayAttemptData).send({ from: disputer });

      // After disputing, there should not be a pending relay. This is important because it means that the user (i.e.
      // the Relayer) can use this deleted relay information to submit another relay.
      await client.update();
      assert.equal(client.getRelayForDeposit(l1Token.options.address, depositData), undefined);
      assert.equal(JSON.stringify(client.getRelayedDepositsForL1Token(l1Token.options.address)), "[]");
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), "[]");
      assert.equal(JSON.stringify(client.getPendingRelayedDepositsForL1Token(l1Token.options.address)), "[]");

      // Before relaying, store expected relay information and regenerate expected relay information.
      const priceRequestTime = client.getBridgePoolForDeposit(depositData).currentTime;
      const relayId = client.getBridgePoolForDeposit(depositData).relayNonce;
      relayData = {
        ...relayData,
        priceRequestTime,
        relayId,
        slowRelayer: rando, // `rando` will be new relayer.
      };
      syncExpectedRelayedDepositInformation();

      // Can re-relay the deposit.
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      const txn2 = await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: rando });
      expectedRelayedDepositInformation.blockNumber = txn2.blockNumber;

      // Check the client updated accordingly. Importantly there should be new relay params that match with the newly
      // synced.
      await client.update();
      assert.notEqual(client.getRelayForDeposit(l1Token.options.address, depositData), undefined);
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(
        JSON.stringify(client.getPendingRelayedDeposits()),
        JSON.stringify([expectedRelayedDepositInformation])
      );
    });
    it("Disputed relays do not overwrite follow-up relays", async function () {
      // Before relay should contain no data.
      await client.update();

      // Initial Relay:
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Dispute the initial relay:
      await l1Token.methods.mint(disputer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: disputer });
      const relayAttemptData = {
        relayState: ClientRelayState.Pending,
        slowRelayer: relayer,
        relayId: 0,
        realizedLpFeePct: defaultRealizedLpFee,
        priceRequestTime: client.getBridgePoolForDeposit(depositData).currentTime,
        proposerBond,
        finalFee,
      };
      await bridgePool.methods.disputeRelay(depositData, relayAttemptData).send({ from: disputer });

      // Send another relay:
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      const txn = await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: rando });

      // Update the client. The relay should be set to the latest relay, and it should not have been deleted
      // by the dispute.
      relayData = { ...relayData, relayId: 1, slowRelayer: rando, priceRequestTime: relayAttemptData.priceRequestTime };
      syncExpectedRelayedDepositInformation();
      expectedRelayedDepositInformation.blockNumber = txn.blockNumber;

      // After disputing, there should be a pending relay that was not disputed.
      await client.update();
      assert.notEqual(client.getRelayForDeposit(l1Token.options.address, depositData), undefined);
      assert.equal(
        JSON.stringify(client.getRelayedDepositsForL1Token(l1Token.options.address)),
        JSON.stringify([expectedRelayedDepositInformation])
      );
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(
        JSON.stringify(client.getPendingRelayedDepositsForL1Token(l1Token.options.address)),
        JSON.stringify([expectedRelayedDepositInformation])
      );
    });
  });
  describe("Multi-relay, multi pool tests", function () {
    it("Client handles multiple pools with multiple deposits", async function () {
      // Deploy a new bridgePool and validate that the client correctly pulls in the information, updating its state.
      const l1Token2 = await ERC20.new("TESTERC202", "TESTERC202", 18).send({ from: owner });
      await l1Token2.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
      await collateralWhitelist.methods.addToWhitelist(l1Token2.options.address).send({ from: owner });
      await store.methods.setFinalFee(l1Token2.options.address, { rawValue: finalFee }).send({ from: owner });

      // Deploy a bridgePool and whitelist it.
      const bridgePool2 = await BridgePool.new(
        "LP Token2",
        "LPT2",
        bridgeAdmin.options.address,
        l1Token2.options.address,
        lpFeeRatePerSecond,
        false,
        timer.options.address
      ).send({ from: owner });

      // Add L1-L2 token mapping
      const l2Token2Address = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
      await bridgeAdmin.methods
        .whitelistToken(
          chainId,
          l1Token2.options.address,
          l2Token2Address,
          bridgePool2.options.address,
          0,
          defaultGasLimit,
          defaultGasPrice,
          0
        )
        .send({ from: owner });

      // Update the client. should now contain the new bridgepool2 address as well as the original one.
      await client.update();
      assert.equal(
        JSON.stringify(client.getBridgePoolsAddresses()),
        JSON.stringify([bridgePool.options.address, bridgePool2.options.address])
      );

      // Updating again should not change anything
      // Update the client. should now contain the new bridgepool2 address as well as the original one.
      await client.update();
      assert.equal(
        JSON.stringify(client.getBridgePoolsAddresses()),
        JSON.stringify([bridgePool.options.address, bridgePool2.options.address])
      );

      // Initiating relay actions on both bridgePools should be correctly captured by the client.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      const txn = await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Before updating, save expected relayed information based on current contract state. We shouldn't have to make
      // a contract call to fetch this data as it should be stored in the client.
      const relayAttemptData = {
        relayState: ClientRelayState.Pending,
        slowRelayer: relayer,
        relayId: client.getBridgePoolForDeposit(depositData).relayNonce,
        realizedLpFeePct: defaultRealizedLpFee,
        priceRequestTime: client.getBridgePoolForDeposit(depositData).currentTime,
        proposerBond,
        finalFee,
      };
      expectedRelayedDepositInformation.priceRequestTime = relayAttemptData.priceRequestTime;
      expectedRelayedDepositInformation.relayId = relayAttemptData.relayId;

      // Next, advance time and settle the relay. State should update accordingly.
      await timer.methods
        .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + defaultLiveness)
        .send({ from: owner });
      await bridgePool.methods.settleRelay(depositData, relayAttemptData).send({ from: relayer });

      // Construct the expected relay data that the client should return.
      expectedRelayedDepositInformation.relayState = ClientRelayState.Finalized;
      expectedRelayedDepositInformation.blockNumber = txn.blockNumber;
      let expectedBridgePool1Relays = [JSON.parse(JSON.stringify(expectedRelayedDepositInformation))]; // deep copy

      // Change some of the variables and and re-relay.
      depositData.depositId = 2;
      depositData.l2Sender = rando;
      depositData.l1Recipient = rando;
      depositData.amount = toWei("4.2");
      relayData.realizedLpFeePct = toWei("0.11");
      relayData.slowRelayer = rando;
      relayData.relayId = 1;
      relayData.priceRequestTime = Number((await bridgePool.methods.getCurrentTime().call()).toString());

      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      const txn2 = await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: rando });

      // Sync the modified deposit and relay data with the expected returned data and store it.
      syncExpectedRelayedDepositInformation();

      ({ depositHash, relayAncillaryData, relayAncillaryDataHash } = await generateRelayData(
        depositData,
        relayData,
        bridgePool
      ));
      expectedRelayedDepositInformation.relayState = ClientRelayState.Pending;
      expectedRelayedDepositInformation.depositHash = depositHash;
      expectedRelayedDepositInformation.proposerBond = toWei("0.21");
      expectedRelayedDepositInformation.blockNumber = txn2.blockNumber;
      expectedBridgePool1Relays.push(JSON.parse(JSON.stringify(expectedRelayedDepositInformation)));

      // Again, change some more variable and relay something on the second bridgePool
      depositData.depositId = 3;
      depositData.l1Recipient = l1Recipient;
      depositData.l2Sender = depositor;
      depositData.amount = toWei("4.21");
      relayData.slowRelayer = relayer;
      relayData.realizedLpFeePct = toWei("0.13");
      relayData.relayId = 0; // First relay on new Bridge
      relayData.priceRequestTime = Number((await bridgePool2.methods.getCurrentTime().call()).toString());
      await l1Token2.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
      await l1Token2.methods
        .approve(bridgePool2.options.address, initialPoolLiquidity)
        .send({ from: liquidityProvider });
      await bridgePool2.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
      await l1Token2.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token2.methods.approve(bridgePool2.options.address, totalRelayBond).send({ from: relayer });
      const txn3 = await bridgePool2.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Sync the modified deposit and relay data with the expected returned data and store it.
      syncExpectedRelayedDepositInformation(l1Token2.options.address);
      ({ depositHash, relayAncillaryData, relayAncillaryDataHash } = await generateRelayData(
        depositData,
        relayData,
        bridgePool,
        l1Token2.options.address
      ));
      expectedRelayedDepositInformation.depositHash = depositHash;
      expectedRelayedDepositInformation.proposerBond = toWei("0.2105");
      expectedRelayedDepositInformation.blockNumber = txn3.blockNumber;
      let expectedBridgePool2Relays = [expectedRelayedDepositInformation];

      await client.update();

      // There should be 3 relayed deposits in total. 2 for the first l1Token and 1 for the second token.
      assert.equal((await client.getAllRelayedDeposits()).length, 3);
      assert.equal((await client.getRelayedDepositsForL1Token(l1Token.options.address)).length, 2);
      assert.equal((await client.getRelayedDepositsForL1Token(l1Token2.options.address)).length, 1);

      // Finally, check the contents of the client data matches to what was expected
      // All relays should contain info about both relays.
      assert.equal(
        JSON.stringify(await client.getAllRelayedDeposits()),
        JSON.stringify([...expectedBridgePool1Relays, ...expectedBridgePool2Relays])
      );

      // Filtering by an l1Token should return only those relays.
      assert.equal(
        JSON.stringify(await client.getRelayedDepositsForL1Token(l1Token.options.address)),
        JSON.stringify(expectedBridgePool1Relays)
      );

      assert.equal(
        JSON.stringify(await client.getRelayedDepositsForL1Token(l1Token2.options.address)),
        JSON.stringify(expectedBridgePool2Relays)
      );

      // Filtering by pendingRelays should return accordingly. Note that we need to put expectedBridgePool1Relays[1]
      // second as this had a larger relay (of size 4.21 vs 4.20) and the getPendingRelayedDeposits orders by relay
      // size to enable the disputer to dispute the most dangerous invalid relays first.
      assert.equal(
        JSON.stringify(await client.getPendingRelayedDeposits()),
        JSON.stringify([...expectedBridgePool2Relays, expectedBridgePool1Relays[1]])
      );

      assert.equal(
        JSON.stringify(await client.getPendingRelayedDepositsForL1Token(l1Token.options.address)),
        JSON.stringify([expectedBridgePool1Relays[1]])
      );

      assert.equal(
        JSON.stringify(await client.getPendingRelayedDepositsForL1Token(l1Token2.options.address)),
        JSON.stringify(expectedBridgePool2Relays)
      );
    });
  });
  describe("Realized liquidity provision calculation", function () {
    // The tests below do not validate the calculateRealizedLpFeePct logic. This is tested separately in helper unit
    // tests. See the tests in financial-templates-lib/test/helpers/acrossFeeCalculator.js. Rather, the tests here
    // validate that with modified liquidity the quoted rates update as expected.

    it("Correctly calculates the realized LP fee for a given deposit", async function () {
      // The before each at the top of this file added 100 units of liquidity to the pool. The deposit data, as created
      // at the top, is for a relay of 10 units. This should increment the pool utilization from 0% to 10%. From the
      // jupiter notebook, this should be a rate of 0.000117987509354032.

      await client.update();
      assert.equal(
        (await client.calculateRealizedLpFeePctForDeposit(depositData)).toString(),
        toWei("0.000117987509354032")
      );

      // Next, relay a large deposit of 60 units. this takes the pool utilization from 0% to 60% (note we did not
      // actually relay the relay in `depositData` so utilization is still 0 before this action).
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct)).muln(6);
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams({ amount: toWei("60") })).send({ from: relayer });

      // Now, as the pool utilization has increased, the quote we get from the client should increment accordingly.
      // However, the quote at the time of the depositData should NOT increase relay was done after that quote
      // timestamp. Check that this has not moved.
      await client.update();
      assert.equal(
        (await client.calculateRealizedLpFeePctForDeposit(depositData)).toString(),
        toWei("0.000117987509354032")
      );

      // If we set the quoteTimestamp to the current block time then the realizedLPFee should increase.

      assert.equal(
        (
          await client.calculateRealizedLpFeePctForDeposit({
            ...depositData,
            quoteTimestamp: (await web3.eth.getBlock("latest")).timestamp,
          })
        ).toString(),
        toWei("0.002081296752280018")
      );
    });
  });
});
