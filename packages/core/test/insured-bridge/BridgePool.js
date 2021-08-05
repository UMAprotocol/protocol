const hre = require("hardhat");
const {
  didContractThrow,
  runDefaultFixture,
  interfaceName,
  TokenRolesEnum,
  InsuredBridgeRelayStateEnum,
  ZERO_ADDRESS,
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
let mockOracle;

// Hard-coded test params:
const defaultGasLimit = 1_000_000;
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const defaultProposerRewardPct = toWei("0.05");
const defaultProposerBondPct = toWei("0.05");
const defaultMaxFee = toWei("0.25");
const defaultRealizedFee = toWei("0.1");
const finalFee = toWei("1");
const initialPoolLiquidity = toWei("1000");
const relayAmount = toBN(initialPoolLiquidity)
  .mul(toBN(toWei("0.1")))
  .div(toBN(toWei("1")))
  .toString();
const realizedFeeAmount = toBN(defaultRealizedFee)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")));
const relayAmountSubFee = toBN(relayAmount).sub(realizedFeeAmount).toString();
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
  let accounts, owner, depositContractImpersonator, depositor, relayer, recipient, instantRelayer, disputer, rando;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [
      owner,
      depositContractImpersonator,
      depositor,
      relayer,
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
    bridgePool = await BridgePool.new(bridgeAdmin.options.address, timer.options.address).send({ from: owner });

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(l1Token.options.address, l2Token, bridgePool.options.address, defaultGasLimit)
      .send({ from: owner });

    // Seed Pool, relayers, and disputer with tokens.
    await l1Token.methods.mint(bridgePool.options.address, initialPoolLiquidity).send({ from: owner });
    await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
    await l1Token.methods.mint(disputer, totalRelayBond).send({ from: owner });
    await l1Token.methods.mint(instantRelayer, relayAmountSubFee).send({ from: owner });

    // Store expected relay data that we'll use to verify contract state:
    depositData = {
      depositId: 1,
      l2Sender: depositor,
      recipient: recipient,
      depositTimestamp: (await optimisticOracle.methods.getCurrentTime().call()).toString(),
      l1Token: l1Token.options.address,
      amount: relayAmount,
      maxFeePct: defaultMaxFee,
    };
    relayData = {
      relayState: InsuredBridgeRelayStateEnum.UNINITIALIZED,
      priceRequestTime: 0,
      proposerRewardPct: defaultProposerRewardPct,
      realizedFeePct: defaultRealizedFee,
      slowRelayer: relayer,
      instantRelayer: ZERO_ADDRESS,
    };

    // Save other reused values.
    depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint64", "uint64", "uint64", "uint256", "address", "address", "address"],
      [
        depositData.depositTimestamp,
        depositData.maxFeePct,
        depositData.depositId,
        depositData.amount,
        depositData.l2Sender,
        depositData.recipient,
        depositData.l1Token,
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
              depositData.l1Token,
              depositData.amount,
              relayData.realizedFeePct,
              depositData.maxFeePct,
              relayData.proposerRewardPct
            )
            .send({ from: relayer })
        )
      );
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });

      // realizedFeePct <= maxFeePct
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              depositData.depositId,
              depositData.depositTimestamp,
              depositData.recipient,
              depositData.l2Sender,
              depositData.l1Token,
              depositData.amount,
              toBN(defaultMaxFee)
                .add(toBN(toWei("0.01")))
                .toString(),
              depositData.maxFeePct,
              relayData.proposerRewardPct
            )
            .send({ from: relayer })
        )
      );

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
              depositData.l1Token,
              initialPoolLiquidity,
              relayData.realizedFeePct,
              depositData.maxFeePct,
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
              depositData.l1Token,
              toBN(initialPoolLiquidity)
                .mul(toBN(toWei("0.99")))
                .div(toBN(toWei("1"))),
              relayData.realizedFeePct,
              depositData.maxFeePct,
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
          depositData.l1Token,
          depositData.amount,
          relayData.realizedFeePct,
          depositData.maxFeePct,
          relayData.proposerRewardPct
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
      assert.equal(relayStatus.proposerRewardPct.toString(), defaultProposerRewardPct);
      assert.equal(relayStatus.realizedFeePct.toString(), defaultRealizedFee);

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
      let duplicateRelayData = {
        proposerRewardPct: toBN(defaultProposerRewardPct).mul(toBN("2")),
        realizedFeePct: toBN(defaultRealizedFee).mul(toBN("2")),
      };
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              depositData.depositId,
              depositData.depositTimestamp,
              depositData.recipient,
              depositData.l2Sender,
              depositData.l1Token,
              depositData.amount,
              duplicateRelayData.realizedFeePct,
              depositData.maxFeePct,
              duplicateRelayData.proposerRewardPct
            )
            .send({ from: rando })
        )
      );
    });
  });
  describe("Speed up relay", () => {
    it("Can add instant relayer to pending relay", async () => {
      // Propose new relay:
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.l1Token,
          depositData.amount,
          relayData.realizedFeePct,
          depositData.maxFeePct,
          relayData.proposerRewardPct
        )
        .send({ from: relayer });

      // Grab OO price request information from Relay struct.
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Must approve contract to pull deposit amount.
      assert(await didContractThrow(bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer })));
      await l1Token.methods.approve(bridgePool.options.address, relayAmountSubFee).send({ from: instantRelayer });
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
          depositData.l1Token,
          depositData.amount,
          relayData.realizedFeePct,
          depositData.maxFeePct,
          relayData.proposerRewardPct
        )
        .send({ from: rando });

      // Speed up relay and check state is modified as expected:
      const speedupTxn = await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });
      await assertEventEmitted(speedupTxn, bridgePool, "RelaySpedUp", (ev) => {
        return ev.instantRelayer === instantRelayer && ev.depositHash === depositHash;
      });
      const speedupRelayStatus = await bridgePool.methods.relays(depositHash).call();
      assert.equal(speedupRelayStatus.relayState, InsuredBridgeRelayStateEnum.PENDING);
      assert.equal(speedupRelayStatus.priceRequestTime.toString(), requestTimestamp);
      assert.equal(speedupRelayStatus.instantRelayer, instantRelayer);
      assert.equal(speedupRelayStatus.slowRelayer, rando);
      assert.equal(speedupRelayStatus.proposerRewardPct.toString(), defaultProposerRewardPct);
      assert.equal(speedupRelayStatus.realizedFeePct.toString(), defaultRealizedFee);

      // Check that contract pulled relay amount from instant relayer.
      assert.equal(
        (await l1Token.methods.balanceOf(instantRelayer).call()).toString(),
        "0",
        "Instant Relayer should transfer relay amount"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(),
        toBN(initialPoolLiquidity).add(toBN(relayAmountSubFee)),
        "BridgePool should custody relay amount"
      );

      // Cannot repeatedly speed relay up.
      await l1Token.methods.mint(instantRelayer, relayAmountSubFee).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, relayAmountSubFee).send({ from: instantRelayer });
      assert(await didContractThrow(bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer })));
    });
  });
  describe("Dispute pending relay", () => {
    it("OptimisticOracle callback deletes relay and marks as a disputed relay", async () => {
      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods
        .relayDeposit(
          depositData.depositId,
          depositData.depositTimestamp,
          depositData.recipient,
          depositData.l2Sender,
          depositData.l1Token,
          depositData.amount,
          relayData.realizedFeePct,
          depositData.maxFeePct,
          relayData.proposerRewardPct
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
              depositData.l1Token,
              depositData.amount,
              relayData.realizedFeePct,
              depositData.maxFeePct,
              relayData.proposerRewardPct
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
            depositData.l1Token,
            depositData.amount,
            toBN(relayData.realizedFeePct).mul(toBN("2")),
            depositData.maxFeePct,
            relayData.proposerRewardPct
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
            depositData.l1Token,
            depositData.amount,
            relayData.realizedFeePct,
            depositData.maxFeePct,
            relayData.proposerRewardPct
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
          depositData.l1Token,
          depositData.amount,
          relayData.realizedFeePct,
          depositData.maxFeePct,
          relayData.proposerRewardPct
        )
        .send({ from: relayer });

      // Grab OO price request information from Relay struct.
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Speed up relay.
      await l1Token.methods.approve(bridgePool.options.address, relayAmountSubFee).send({ from: instantRelayer });
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
          depositData.l1Token,
          depositData.amount,
          relayData.realizedFeePct,
          depositData.maxFeePct,
          relayData.proposerRewardPct
        )
        .send({ from: rando });

      // Check that the instant relayer address is copied over.
      const newRelayStatus = await bridgePool.methods.relays(depositHash).call();
      assert.equal(newRelayStatus.relayState, InsuredBridgeRelayStateEnum.PENDING);
      assert.equal(newRelayStatus.priceRequestTime.toString(), requestTimestamp);
      assert.equal(newRelayStatus.instantRelayer, instantRelayer);
      assert.equal(newRelayStatus.slowRelayer, rando);
      assert.equal(newRelayStatus.proposerRewardPct.toString(), defaultProposerRewardPct);
      assert.equal(newRelayStatus.realizedFeePct.toString(), defaultRealizedFee);
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
          depositData.l1Token,
          depositData.amount,
          relayData.realizedFeePct,
          depositData.maxFeePct,
          relayData.proposerRewardPct
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
});
