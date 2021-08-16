const hre = require("hardhat");
const {
  didContractThrow,
  runDefaultFixture,
  interfaceName,
  TokenRolesEnum,
  InsuredBridgeRelayStateEnum,
  ZERO_ADDRESS,
  MAX_UINT_VAL,
} = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { hexToUtf8, utf8ToHex, toWei, toBN, soliditySha3 } = web3.utils;

const { deployOptimismContractMock } = require("./helpers/SmockitHelper");

const { assert } = require("chai");

// Tested contracts
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

// Contract objects
let bridgeAdmin;
let bridgePool;
let finder;
let store;
let identifierWhitelist;
let collateralWhitelist;
let l1CrossDomainMessengerMock;
let timer;
let optimisticOracle;
let l1Token;
let l2Token;
let lpToken;
let mockOracle;

// Hard-coded test params:
const defaultGasLimit = 1_000_000;
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const defaultProposerBondPct = toWei("0.05");
const defaultSlowRelayFeePct = toWei("0.01");
const defaultInstantRelayFeePct = toWei("0.01");
const defaultQuoteTimestamp = 100000; // no validation of this happens on L1.
const defaultRealizedLpFee = toWei("0.1");
const finalFee = toWei("1");
const initialPoolLiquidity = toWei("1000");
const relayAmount = toBN(initialPoolLiquidity)
  .mul(toBN(toWei("0.1")))
  .div(toBN(toWei("1")))
  .toString();
const realizedLpFeeAmount = toBN(defaultRealizedLpFee)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")));
const realizedSlowRelayFeeAmount = toBN(defaultSlowRelayFeePct)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")));
const realizedInstantRelayFeeAmount = toBN(defaultInstantRelayFeePct)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")));
const slowRelayAmountSubFee = toBN(relayAmount).sub(realizedLpFeeAmount).sub(realizedSlowRelayFeeAmount).toString();
const instantRelayAmountSubFee = toBN(relayAmount)
  .sub(realizedLpFeeAmount)
  .sub(realizedSlowRelayFeeAmount)
  .sub(realizedInstantRelayFeeAmount)
  .toString();
// Relayers must post proposal bond + final fee
const totalRelayBond = toBN(defaultProposerBondPct)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")))
  .add(toBN(finalFee));
// Winner of a dispute gets bond back + 1/2 of loser's bond + final fee. So, the total dispute refund is
// 1.5x the proposer bond + final fee.
const totalDisputeRefund = toBN(defaultProposerBondPct)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")))
  .mul(toBN(toWei("1.5")))
  .div(toBN(toWei("1")))
  .add(toBN(finalFee));
// Forfeited dispute bond + final fee is paid to store.
const disputePaidToStore = toBN(defaultProposerBondPct)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")))
  .mul(toBN(toWei("0.5")))
  .div(toBN(toWei("1")))
  .add(toBN(finalFee));

// Conveniently re-used values:
let relayData;
let depositData;
let depositDataAbiEncoded;
let depositHash;
let relayAncillaryData;
let relayAncillaryDataHash;

describe("BridgePool", () => {
  let accounts,
    owner,
    depositContractImpersonator,
    depositor,
    relayer,
    liquidityProvider,
    recipient,
    instantRelayer,
    disputer,
    rando;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [
      owner,
      depositContractImpersonator,
      depositor,
      relayer,
      liquidityProvider,
      recipient,
      l2Token,
      instantRelayer,
      disputer,
      rando,
    ] = accounts;
    await runDefaultFixture(hre);

    // Deploy or fetch deployed contracts:
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    store = await Store.deployed();
    timer = await Timer.new().send({ from: owner });

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

    // Deploy and setup BridgeFactory:
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: owner });
    await bridgeAdmin.methods.setDepositContract(depositContractImpersonator).send({ from: owner });

    // New BridgePool linked to BridgeFactory
    bridgePool = await BridgePool.new(
      bridgeAdmin.options.address,
      l1Token.options.address,
      timer.options.address
    ).send({ from: owner });

    // The bridge pool has an embedded ERC20 to represent LP positions.
    lpToken = await ERC20.at(bridgePool.options.address);

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(l1Token.options.address, l2Token, bridgePool.options.address, defaultGasLimit)
      .send({ from: owner });

    // Seed relayers, and disputer with tokens.
    await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
    await l1Token.methods.mint(disputer, totalRelayBond).send({ from: owner });
    await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
    await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });

    // Store expected relay data that we'll use to verify contract state:
    depositData = {
      depositId: 1,
      depositTimestamp: (await optimisticOracle.methods.getCurrentTime().call()).toString(),
      l2Sender: depositor,
      recipient: recipient,
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

    // Save other reused values.
    depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint64", "uint64", "address", "address", "address", "uint256", "uint64", "uint64", "uint64"],
      [
        depositData.depositId,
        depositData.depositTimestamp,
        depositData.l2Sender,
        depositData.recipient,
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
  });
  it("Constructs utf8-encoded ancillary data for relay", async function () {
    let expectedAncillaryDataUtf8 = "";
    Object.keys(depositData).forEach((key) => {
      // Set addresses to lower case and strip leading "0x"'s in order to recreate how Solidity encodes addresses
      // to utf8.
      if (depositData[key].toString().startsWith("0x")) {
        expectedAncillaryDataUtf8 += `${key}:${depositData[key].toString().substr(2).toLowerCase()},`;
      } else {
        expectedAncillaryDataUtf8 += `${key}:${depositData[key].toString()},`;
      }
    });
    Object.keys(relayData).forEach((key) => {
      // Skip relayData params that are not used by the contract to construct ancillary data,
      if (key !== "instantRelayer" && key !== "relayState" && key !== "priceRequestTime") {
        // Set addresses to lower case and strip leading "0x"'s in order to recreate how Solidity encodes addresses
        // to utf8.
        if (relayData[key].toString().startsWith("0x")) {
          expectedAncillaryDataUtf8 += `${key}:${relayData[key].toString().substr(2).toLowerCase()},`;
        } else {
          expectedAncillaryDataUtf8 += `${key}:${relayData[key].toString()},`;
        }
      }
    });
    expectedAncillaryDataUtf8 += `depositContract:${depositContractImpersonator.substr(2).toLowerCase()}`;
    assert.equal(hexToUtf8(relayAncillaryData), expectedAncillaryDataUtf8);
  });
  describe("Relay deposit", () => {
    beforeEach(async function () {
      // Add liquidity to the pool
      await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
    });
    it("Basic checks", async () => {
      // Fails if approval not given by relayer.
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              depositData.depositId,
              depositData.depositTimestamp,
              depositData.recipient,
              depositData.l2Sender,
              depositData.amount,
              depositData.slowRelayFeePct,
              depositData.instantRelayFeePct,
              depositData.quoteTimestamp,
              relayData.realizedLpFeePct
            )
            .send({ from: relayer })
        )
      );
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });

      // Note: For the following tests, mint relayer enough balance such that their balance isn't the reason why the
      // contract call reverts.
      await l1Token.methods.mint(relayer, initialPoolLiquidity).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: relayer });

      // Fails if pool doesn't have enough funds to cover reward; request price will revert when it tries to pull reward.
      // - setting relay amount to the pool's full balance and the reward % to >100% will induce this
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              depositData.depositId,
              depositData.depositTimestamp,
              depositData.recipient,
              depositData.l2Sender,
              initialPoolLiquidity,
              depositData.slowRelayFeePct,
              depositData.instantRelayFeePct,
              depositData.quoteTimestamp,
              toWei("1.01")
            )
            .send({ from: relayer })
        )
      );

      // Fails if withdrawal amount + proposer reward > pool balance. Setting relay amount to 99% of pool's full
      // balance and then reward % to 15%, where the relay amount is already assumed to be 10% of the full balance,
      // means that total withdrawal % = (0.99 + 0.15 * 0.1) > 1.0
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              depositData.depositId,
              depositData.depositTimestamp,
              depositData.recipient,
              depositData.l2Sender,
              toBN(initialPoolLiquidity)
                .mul(toBN(toWei("0.99")))
                .div(toBN(toWei("1"))),
              depositData.slowRelayFeePct,
              depositData.instantRelayFeePct,
              depositData.quoteTimestamp,
              toWei("0.15")
            )
            .send({ from: relayer })
        )
      );
    });
    it("Requests and proposes optimistic price request", async () => {
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();

      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      const txn = await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: relayer });

      // Check L1 token balances.
      assert.equal(
        (await l1Token.methods.balanceOf(relayer).call()).toString(),
        "0",
        "Relayer should post entire balance as bond"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
        totalRelayBond,
        "OptimisticOracle should custody total relay bond"
      );

      // Check RelayData struct is stored correctly and mapped to the deposit hash.
      const relayStatus = await bridgePool.methods.relays(depositHash).call();
      assert.equal(relayStatus.relayState, InsuredBridgeRelayStateEnum.PENDING);
      assert.equal(relayStatus.priceRequestTime.toString(), requestTimestamp);
      assert.equal(relayStatus.instantRelayer, ZERO_ADDRESS);
      assert.equal(relayStatus.slowRelayer, relayer);
      assert.equal(relayStatus.realizedLpFeePct.toString(), defaultRealizedLpFee);

      // Check that relay price request ancillary data is mapped to deposit hash.
      const mappedDepositHash = await bridgePool.methods.ancillaryDataToDepositHash(relayAncillaryDataHash).call();
      assert.equal(mappedDepositHash, depositHash);

      // Check event is logged correctly and emits all information needed to recreate the relay and associated deposit.
      await assertEventEmitted(txn, bridgePool, "DepositRelayed", (ev) => {
        return (
          ev.depositId.toString() === depositData.depositId.toString() &&
          ev.sender === depositData.l2Sender &&
          ev.depositTimestamp === depositData.depositTimestamp &&
          ev.recipient === depositData.recipient &&
          ev.l1Token === depositData.l1Token &&
          ev.amount === depositData.amount &&
          ev.maxFeePct === depositData.maxFeePct &&
          ev.priceRequestAncillaryDataHash === relayAncillaryDataHash &&
          ev.depositHash === depositHash &&
          ev.depositContract === depositContractImpersonator
        );
      });

      // Check OptimisticOracle emitted price request contains correct data.
      await assertEventEmitted(txn, optimisticOracle, "RequestPrice", (ev) => {
        return (
          ev.requester === bridgePool.options.address &&
          hexToUtf8(ev.identifier) === hexToUtf8(defaultIdentifier) &&
          ev.timestamp.toString() === relayStatus.priceRequestTime.toString() &&
          ev.ancillaryData === relayAncillaryData &&
          ev.currency === l1Token.options.address &&
          ev.reward.toString() === "0" &&
          ev.finalFee.toString() === finalFee.toString()
        );
      });
      await assertEventEmitted(txn, optimisticOracle, "ProposePrice", (ev) => {
        return (
          ev.requester === bridgePool.options.address &&
          ev.proposer === relayer &&
          hexToUtf8(ev.identifier) === hexToUtf8(defaultIdentifier) &&
          ev.timestamp.toString() === relayStatus.priceRequestTime.toString() &&
          ev.proposedPrice.toString() === toWei("1") &&
          ev.ancillaryData === relayAncillaryData &&
          ev.expirationTimestamp === expectedExpirationTimestamp &&
          ev.currency === l1Token.options.address
        );
      });

      // Check that another relay with different relay params for the same deposit reverts.
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      let duplicateRelayData = { realizedLpFeePct: toBN(defaultRealizedLpFee).mul(toBN("2")) };
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              depositData.depositId,
              depositData.depositTimestamp,
              depositData.recipient,
              depositData.l2Sender,
              depositData.amount,
              depositData.slowRelayFeePct,
              depositData.instantRelayFeePct,
              depositData.quoteTimestamp,
              duplicateRelayData.realizedLpFeePct
            )
            .send({ from: rando })
        )
      );
    });
  });
  describe("Speed up relay", () => {
    beforeEach(async function () {
      // Add liquidity to the pool
      await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
    });
    it("Can add instant relayer to pending relay", async () => {
      // Propose new relay:
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: relayer });

      // Grab OO price request information from Relay struct.
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Must approve contract to pull deposit amount.
      assert(await didContractThrow(bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer })));
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });
      assert.ok(await bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer }));
      // Cannot speed up disputed relay until another relay attempt is made.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: disputer });
      assert(await didContractThrow(bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer })));

      // Submit another relay and check that speed up transaction will succeed.
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: rando });

      // Speed up relay and check state is modified as expected:
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });
      const speedupTxn = await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });
      await assertEventEmitted(speedupTxn, bridgePool, "RelaySpedUp", (ev) => {
        return ev.instantRelayer === instantRelayer && ev.depositHash === depositHash;
      });
      const speedupRelayStatus = await bridgePool.methods.relays(depositHash).call();
      assert.equal(speedupRelayStatus.relayState, InsuredBridgeRelayStateEnum.PENDING);
      assert.equal(speedupRelayStatus.priceRequestTime.toString(), requestTimestamp);
      assert.equal(speedupRelayStatus.instantRelayer, instantRelayer);
      assert.equal(speedupRelayStatus.slowRelayer, rando);
      assert.equal(speedupRelayStatus.realizedLpFeePct.toString(), defaultRealizedLpFee);

      // Check that contract pulled relay amount from instant relayer.
      assert.equal(
        (await l1Token.methods.balanceOf(instantRelayer).call()).toString(),
        "0",
        "Instant Relayer should transfer relay amount"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(depositData.recipient).call()).toString(),
        instantRelayAmountSubFee,
        "Recipient should receive the full amount, minus slow & instant fees"
      );

      // Cannot repeatedly speed relay up.
      await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, slowRelayAmountSubFee).send({ from: instantRelayer });
      assert(await didContractThrow(bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer })));
    });
  });
  describe("Dispute pending relay", () => {
    beforeEach(async function () {
      // Add liquidity to the pool
      await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
    });
    it("OptimisticOracle callback deletes relay and marks as a disputed relay", async () => {
      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: relayer });
      // Grab OO price request information from Relay struct.
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Fails if not called by OptimisticOracle
      assert(
        await didContractThrow(
          bridgePool.methods
            .priceDisputed(defaultIdentifier, relayStatus.priceRequestTime.toString(), relayAncillaryData, 0)
            .send({ from: disputer })
        )
      );
      assert.ok(
        await bridgePool.methods
          .priceDisputed(defaultIdentifier, relayStatus.priceRequestTime.toString(), relayAncillaryData, 0)
          .call({ from: optimisticOracle.options.address }),
        "Simulated priceDisputed method should succeed if called by OptimisticOracle"
      );

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      const disputeTxn = await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: disputer });

      // Check for expected events:
      await assertEventEmitted(disputeTxn, optimisticOracle, "DisputePrice", (ev) => {
        return (
          ev.requester === bridgePool.options.address &&
          ev.proposer === relayer &&
          ev.disputer === disputer &&
          hexToUtf8(ev.identifier) === hexToUtf8(defaultIdentifier) &&
          ev.timestamp.toString() === relayStatus.priceRequestTime.toString() &&
          ev.ancillaryData === relayAncillaryData &&
          ev.proposedPrice.toString() === toWei("1")
        );
      });
      await assertEventEmitted(disputeTxn, bridgePool, "RelayDisputed", (ev) => {
        return ev.priceRequestAncillaryDataHash === soliditySha3(relayAncillaryData) && ev.depositHash === depositHash;
      });

      // Check BridgePool relay and disputedRelay mappings were modified as expected:
      const postDisputeRelayStatus = await bridgePool.methods.relays(depositHash).call();
      assert.equal(postDisputeRelayStatus.relayState, InsuredBridgeRelayStateEnum.UNINITIALIZED);

      // Mint relayer new bond to try relaying again:
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });

      // The exact same relay params will fail since the params will produce ancillary data that collides with an
      // existing OO dispute.
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              depositData.depositId,
              depositData.depositTimestamp,
              depositData.recipient,
              depositData.l2Sender,
              depositData.amount,
              depositData.slowRelayFeePct,
              depositData.instantRelayFeePct,
              depositData.quoteTimestamp,
              relayData.realizedLpFeePct
            )
            .call({ from: relayer })
        )
      );
      // Slightly changing the relay params will work.
      assert.ok(
        await bridgePool.methods
          .relayDeposit(
            depositData.depositId,
            depositData.depositTimestamp,
            depositData.recipient,
            depositData.l2Sender,
            depositData.amount,
            depositData.slowRelayFeePct,
            depositData.instantRelayFeePct,
            depositData.quoteTimestamp,
            toBN(relayData.realizedLpFeePct).mul(toBN("2"))
          )
          .call({ from: relayer })
      );

      // The same relay params for a new request time will also succeed.
      await timer.methods
        .setCurrentTime((Number(relayStatus.priceRequestTime.toString()) + 1).toString())
        .send({ from: owner });
      assert.ok(
        await bridgePool.methods
          .relayDeposit(
            depositData.depositId,
            depositData.depositTimestamp,
            depositData.recipient,
            depositData.l2Sender,
            depositData.amount,
            depositData.slowRelayFeePct,
            depositData.instantRelayFeePct,
            depositData.quoteTimestamp,
            relayData.realizedLpFeePct
          )
          .call({ from: relayer })
      );
    });
    it("Instant relayer address persists for subsequent relays after a pending relay is disputed", async () => {
      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: relayer });

      // Grab OO price request information from Relay struct.
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Speed up relay.
      await l1Token.methods.approve(bridgePool.options.address, slowRelayAmountSubFee).send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: disputer });

      // Mint another relayer a bond to relay again and check that the instant relayer address is migrated:
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: rando });

      // Check that the instant relayer address is copied over.
      const newRelayStatus = await bridgePool.methods.relays(depositHash).call();
      assert.equal(newRelayStatus.relayState, InsuredBridgeRelayStateEnum.PENDING);
      assert.equal(newRelayStatus.priceRequestTime.toString(), requestTimestamp);
      assert.equal(newRelayStatus.instantRelayer, instantRelayer);
      assert.equal(newRelayStatus.slowRelayer, rando);
      assert.equal(newRelayStatus.realizedLpFeePct.toString(), defaultRealizedLpFee);
    });
    it("OptimisticOracle handles dispute payouts", async () => {
      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: relayer });

      // Grab OO price request information from Relay struct.
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: disputer });

      // Resolve Oracle price.
      const price = toWei("1");
      const stampedDisputeAncillaryData = await optimisticOracle.methods
        .stampAncillaryData(relayAncillaryData, bridgePool.options.address)
        .call();
      await mockOracle.methods
        .pushPrice(defaultIdentifier, relayStatus.priceRequestTime.toString(), stampedDisputeAncillaryData, price)
        .send({ from: owner });

      // Settle OptimisticOracle proposal and check balances.
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: relayer });

      // Dispute was unsuccessful and proposer's original price of "1" was correct. Proposer should receive full relay
      // bond back + portion of loser's bond.
      assert.equal(
        (await l1Token.methods.balanceOf(relayer).call()).toString(),
        totalDisputeRefund.toString(),
        "Relayer should receive entire bond back + 1/2 of loser's bond"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
        "0",
        "OptimisticOracle should refund and reward winner of dispute"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(store.options.address).call()).toString(),
        disputePaidToStore.toString(),
        "OptimisticOracle should pay store the remaining burned bond"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(),
        initialPoolLiquidity,
        "Pool should still have initial liquidity amount"
      );
    });
  });
  describe("Settle finalized relay", () => {
    beforeEach(async function () {
      // Add liquidity to the pool
      await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
    });
    it("Cannot settle disputed", async () => {
      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: relayer });

      // Grab OO price request information from Relay struct.
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: disputer });

      assert(await didContractThrow(bridgePool.methods.settleRelay(depositData).send({ from: relayer })));
    });
    it("Can settle pending relays that passed challenge period", async () => {
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();

      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: relayer });
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Cannot settle if there is no price available
      assert.equal(
        await optimisticOracle.methods
          .hasPrice(
            bridgePool.options.address,
            defaultIdentifier,
            relayStatus.priceRequestTime.toString(),
            relayAncillaryData
          )
          .call(),
        false
      );
      assert(await didContractThrow(bridgePool.methods.settleRelay(depositData).send({ from: relayer })));

      // Expire and settle proposal on the OptimisticOracle.
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: relayer });

      // Verify price is available.
      assert.equal(
        await optimisticOracle.methods
          .hasPrice(
            bridgePool.options.address,
            defaultIdentifier,
            relayStatus.priceRequestTime.toString(),
            relayAncillaryData
          )
          .call(),
        true
      );

      // If the relay status is PENDING and the price is available, then the value must match the original proposal:
      // 1e18.
      assert.equal(relayStatus.relayState, InsuredBridgeRelayStateEnum.PENDING);
      assert.equal(
        (
          await optimisticOracle.methods
            .settleAndGetPrice(defaultIdentifier, relayStatus.priceRequestTime.toString(), relayAncillaryData)
            .call({ from: bridgePool.options.address })
        ).toString(),
        toWei("1")
      );

      // Settle relay and check event logs.
      const settleTxn = await bridgePool.methods.settleRelay(depositData).send({ from: rando });
      await assertEventEmitted(settleTxn, bridgePool, "SettledRelay", (ev) => {
        return (
          ev.depositHash === depositHash &&
          ev.priceRequestAncillaryDataHash === relayAncillaryDataHash &&
          ev.caller === rando
        );
      });

      // Check token balances.
      // - Slow relayer should get back their proposal bond from OO and reward from BridgePool.
      assert.equal(
        (await l1Token.methods.balanceOf(relayer).call()).toString(),
        toBN(totalRelayBond).add(realizedSlowRelayFeeAmount).toString(),
        "Relayer should receive proposal bond + slow relay reward"
      );
      // - Optimistic oracle should have no funds left after refunding bond.
      assert.equal(
        (await l1Token.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
        "0",
        "OptimisticOracle should refund proposal bond"
      );

      // - Bridge pool should have the amount original pool liquidity minus the amount sent to recipient and amount
      // sent to slow relayer. This is equivalent to the initial pool liquidity - the relay amount + realized LP fee.
      assert.equal(
        (await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(),
        toBN(initialPoolLiquidity).sub(toBN(relayAmount)).add(realizedLpFeeAmount).toString(),
        "BridgePool should have balance reduced by relay amount less slow fees and rewards"
      );

      // - Recipient should receive the bridged amount minus the slow relay fee and the LP fee.
      assert.equal(
        (await l1Token.methods.balanceOf(recipient).call()).toString(),
        slowRelayAmountSubFee,
        "Recipient should have bridged amount minus fees"
      );
    });
    it("Instant and slow relayers should get appropriate rewards, pool reimburse the instant relayer", async () => {
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();

      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp,
          relayData.realizedLpFeePct
        )
        .send({ from: relayer });
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Speed up relay.
      await l1Token.methods.approve(bridgePool.options.address, slowRelayAmountSubFee).send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

      // Expire and settle proposal on the OptimisticOracle.
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          relayStatus.priceRequestTime.toString(),
          relayAncillaryData
        )
        .send({ from: relayer });

      const relayerBalanceBefore = await l1Token.methods.balanceOf(relayer).call();
      const instantRelayerBalanceBefore = await l1Token.methods.balanceOf(instantRelayer).call();
      // Settle relay.
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // Check token balances.
      // - Slow relayer should get back their proposal bond from OO and reward from BridgePool.
      // - Fast relayer should get reward from BridgePool and the relayed amount, minus LP and slow withdraw fee. This
      // is equivalent to what the recipient received + the instant relayer fee.
      assert.equal(
        toBN(await l1Token.methods.balanceOf(relayer).call())
          .sub(toBN(relayerBalanceBefore))
          .toString(),
        realizedSlowRelayFeeAmount.toString(),
        "Slow relayer should receive proposal slow relay reward"
      );
      assert.equal(
        toBN(await l1Token.methods.balanceOf(instantRelayer).call())
          .sub(toBN(instantRelayerBalanceBefore))
          .toString(),
        toBN(instantRelayAmountSubFee).add(realizedInstantRelayFeeAmount).toString(),
        "Instant relayer should receive instant relay reward + the instant relay amount sub fees"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
        "0",
        "OptimisticOracle should refund proposal bond"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(),
        toBN(initialPoolLiquidity)
          .sub(toBN(instantRelayAmountSubFee).add(realizedInstantRelayFeeAmount).add(realizedSlowRelayFeeAmount))
          .toString(),
        "BridgePool should have balance reduced by relayed amount to recipinet "
      );
    });
  });
  describe("Liquidity provision", () => {
    beforeEach(async function () {
      await l1Token.methods.mint(rando, toWei("100")).send({ from: owner });
    });
    it("Deposit liquidity", async () => {
      // Before adding liquidity pool should have none and LP should have no LP tokens.
      assert.equal((await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(), "0");
      assert.equal((await lpToken.methods.balanceOf(rando).call()).toString(), "0");

      // Starting exchange rate should be 1, even though there is no liquidity in the pool.
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Approve funds and add to liquidity.
      await l1Token.methods.approve(bridgePool.options.address, MAX_UINT_VAL).send({ from: rando });
      await bridgePool.methods.addLiquidity(toWei("10")).send({ from: rando });

      // Check balances have updated accordingly. Check liquid reserves incremented. Check exchange rate unchanged.
      assert.equal((await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(), toWei("10"));
      assert.equal((await lpToken.methods.balanceOf(rando).call()).toString(), toWei("10"));
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("10"));
      assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), toWei("0"));
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));
    });
    it("Withdraw liquidity", async () => {
      // Approve funds and add to liquidity.
      await l1Token.methods.approve(bridgePool.options.address, MAX_UINT_VAL).send({ from: rando });
      await bridgePool.methods.addLiquidity(toWei("10")).send({ from: rando });

      // LP redeems half their liquidity. Balance should change accordingly.
      await bridgePool.methods.removeLiquidity(toWei("5")).send({ from: rando });

      assert.equal((await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(), toWei("5"));
      assert.equal((await lpToken.methods.balanceOf(rando).call()).toString(), toWei("5"));
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("5"));
      assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), toWei("0"));
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // LP redeems their remaining liquidity. Balance should change accordingly.
      await bridgePool.methods.removeLiquidity(toWei("5")).send({ from: rando });

      assert.equal((await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(), toWei("0"));
      assert.equal((await lpToken.methods.balanceOf(rando).call()).toString(), toWei("0"));
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("0"));
      assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), toWei("0"));
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));
    });
  });
});
