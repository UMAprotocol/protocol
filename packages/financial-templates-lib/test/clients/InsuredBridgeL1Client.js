const hre = require("hardhat");
const { web3 } = hre;
const { interfaceName, TokenRolesEnum, InsuredBridgeRelayStateEnum } = require("@uma/common");
const { getContract } = hre;
const { utf8ToHex, toWei, toBN, soliditySha3 } = web3.utils;
const toBNWei = (number) => toBN(toWei(number.toString()).toString());

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

// Client to test
const { InsuredBridgeL1Client, ClientRelayState } = require("../../dist/clients/InsuredBridgeL1Client");

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
const rateModel = { UBar: toBNWei("0.65"), R0: toBNWei("0.00"), R1: toBNWei("0.08"), R2: toBNWei("1.00") };

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
    // Remove the l1Token. This is part of the deposit data (hash) but is not part of the params for relayDeposit.
    // eslint-disable-next-line no-unused-vars
    const { l1Token, ...params } = _depositData;
    return [...Object.values(params), _relayData.realizedLpFeePct];
  };

  const generateRelayData = async (depositData, relayData, bridgePool, l1TokenAddress = l1Token.options.address) => {
    // Save other reused values.
    depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint8", "uint64", "address", "address", "address", "uint256", "uint64", "uint64", "uint64"],
      [
        depositData.chainId,
        depositData.depositId,
        depositData.l1Recipient,
        depositData.l2Sender,
        l1TokenAddress,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
      ]
    );
    depositHash = soliditySha3(depositDataAbiEncoded);
    relayAncillaryData = await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call();
    relayAncillaryDataHash = soliditySha3(relayAncillaryData);
    return { depositHash, relayAncillaryData, relayAncillaryDataHash };
  };

  const syncExpectedRelayedDepositInformation = (_l1TokenAddress = l1Token.options.address) => {
    const parameters = [
      { t: "uint8", v: depositData.chainId },
      { t: "uint64", v: depositData.depositId },
      { t: "address", v: depositData.l1Recipient },
      { t: "address", v: depositData.l2Sender },
      { t: "uint256", v: depositData.amount },
      { t: "uint64", v: depositData.slowRelayFeePct },
      { t: "uint64", v: depositData.instantRelayFeePct },
      { t: "uint64", v: depositData.quoteTimestamp },
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
      disputedSlowRelayers: [],
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
      relayHash,
      proposerBond,
      finalFee,
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
    optimisticOracle = await OptimisticOracle.new(
      defaultLiveness * 10,
      finder.options.address,
      timer.options.address
    ).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.SkinnyOptimisticOracle), optimisticOracle.options.address)
      .send({ from: owner });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
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

    const rateModels = { [l1Token.options.address]: rateModel };
    client = new InsuredBridgeL1Client(dummyLogger, web3, bridgeAdmin.options.address, rateModels);

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

    syncExpectedRelayedDepositInformation();
  });
  it("Client initial setup", async function () {
    // Before the client is updated, client should error out.
    assert.throws(client.getBridgePoolsAddresses, Error);

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
  });
  describe("Lifecycle tests", function () {
    it("Relayed deposits: deposit, speedup finalize lifecycle", async function () {
      // Before relay should contain no data.
      await client.update();

      // After relaying a deposit, should contain the exacted data.
      const totalRelayBond = toBN(relayAmount).mul(toBN(defaultProposerBondPct));

      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });

      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

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

      // Settle relay.
      await bridgePool.methods.settleRelay(depositData, relayAttemptData).send({ from: relayer });

      await client.update();
      expectedRelayedDepositInformation.relayState = ClientRelayState.Finalized;
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
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

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
      await client.update();

      // As there is only one L1Token that has been set up with the bridge, getAllRelayedDeposits and getRelayedDepositsForL1Token
      // should both return the same thing. This should correspond to the expected data.
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

      // Before relaying, update client state and store expected relay information.
      await client.update();
      expectedRelayedDepositInformation.priceRequestTime = client.getBridgePoolForDeposit(depositData).currentTime;
      expectedRelayedDepositInformation.relayId = client.getBridgePoolForDeposit(depositData).relayNonce;

      // Can re-relay the deposit.
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: rando });

      // Check the client updated accordingly. Importantly there should be new relay params, and the disputed slow
      // relayers should contain the previous relayer.
      await client.update();
      expectedRelayedDepositInformation.slowRelayer = rando; // The re-relayer was the rando account.
      expectedRelayedDepositInformation.disputedSlowRelayers.push(relayer); // disputed
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(
        JSON.stringify(client.getPendingRelayedDeposits()),
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
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

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
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: rando });

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
      await bridgePool2.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

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

      // Filtering by pendingRelays should return accordingly.
      assert.equal(
        JSON.stringify(await client.getPendingRelayedDeposits()),
        JSON.stringify([expectedBridgePool1Relays[1], ...expectedBridgePool2Relays])
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
      // The `depositData` should bring the utilization from 60% to 70%. From the notebook, this should be a realize
      // LP rate of 0.11417582417582407
      await client.update();
      assert.equal(
        (await client.calculateRealizedLpFeePctForDeposit(depositData)).toString(),
        toWei("0.002081296752280018")
      );
    });
  });
});
