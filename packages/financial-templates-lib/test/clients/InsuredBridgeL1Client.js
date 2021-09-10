const hre = require("hardhat");
const { web3 } = require("hardhat");
const { interfaceName, TokenRolesEnum, InsuredBridgeRelayStateEnum, ZERO_ADDRESS } = require("@uma/common");
const { getContract } = hre;
const { utf8ToHex, toWei, toBN, soliditySha3 } = web3.utils;

// TODO: refactor to common util
const { deployOptimismContractMock } = require("../../../core/test/insured-bridge/helpers/SmockitHelper");

const winston = require("winston");
const { assert } = require("chai");

const BridgeAdmin = getContract("BridgeAdmin");
const BridgePool = getContract("BridgePool");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("OptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");
const MockOracle = getContract("MockOracleAncillary");

// Client to test
const { InsuredBridgeL1Client } = require("../../dist/clients/InsuredBridgeL1Client");

// tested client
let client;

// Contract objects
let bridgeAdmin, bridgePool;

let finder,
  store,
  identifierWhitelist,
  collateralWhitelist,
  l1CrossDomainMessengerMock,
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
const defaultQuoteTimestamp = 100000;
const lpFeeRatePerSecond = toWei("0.0000015");
const finalFee = toWei("1");
const defaultGasLimit = 1_000_000;

describe("InsuredBridgeL1Client", function () {
  let accounts,
    owner,
    depositContractImpersonator,
    depositor,
    relayer,
    instantRelayer,
    liquidityProvider,
    recipient,
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

  const generateRelayData = async (depositData, relayData, bridgePool) => {
    // Save other reused values.
    depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint64", "uint64", "address", "address", "address", "uint256", "uint64", "uint64", "uint64"],
      [
        depositData.depositId,
        depositData.depositTimestamp,
        depositData.recipient,
        depositData.l2Sender,
        depositData.l1Token,
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

  const syncExpectedRelayedDepositInformation = () => {
    expectedRelayedDepositInformation = {
      depositId: depositData.depositId,
      sender: depositData.l2Sender,
      slowRelayer: relayData.slowRelayer,
      disputedSlowRelayers: [],
      instantRelayer: relayData.instantRelayer, // not sped up so should be 0x000...
      depositTimestamp: depositData.depositTimestamp,
      recipient: depositData.recipient,
      l1Token: depositData.l1Token,
      amount: depositData.amount,
      slowRelayFeePct: depositData.slowRelayFeePct,
      instantRelayFeePct: depositData.instantRelayFeePct,
      realizedLpFeePct: relayData.realizedLpFeePct,
      priceRequestAncillaryDataHash: relayAncillaryDataHash,
      depositHash: depositHash,
      depositContract: depositContractImpersonator,
      relayState: 0, // pending
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
      recipient,
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
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: owner });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });

    // Set up the Insured bridge contracts.

    // Deploy and setup BridgeAdmin
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: owner });

    await bridgeAdmin.methods.setDepositContract(depositContractImpersonator).send({ from: owner });

    // Deploy a bridgePool and whitelist it.
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      timer.options.address
    ).send({ from: owner });

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(l1Token.options.address, l2Token, bridgePool.options.address, defaultGasLimit)
      .send({ from: owner });

    // Add some liquidity to the pool to facilitate bridging actions.
    await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
    await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
    await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });

    // Create the InsuredBridgeL1Client to be tested.

    // The InsuredBridgeL1Client does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    client = new InsuredBridgeL1Client(dummyLogger, web3, bridgeAdmin.options.address);

    // Create some data for relay the initial relay action.

    // Store expected relay data that we'll use to verify contract state:
    depositData = {
      depositId: 1,
      depositTimestamp: (await optimisticOracle.methods.getCurrentTime().call()).toString(),
      recipient: recipient,
      l2Sender: depositor,
      l1Token: l1Token.options.address,
      amount: relayAmount,
      slowRelayFeePct: defaultSlowRelayFeePct,
      instantRelayFeePct: defaultInstantRelayFeePct,
      quoteTimestamp: defaultQuoteTimestamp,
    };
    relayData = {
      relayState: InsuredBridgeRelayStateEnum.UNINITIALIZED,
      priceRequestTime: 0,
      realizedLpFeePct: defaultRealizedLpFee,
      slowRelayer: relayer,
      instantRelayer: ZERO_ADDRESS,
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

      const relayStatus = await bridgePool.methods.relays(depositHash).call();

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

      await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

      await client.update();

      // After the fast relay, there should be an instant relayer set and the relayState should be updated.
      expectedRelayedDepositInformation.instantRelayer = instantRelayer;
      expectedRelayedDepositInformation.relayState = 1; // sped up

      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(JSON.stringify(client.getPendingRelayedDeposits()), JSON.stringify([])); // Not pending anymore

      // Next, advance time and settle the relay. State should update accordingly.
      await timer.methods
        .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + defaultLiveness)
        .send({ from: owner });
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: relayer });

      // Settle relay.
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      await client.update();
      expectedRelayedDepositInformation.relayState = 3; // settled
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

      const relayStatus = await bridgePool.methods.relays(depositHash).call();

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
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

      await client.update();

      // After the fast relay, there should be an instant relayer set and the relayState should be updated.
      expectedRelayedDepositInformation.instantRelayer = instantRelayer;
      expectedRelayedDepositInformation.relayState = 1; // sped up

      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(JSON.stringify(client.getPendingRelayedDeposits()), JSON.stringify([]));

      // Next, dispute the relay. The state should update accordingly in the client.
      await timer.methods.setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + 1).send({ from: owner });
      await l1Token.methods.mint(disputer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: disputer });

      await client.update();
      expectedRelayedDepositInformation.relayState = 2; // disputed
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(JSON.stringify(client.getPendingRelayedDeposits()), JSON.stringify([]));

      // Can re-relay the deposit.
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      // Cache price request timestamp.

      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: rando });

      // Check the client updated accordingly. Importantly there should be a new slow relayer, the disputed slow relayers
      // should contain the previous relayer.
      await client.update();
      expectedRelayedDepositInformation.slowRelayer = rando; // The re-relayer was the rando account.
      expectedRelayedDepositInformation.disputedSlowRelayers.push(relayer); // disputed
      assert.equal(JSON.stringify(client.getAllRelayedDeposits()), JSON.stringify([expectedRelayedDepositInformation]));
      assert.equal(JSON.stringify(client.getPendingRelayedDeposits()), JSON.stringify([]));
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
        timer.options.address
      ).send({ from: owner });

      // Add L1-L2 token mapping
      const l2Token2Address = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
      await bridgeAdmin.methods
        .whitelistToken(l1Token2.options.address, l2Token2Address, bridgePool2.options.address, defaultGasLimit)
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

      // Next, advance time and settle the relay. State should update accordingly.
      await timer.methods
        .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + defaultLiveness)
        .send({ from: owner });
      const relayStatus = await bridgePool.methods.relays(depositHash).call();
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: relayer });

      // Settle relay.
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // Construct the expected relay data that the client should return.
      expectedRelayedDepositInformation.relayState = 3; // settled
      let expectedBridgePool1Relays = [JSON.parse(JSON.stringify(expectedRelayedDepositInformation))]; // deep copy

      // Change some of the variables and and re-relay.
      depositData.depositId = 2;
      depositData.l2Sender = rando;
      depositData.recipient = rando;
      depositData.amount = toWei("4.2");
      relayData.realizedLpFeePct = toWei("0.11");
      relayData.slowRelayer = rando;
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
      expectedRelayedDepositInformation.relayState = 0; // Pending
      expectedRelayedDepositInformation.depositHash = depositHash;
      expectedRelayedDepositInformation.priceRequestAncillaryDataHash = relayAncillaryDataHash;
      expectedBridgePool1Relays.push(JSON.parse(JSON.stringify(expectedRelayedDepositInformation)));

      // Again, change some ore variable and relay something on the second bridgePool
      depositData.depositId = 3;
      depositData.recipient = recipient;
      depositData.l2Sender = depositor;
      depositData.l1Token = l1Token2.options.address;
      depositData.amount = toWei("4.21");
      relayData.slowRelayer = relayer;
      relayData.realizedLpFeePct = toWei("0.13");
      await l1Token2.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
      await l1Token2.methods
        .approve(bridgePool2.options.address, initialPoolLiquidity)
        .send({ from: liquidityProvider });
      await bridgePool2.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
      await l1Token2.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token2.methods.approve(bridgePool2.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool2.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Sync the modified deposit and relay data with the expected returned data and store it.
      syncExpectedRelayedDepositInformation();
      ({ depositHash, relayAncillaryData, relayAncillaryDataHash } = await generateRelayData(
        depositData,
        relayData,
        bridgePool
      ));
      expectedRelayedDepositInformation.depositHash = depositHash;
      expectedRelayedDepositInformation.priceRequestAncillaryDataHash = relayAncillaryDataHash;
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
});
