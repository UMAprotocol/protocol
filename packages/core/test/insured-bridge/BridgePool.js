const hre = require("hardhat");
const {
  didContractThrow,
  runDefaultFixture,
  interfaceName,
  TokenRolesEnum,
  InsuredBridgeDepositStateEnum,
  InsuredBridgeDepositTypeEnum,
  ZERO_ADDRESS,
} = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { hexToUtf8, utf8ToHex, toWei, toBN } = web3.utils;

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
const totalRelayBond = toBN(defaultProposerBondPct)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")))
  .add(toBN(finalFee));

// Expected data that will be used to identify a successful relay:
let relayAncillaryData;

describe("BridgePool", () => {
  let accounts, owner, depositContractImpersonator, depositor, relayer, recipient;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, depositContractImpersonator, depositor, relayer, recipient, l2Token] = accounts;
    await runDefaultFixture(hre);

    // Deploy or fetch deployed contracts:
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
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

    // Deploy and setup BridgeFactory:
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier,
      timer.options.address
    ).send({ from: owner });
    await bridgeAdmin.methods.setDepositContract(depositContractImpersonator).send({ from: owner });

    // New BridgePool linked to BridgeFactory
    bridgePool = await BridgePool.new(bridgeAdmin.options.address, timer.options.address).send({ from: owner });

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(l1Token.options.address, l2Token, bridgePool.options.address, defaultGasLimit)
      .send({ from: owner });

    // Seed Pool and relayer with tokens.
    await l1Token.methods.mint(bridgePool.options.address, initialPoolLiquidity).send({ from: owner });
    await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });

    // Store expected relay data that we'll use to verify contract state:
    relayAncillaryData = {
      depositId: 1,
      l2Sender: depositor,
      recipient: recipient,
      depositTimestamp: (await optimisticOracle.methods.getCurrentTime().call()).toString(),
      l1Token: l1Token.options.address,
      amount: relayAmount,
      maxFeePct: defaultMaxFee,
      proposerRewardPct: defaultProposerRewardPct,
      realizedFeePct: defaultRealizedFee,
      slowRelayer: relayer,
    };
  });
  it("Constructs utf8-encoded ancillary data for relay", async function () {
    const result = await bridgePool.methods.getRelayAncillaryData(relayAncillaryData).call({ from: owner });
    let expectedAncillaryDataUtf8 = "";
    Object.keys(relayAncillaryData).forEach((key) => {
      // Set addresses to lower case and strip leading "0x"'s in order to recreate how Solidity encodes addresses
      // to utf8.
      if (relayAncillaryData[key].toString().startsWith("0x")) {
        expectedAncillaryDataUtf8 += `${key}:${relayAncillaryData[key].toString().substr(2).toLowerCase()},`;
      } else {
        expectedAncillaryDataUtf8 += `${key}:${relayAncillaryData[key].toString()},`;
      }
    });
    expectedAncillaryDataUtf8 += `depositContract:${depositContractImpersonator.substr(2).toLowerCase()}`;
    assert.equal(hexToUtf8(result), expectedAncillaryDataUtf8);
  });
  describe("Relay deposit", () => {
    it("Basic checks", async () => {
      // Fails if approval not given by relayer.
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              relayAncillaryData.depositId,
              relayAncillaryData.depositTimestamp,
              relayAncillaryData.recipient,
              relayAncillaryData.l2Sender,
              relayAncillaryData.l1Token,
              relayAncillaryData.amount,
              relayAncillaryData.realizedFeePct,
              relayAncillaryData.maxFeePct,
              relayAncillaryData.proposerRewardPct
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
              relayAncillaryData.depositId,
              relayAncillaryData.depositTimestamp,
              relayAncillaryData.recipient,
              relayAncillaryData.l2Sender,
              relayAncillaryData.l1Token,
              relayAncillaryData.amount,
              toBN(defaultMaxFee)
                .add(toBN(toWei("0.01")))
                .toString(),
              relayAncillaryData.maxFeePct,
              relayAncillaryData.proposerRewardPct
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
              relayAncillaryData.depositId,
              relayAncillaryData.depositTimestamp,
              relayAncillaryData.recipient,
              relayAncillaryData.l2Sender,
              relayAncillaryData.l1Token,
              initialPoolLiquidity,
              relayAncillaryData.realizedFeePct,
              relayAncillaryData.maxFeePct,
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
              relayAncillaryData.depositId,
              relayAncillaryData.depositTimestamp,
              relayAncillaryData.recipient,
              relayAncillaryData.l2Sender,
              relayAncillaryData.l1Token,
              toBN(initialPoolLiquidity)
                .mul(toBN(toWei("0.99")))
                .div(toBN(toWei("1"))),
              relayAncillaryData.realizedFeePct,
              relayAncillaryData.maxFeePct,
              toWei("0.15")
            )
            .send({ from: relayer })
        )
      );

      // Pending relay doesn't already exist.
      await bridgePool.methods
        .relayDeposit(
          relayAncillaryData.depositId,
          relayAncillaryData.depositTimestamp,
          relayAncillaryData.recipient,
          relayAncillaryData.l2Sender,
          relayAncillaryData.l1Token,
          relayAncillaryData.amount,
          relayAncillaryData.realizedFeePct,
          relayAncillaryData.maxFeePct,
          relayAncillaryData.proposerRewardPct
        )
        .send({ from: relayer });
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              relayAncillaryData.depositId,
              relayAncillaryData.depositTimestamp,
              relayAncillaryData.recipient,
              relayAncillaryData.l2Sender,
              relayAncillaryData.l1Token,
              relayAncillaryData.amount,
              relayAncillaryData.realizedFeePct,
              relayAncillaryData.maxFeePct,
              relayAncillaryData.proposerRewardPct
            )
            .send({ from: relayer })
        )
      );

      // TODO: Pending dispute doesn't exist for relayer
    });
    it("Requests and proposes optimistic price request", async () => {
      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      const txn = await bridgePool.methods
        .relayDeposit(
          relayAncillaryData.depositId,
          relayAncillaryData.depositTimestamp,
          relayAncillaryData.recipient,
          relayAncillaryData.l2Sender,
          relayAncillaryData.l1Token,
          relayAncillaryData.amount,
          relayAncillaryData.realizedFeePct,
          relayAncillaryData.maxFeePct,
          relayAncillaryData.proposerRewardPct
        )
        .send({ from: relayer });

      // Check L1 token balances.
      const expectedReward = toBN(relayAmount)
        .mul(toBN(defaultProposerRewardPct))
        .div(toBN(toWei("1")));
      assert.equal(
        (await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(),
        toBN(initialPoolLiquidity).sub(toBN(expectedReward)).toString(),
        "Reward should be paid out of pool balance"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(relayer).call()).toString(),
        "0",
        "Relayer should post entire balance as bond"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
        expectedReward.add(toBN(totalRelayBond)).toString(),
        "OptimisticOracle should custody total relay bond + reward"
      );

      // Check event is logged correctly.
      await assertEventEmitted(txn, bridgePool, "DepositRelayed", (ev) => {
        return (
          ev.sender === relayAncillaryData.l2Sender &&
          ev.depositTimestamp === relayAncillaryData.depositTimestamp &&
          ev.recipient === relayAncillaryData.recipient &&
          ev.l1Token === relayAncillaryData.l1Token &&
          ev.slowRelayer === relayer &&
          ev.amount === relayAncillaryData.amount &&
          ev.amount === relayAncillaryData.amount &&
          ev.proposerRewardPct === relayAncillaryData.proposerRewardPct &&
          ev.realizedFeePct === relayAncillaryData.realizedFeePct &&
          ev.depositContract === depositContractImpersonator
        );
      });

      // Check Deposit struct is stored correctly.
      const deposit = await bridgePool.methods.deposits(relayAncillaryData.depositId).call({ from: relayer });
      assert.equal(deposit.depositState, InsuredBridgeDepositStateEnum.PENDING_SLOW);
      assert.equal(deposit.depositType, InsuredBridgeDepositTypeEnum.SLOW);
      assert.equal(deposit.instantRelayer, ZERO_ADDRESS);
      Object.keys(relayAncillaryData).forEach((key) => {
        assert.equal(relayAncillaryData[key], deposit.relayData[key]);
      });

      // Check OptimisticOracle emitted price request contains correct data.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();
      const expectedAncillaryData = await bridgePool.methods
        .getRelayAncillaryData(relayAncillaryData)
        .call({ from: owner });
      await assertEventEmitted(txn, optimisticOracle, "RequestPrice", (ev) => {
        return (
          ev.requester === bridgePool.options.address &&
          hexToUtf8(ev.identifier) === hexToUtf8(defaultIdentifier) &&
          ev.timestamp.toString() === requestTimestamp &&
          ev.ancillaryData === expectedAncillaryData &&
          ev.currency === l1Token.options.address &&
          ev.reward.toString() === expectedReward.toString() &&
          ev.finalFee.toString() === finalFee.toString()
        );
      });
      await assertEventEmitted(txn, optimisticOracle, "ProposePrice", (ev) => {
        return (
          ev.requester === bridgePool.options.address &&
          ev.proposer === relayer &&
          hexToUtf8(ev.identifier) === hexToUtf8(defaultIdentifier) &&
          ev.timestamp.toString() === requestTimestamp &&
          ev.proposedPrice.toString() === toWei("1") &&
          ev.ancillaryData === expectedAncillaryData &&
          ev.expirationTimestamp === expectedExpirationTimestamp &&
          ev.currency === l1Token.options.address
        );
      });
    });
  });
});
