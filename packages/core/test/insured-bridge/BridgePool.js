const { assert } = require("chai");
const hre = require("hardhat");
const { web3 } = hre;
const {
  didContractThrow,
  interfaceName,
  TokenRolesEnum,
  InsuredBridgeRelayStateEnum,
  ZERO_ADDRESS,
  MAX_UINT_VAL,
} = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { hexToUtf8, utf8ToHex, toWei, toBN, soliditySha3 } = web3.utils;

// Tested contracts
const BridgePool = getContract("BridgePool");

// Helper contracts
const MessengerMock = getContract("MessengerMock");
const BridgeAdmin = getContract("BridgeAdmin");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("SkinnyOptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");
const MockOracle = getContract("MockOracleAncillary");

// Contract objects
let messenger;
let bridgeAdmin;
let bridgePool;
let finder;
let store;
let identifierWhitelist;
let collateralWhitelist;
let timer;
let optimisticOracle;
let l1Token;
let l2Token;
let lpToken;
let mockOracle;

// Hard-coded test params:
const chainId = "10";
const defaultGasLimit = 1_000_000;
const defaultGasPrice = toWei("1", "gwei");
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const lpFeeRatePerSecond = toWei("0.0000015");
const defaultProposerBondPct = toWei("0.05");
const defaultSlowRelayFeePct = toWei("0.01");
const defaultInstantRelayFeePct = toWei("0.01");
const defaultQuoteTimestamp = "100000"; // no validation of this happens on L1.
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
const proposalBond = toBN(defaultProposerBondPct)
  .mul(toBN(relayAmount))
  .div(toBN(toWei("1")));
const totalRelayBond = proposalBond.add(toBN(finalFee));
// Winner of a dispute gets bond back + 1/2 of loser's bond+final fee. So, the total dispute refund is
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
let depositHash;
let relayAncillaryData;

describe("BridgePool", () => {
  let accounts,
    owner,
    depositContractImpersonator,
    depositor,
    relayer,
    liquidityProvider,
    l1Recipient,
    instantRelayer,
    disputer,
    rando;

  const advanceTime = async (timeIncrease) => {
    await timer.methods
      .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + timeIncrease)
      .send({ from: owner });
  };

  // Construct params from relayDeposit. Uses the default `depositData` as the base information while enabling the
  // caller to override specific values for either the deposit data or relay data.
  const generateRelayParams = (depositDataOverride = {}, relayDataOverride = {}) => {
    const _depositData = { ...depositData, ...depositDataOverride };
    const _relayData = { ...relayData, ...relayDataOverride };
    // Remove the l1Token. This is part of the deposit data (hash) but is not part of the params for relayDeposit.
    // eslint-disable-next-line no-unused-vars
    const { l1Token, ...params } = _depositData;
    return [...Object.values(params), _relayData.realizedLpFeePct];
  };

  // Generate ABI encoded deposit data and deposit data hash.
  const generateDepositHash = (depositData) => {
    const depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint8", "uint64", "address", "address", "address", "uint256", "uint64", "uint64", "uint64"],
      [
        depositData.chainId,
        depositData.depositId,
        depositData.l1Recipient,
        depositData.l2Sender,
        l1Token.options.address,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
      ]
    );
    const depositHash = soliditySha3(depositDataAbiEncoded);
    return depositHash;
  };

  const generateInstantRelayHash = (depositHash, relayData) => {
    const instantRelayDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["bytes32", "uint64"],
      [depositHash, relayData.realizedLpFeePct]
    );
    return soliditySha3(instantRelayDataAbiEncoded);
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [
      owner,
      depositContractImpersonator,
      depositor,
      relayer,
      liquidityProvider,
      l1Recipient,
      l2Token,
      instantRelayer,
      disputer,
      rando,
    ] = accounts;

    // Deploy or fetch deployed contracts:
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

    // Deploy and setup BridgeAdmin:
    messenger = await MessengerMock.new().send({ from: owner });
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: owner });
    await bridgeAdmin.methods
      .setDepositContract(chainId, depositContractImpersonator, messenger.options.address)
      .send({ from: owner });

    // New BridgePool linked to BridgeAdmin
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      timer.options.address
    ).send({ from: owner });

    // The bridge pool has an embedded ERC20 to represent LP positions.
    lpToken = await ERC20.at(bridgePool.options.address);

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(
        chainId,
        l1Token.options.address,
        l2Token,
        bridgePool.options.address,
        defaultGasLimit,
        defaultGasPrice
      )
      .send({ from: owner });

    // Seed relayers, and disputer with tokens.
    await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
    await l1Token.methods.mint(disputer, totalRelayBond).send({ from: owner });
    await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
    await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });

    // Store expected relay data that we'll use to verify contract state:
    depositData = {
      chainId: chainId,
      depositId: 1,
      l1Recipient: l1Recipient,
      l2Sender: depositor,
      amount: relayAmount,
      slowRelayFeePct: defaultSlowRelayFeePct,
      instantRelayFeePct: defaultInstantRelayFeePct,
      quoteTimestamp: defaultQuoteTimestamp,
    };
    relayData = {
      relayId: 0,
      relayState: InsuredBridgeRelayStateEnum.UNINITIALIZED,
      priceRequestTime: 0,
      realizedLpFeePct: defaultRealizedLpFee,
      slowRelayer: relayer,
    };

    // Save other reused values.
    depositHash = generateDepositHash(depositData);
    relayAncillaryData = await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call();
  });
  it("Constructor validation", async function () {
    // LP Token symbol and name cannot be empty.
    assert(
      await didContractThrow(
        BridgePool.new(
          "",
          "LPT",
          bridgeAdmin.options.address,
          l1Token.options.address,
          lpFeeRatePerSecond,
          timer.options.address
        ).send({ from: owner })
      )
    );
    assert(
      await didContractThrow(
        BridgePool.new(
          "LP Token",
          "",
          bridgeAdmin.options.address,
          l1Token.options.address,
          lpFeeRatePerSecond,
          timer.options.address
        ).send({ from: owner })
      )
    );
  });
  it("Constructs utf8-encoded ancillary data for relay", async function () {
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
      { t: "address", v: l1Token.options.address },
    ];
    const hash = web3.utils.soliditySha3(
      web3.eth.abi.encodeParameters(
        parameters.map((elt) => elt.t),
        parameters.map((elt) => elt.v)
      )
    );
    assert.equal(hexToUtf8(relayAncillaryData), `relayHash:${hash.substring(2)}`);
  });
  describe("Relay deposit", () => {
    beforeEach(async function () {
      // Add liquidity to the pool
      await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
    });
    it("Basic checks", async () => {
      // Fails if approval not given by relayer.
      assert(await didContractThrow(bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer })));
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });

      // Note: For the following tests, mint relayer enough balance such that their balance isn't the reason why the
      // contract call reverts.
      await l1Token.methods.mint(relayer, initialPoolLiquidity).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: relayer });

      // Fails if pool doesn't have enough funds to cover reward; request price will revert when it tries to pull reward.
      // -setting relay amount to the pool's full balance and the reward % to >100% will induce this
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(...generateRelayParams({}, { realizedLpFeePct: toWei("1.01") }))
            .send({ from: relayer })
        )
      );

      // Fails if withdrawal amount+proposer reward > pool balance. Setting relay amount to 99% of pool's full
      // balance and then reward % to 15%, where the relay amount is already assumed to be 10% of the full balance,
      // means that total withdrawal %=(0.99+0.15*0.1) > 1.0
      assert(
        await didContractThrow(
          bridgePool.methods
            .relayDeposit(
              ...generateRelayParams(
                {
                  amount: toBN(initialPoolLiquidity)
                    .mul(toBN(toWei("0.99")))
                    .div(toBN(toWei("1"))),
                },
                { realizedLpFeePct: toWei("1.15") }
              )
            )
            .send({ from: relayer })
        )
      );

      assert.equal(await bridgePool.methods.numberOfRelays().call(), "0"); // Relay index should start at 0.
    });
    it("Requests and proposes optimistic price request", async () => {
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();

      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      const txn = await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Relay count increments.
      assert.equal(await bridgePool.methods.numberOfRelays().call(), "1");

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
      assert.equal(relayStatus.relayId.toString(), relayData.relayId.toString());
      assert.equal(relayStatus.relayState, InsuredBridgeRelayStateEnum.PENDING);
      assert.equal(relayStatus.priceRequestTime.toString(), requestTimestamp);
      assert.equal(relayStatus.slowRelayer, relayer);
      assert.equal(relayStatus.realizedLpFeePct.toString(), defaultRealizedLpFee);

      // Instant relayer for this relay should be uninitialized.
      const instantRelayHash = generateInstantRelayHash(depositHash, relayData);
      assert.equal(await bridgePool.methods.instantRelays(instantRelayHash).call(), ZERO_ADDRESS);

      // Check event is logged correctly and emits all information needed to recreate the relay and associated deposit.
      await assertEventEmitted(txn, bridgePool, "DepositRelayed", (ev) => {
        return (
          ev.relayId.toString() === relayData.relayId.toString() &&
          ev.depositData.chainId.toString() === depositData.chainId.toString() &&
          ev.depositData.depositId.toString() === depositData.depositId.toString() &&
          ev.depositData.l2Sender === depositData.l2Sender &&
          ev.slowRelayer === relayer &&
          ev.depositData.l1Recipient === depositData.l1Recipient &&
          ev.l1Token === l1Token.options.address &&
          ev.depositData.amount === depositData.amount &&
          ev.depositData.slowRelayFeePct === depositData.slowRelayFeePct &&
          ev.depositData.instantRelayFeePct === depositData.instantRelayFeePct &&
          ev.depositData.quoteTimestamp === depositData.quoteTimestamp &&
          ev.realizedLpFeePct === relayData.realizedLpFeePct &&
          ev.depositHash === depositHash
        );
      });

      // Check OptimisticOracle emitted price request contains correct data.
      await assertEventEmitted(txn, optimisticOracle, "RequestPrice", (ev) => {
        return (
          ev.requester === bridgePool.options.address &&
          hexToUtf8(ev.identifier) === hexToUtf8(defaultIdentifier) &&
          ev.timestamp.toString() === relayStatus.priceRequestTime.toString() &&
          ev.ancillaryData === relayAncillaryData &&
          ev.request.proposer === relayer &&
          ev.request.disputer === ZERO_ADDRESS &&
          ev.request.currency === l1Token.options.address &&
          !ev.request.settled &&
          ev.request.proposedPrice === toWei("1") &&
          ev.request.resolvedPrice === "0" &&
          ev.request.expirationTime === expectedExpirationTimestamp &&
          ev.request.reward === "0" &&
          ev.request.finalFee === finalFee &&
          ev.request.bond === proposalBond.toString() &&
          ev.request.customLiveness === defaultLiveness.toString()
        );
      });
      await assertEventEmitted(txn, optimisticOracle, "ProposePrice", (ev) => {
        return (
          ev.requester === bridgePool.options.address &&
          hexToUtf8(ev.identifier) === hexToUtf8(defaultIdentifier) &&
          ev.timestamp.toString() === relayStatus.priceRequestTime.toString() &&
          ev.ancillaryData === relayAncillaryData &&
          ev.request.proposer === relayer &&
          ev.request.disputer === ZERO_ADDRESS &&
          ev.request.currency === l1Token.options.address &&
          !ev.request.settled &&
          ev.request.proposedPrice === toWei("1") &&
          ev.request.resolvedPrice === "0" &&
          ev.request.expirationTime === expectedExpirationTimestamp &&
          ev.request.reward === "0" &&
          ev.request.finalFee === finalFee &&
          ev.request.bond === proposalBond.toString() &&
          ev.request.customLiveness === defaultLiveness.toString()
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
              depositData.chainId,
              depositData.depositId,
              depositData.l1Recipient,
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
    it("Valid instant relay, disputed, instant relayer should receive refund following subsequent valid relay", async () => {
      // Propose new relay:
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Must approve contract to pull deposit amount.
      assert(await didContractThrow(bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer })));
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });

      // Can speed up pending relay
      assert.ok(await bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer }));

      // Grab proposed request data from events and submit for dispute:
      const proposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent.returnValues.timestamp,
          proposalEvent.returnValues.ancillaryData,
          proposalEvent.returnValues.request
        )
        .send({ from: disputer });
      // Can speed up disputed relay.
      assert.ok(await bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer }));

      // Submit another relay and check that speed up transaction will succeed. Advance time so that
      // price request data is different.
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      // Cache price request timestamp.
      await advanceTime(1);
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: rando });

      // Can speed up relay even after its price has resolved, as long as it hasn't been settled yet.
      const secondProposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[1];
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          secondProposalEvent.returnValues.timestamp,
          secondProposalEvent.returnValues.ancillaryData,
          secondProposalEvent.returnValues.request
        )
        .send({ from: accounts[0] });
      assert.ok(await bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer }));

      // Speed up relay and check state is modified as expected:
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });
      const speedupTxn = await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });
      await assertEventEmitted(speedupTxn, bridgePool, "RelaySpedUp", (ev) => {
        return (
          ev.instantRelayer === instantRelayer &&
          ev.depositHash === depositHash &&
          ev.realizedLpFeePct === relayData.realizedLpFeePct
        );
      });
      const speedupRelayStatus = await bridgePool.methods.relays(depositHash).call();
      assert.equal(speedupRelayStatus.relayState, InsuredBridgeRelayStateEnum.PENDING_FINALIZATION);
      assert.equal(speedupRelayStatus.priceRequestTime.toString(), requestTimestamp);
      assert.equal(speedupRelayStatus.slowRelayer, rando);
      assert.equal(speedupRelayStatus.realizedLpFeePct.toString(), defaultRealizedLpFee);
      const instantRelayHash = generateInstantRelayHash(
        depositHash,
        relayData // Note: the relay data should be the same as the original relay that was disputed.
      );
      assert.equal(await bridgePool.methods.instantRelays(instantRelayHash).call(), instantRelayer);

      // Check that contract pulled relay amount from instant relayer.
      assert.equal(
        (await l1Token.methods.balanceOf(instantRelayer).call()).toString(),
        "0",
        "Instant Relayer should transfer relay amount"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(depositData.l1Recipient).call()).toString(),
        instantRelayAmountSubFee,
        "Recipient should receive the full amount, minus slow & instant fees"
      );

      // Cannot repeatedly speed relay up.
      await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });
      assert(await didContractThrow(bridgePool.methods.speedUpRelay(depositData).call({ from: instantRelayer })));

      // Burn newly minted tokens to make accounting simpler.
      await l1Token.methods.transfer(owner, instantRelayAmountSubFee).send({ from: instantRelayer });

      // Expire relay. Since instant relayed amount was correct, instant relayer should be refunded and user should
      // still just have the instant relay amount.
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // Check token balances.
      // - Slow relayer should get back their proposal bond from OO and reward from BridgePool.
      // - Fast relayer should get reward from BridgePool and the relayed amount, minus LP and slow relay fee. This
      // is equivalent to what the l1Recipient received + the instant relayer fee.
      // - Recipient already got paid by fast relayer and should receive no further tokens.
      assert.equal(
        (await l1Token.methods.balanceOf(rando).call()).toString(),
        toBN(totalRelayBond).add(realizedSlowRelayFeeAmount).toString(),
        "Slow relayer should receive proposal bond + slow relay reward"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(instantRelayer).call()).toString(),
        toBN(instantRelayAmountSubFee).add(realizedInstantRelayFeeAmount).toString(),
        "Instant relayer should receive instant relay reward + the instant relay amount sub fees"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(depositData.l1Recipient).call()).toString(),
        instantRelayAmountSubFee,
        "Recipient should still have the full amount, minus slow & instant fees"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
        totalDisputeRefund.toString(),
        "OptimisticOracle should still hold dispute refund since dispute has not resolved yet"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(),
        toBN(initialPoolLiquidity)
          .sub(toBN(instantRelayAmountSubFee).add(realizedInstantRelayFeeAmount).add(realizedSlowRelayFeeAmount))
          .toString(),
        "BridgePool should have balance reduced by relayed amount to l1Recipient"
      );
    });
    it("Invalid instant relay, disputed, instant relayer receives no refund following subsequent valid relay", async function () {
      // Propose new invalid relay where realizedFee is too large.
      const invalidRealizedLpFee = toWei("0.4");
      const invalidRelayData = { ...relayData, realizedLpFeePct: invalidRealizedLpFee };
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams({}, invalidRelayData)).send({ from: relayer });

      // Invalid instant relay with incorrect fee sends incorrect amount to user
      const invalidRealizedLpFeeAmount = toBN(invalidRealizedLpFee)
        .mul(toBN(relayAmount))
        .div(toBN(toWei("1")));
      const invalidInstantRelayAmountSubFee = toBN(relayAmount)
        .sub(invalidRealizedLpFeeAmount)
        .sub(realizedSlowRelayFeeAmount)
        .sub(realizedInstantRelayFeeAmount)
        .toString();
      await l1Token.methods
        .approve(bridgePool.options.address, invalidInstantRelayAmountSubFee)
        .send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });
      const startingInstantRelayerAmount = (await l1Token.methods.balanceOf(instantRelayer).call()).toString();

      // User receives invalid instant relay amount.
      assert.equal(
        (await l1Token.methods.balanceOf(depositData.l1Recipient).call()).toString(),
        invalidInstantRelayAmountSubFee
      );

      // Before slow relay expires, it is disputed.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      const proposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent.returnValues.timestamp,
          proposalEvent.returnValues.ancillaryData,
          { ...proposalEvent.returnValues.request, instantRelayer }
        )
        .send({ from: disputer });

      // While dispute is pending resolution, a valid relay is resubmitted. Advance time so that
      // price request data is different.
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      await advanceTime(1);
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: rando });

      // Instant relayer address should be empty for most recent relay with valid params.
      const instantRelayHash = generateInstantRelayHash(depositHash, relayData);
      assert.equal(await bridgePool.methods.instantRelays(instantRelayHash).call(), ZERO_ADDRESS);

      // Can speed up relay with new (valid) params.
      await l1Token.methods.mint(instantRelayer, instantRelayAmountSubFee).send({ from: owner });
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

      // Expire this valid relay and check payouts.
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });
      const secondProposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[1];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          secondProposalEvent.returnValues.timestamp,
          secondProposalEvent.returnValues.ancillaryData,
          { ...secondProposalEvent.returnValues.request, instantRelayer }
        )
        .send({ from: rando });
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // User should receive correct instant relay amount + the amount they received from invalid instant relay.
      assert.equal(
        (await l1Token.methods.balanceOf(depositData.l1Recipient).call()).toString(),
        toBN(instantRelayAmountSubFee).add(toBN(invalidInstantRelayAmountSubFee)).toString()
      );

      // Invalid instant relayer receives a refund from their correct instant relay, but nothing from their first
      // invalid relay that they sped up.
      assert.equal(
        (await l1Token.methods.balanceOf(instantRelayer).call()).toString(),
        toBN(startingInstantRelayerAmount)
          .add(toBN(instantRelayAmountSubFee).add(realizedInstantRelayFeeAmount))
          .toString()
      );

      // Slow relayer gets slow relay reward
      assert.equal(
        (await l1Token.methods.balanceOf(rando).call()).toString(),
        toBN(totalRelayBond).add(realizedSlowRelayFeeAmount).toString()
      );

      // OptimisticOracle should still hold dispute refund since dispute has not resolved yet
      assert.equal(
        (await l1Token.methods.balanceOf(optimisticOracle.options.address).call()).toString(),
        totalDisputeRefund.toString()
      );

      // BridgePool should have balance reduced by full amount sent to to l1Recipient.
      assert.equal(
        (await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(),
        toBN(initialPoolLiquidity)
          .sub(toBN(instantRelayAmountSubFee).add(realizedInstantRelayFeeAmount).add(realizedSlowRelayFeeAmount))
          .toString()
      );
    });
  });
  describe("Dispute pending relay", () => {
    beforeEach(async function () {
      // Add liquidity to the pool
      await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
    });
    it("Can re-relay disputed request", async () => {
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();

      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });
      // Grab OO price request information from Relay struct.
      const relayStatus = await bridgePool.methods.relays(depositHash).call();

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      const proposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      const disputeTxn = await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent.returnValues.timestamp,
          relayAncillaryData,
          proposalEvent.returnValues.request
        )
        .send({ from: disputer });

      // Check for expected events:
      await assertEventEmitted(disputeTxn, optimisticOracle, "DisputePrice", (ev) => {
        return (
          ev.requester === bridgePool.options.address &&
          hexToUtf8(ev.identifier) === hexToUtf8(defaultIdentifier) &&
          ev.timestamp.toString() === relayStatus.priceRequestTime.toString() &&
          ev.ancillaryData === relayAncillaryData &&
          ev.request.proposer === relayer &&
          ev.request.disputer === disputer &&
          ev.request.currency === l1Token.options.address &&
          !ev.request.settled &&
          ev.request.proposedPrice === toWei("1") &&
          ev.request.resolvedPrice === "0" &&
          ev.request.expirationTime === expectedExpirationTimestamp &&
          ev.request.reward === "0" &&
          ev.request.finalFee === finalFee &&
          ev.request.bond === proposalBond.toString() &&
          ev.request.customLiveness === defaultLiveness.toString()
        );
      });

      // Mint relayer new bond to try relaying again:
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });

      // Relaying again with the exact same relay params will succeed because the relay nonce increments.
      // This is possible because the `OO.disputePrice` callback to the BridgePool marks the relay as Disputed,
      // allowing it to be relayed again.
      assert.ok(await bridgePool.methods.relayDeposit(...generateRelayParams()).call({ from: relayer }));
    });
    it("Relay request is disputed, re-relay request expires before dispute resolves", async function () {
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();

      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      const proposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent.returnValues.timestamp,
          relayAncillaryData,
          proposalEvent.returnValues.request
        )
        .send({ from: disputer });

      // Mint relayer new bond to relay again:
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });
      const proposalEvent2 = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[1];

      // Resolve re-relay.
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent2.returnValues.timestamp,
          proposalEvent2.returnValues.ancillaryData,
          proposalEvent2.returnValues.request
        )
        .send({ from: accounts[0] });

      // Settle relay.
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // Now resolve dispute.
      const price = toWei("1");
      const stampedDisputeAncillaryData = await optimisticOracle.methods
        .stampAncillaryData(relayAncillaryData, bridgePool.options.address)
        .call();
      await mockOracle.methods
        .pushPrice(defaultIdentifier, proposalEvent.returnValues.timestamp, stampedDisputeAncillaryData, price)
        .send({ from: owner });
      const disputeEvent = (await optimisticOracle.getPastEvents("DisputePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          disputeEvent.returnValues.timestamp,
          disputeEvent.returnValues.ancillaryData,
          disputeEvent.returnValues.request
        )
        .send({ from: accounts[0] });

      // Should not be able to settle relay again.
      assert(await didContractThrow(bridgePool.methods.settleRelay(depositData).send({ from: rando })));
    });
    it("Relay request is disputed, re-relay request expires after dispute resolves", async function () {
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();

      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      const proposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent.returnValues.timestamp,
          relayAncillaryData,
          proposalEvent.returnValues.request
        )
        .send({ from: disputer });

      // Mint relayer new bond to relay again:
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Resolve dispute.
      const price = toWei("1");
      const stampedDisputeAncillaryData = await optimisticOracle.methods
        .stampAncillaryData(relayAncillaryData, bridgePool.options.address)
        .call();
      await mockOracle.methods
        .pushPrice(defaultIdentifier, proposalEvent.returnValues.timestamp, stampedDisputeAncillaryData, price)
        .send({ from: owner });
      const disputeEvent = (await optimisticOracle.getPastEvents("DisputePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          disputeEvent.returnValues.timestamp,
          disputeEvent.returnValues.ancillaryData,
          disputeEvent.returnValues.request
        )
        .send({ from: accounts[0] });

      // Settle relay.
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // Resolve re-relay.
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });
      const proposalEvent2 = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[1];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent2.returnValues.timestamp,
          proposalEvent2.returnValues.ancillaryData,
          proposalEvent2.returnValues.request
        )
        .send({ from: accounts[0] });

      // Should not be able to settle relay again.
      assert(await didContractThrow(bridgePool.methods.settleRelay(depositData).send({ from: rando })));
    });
    it("Instant relayer address persists for subsequent relays when a pending relay is disputed", async () => {
      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      const proposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent.returnValues.timestamp,
          proposalEvent.returnValues.ancillaryData,
          proposalEvent.returnValues.request
        )
        .send({ from: disputer });

      // Speed up pending relay. It doesn't matter if the relay was disputed or not.
      await l1Token.methods.approve(bridgePool.options.address, slowRelayAmountSubFee).send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

      // Mint another relayer a bond to relay again and check that the instant relayer address is migrated:
      // Advance time so that price request is different.
      await l1Token.methods.mint(rando, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: rando });
      // Cache price request timestamp.
      await advanceTime(1);
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: rando });

      // Check that the instant relayer address persists for the original relay params.
      const newRelayStatus = await bridgePool.methods.relays(depositHash).call();
      assert.equal(newRelayStatus.relayState, InsuredBridgeRelayStateEnum.PENDING);
      assert.equal(newRelayStatus.priceRequestTime.toString(), requestTimestamp);
      assert.equal(newRelayStatus.slowRelayer, rando);
      assert.equal(newRelayStatus.realizedLpFeePct.toString(), defaultRealizedLpFee);
      const instantRelayHash = generateInstantRelayHash(depositHash, relayData);
      assert.equal(await bridgePool.methods.instantRelays(instantRelayHash).call(), instantRelayer);
    });
    it("Only OO can call priceDisputed", async function () {
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      const proposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      assert(
        await didContractThrow(
          bridgePool.methods
            .priceDisputed(
              defaultIdentifier,
              proposalEvent.returnValues.timestamp,
              proposalEvent.returnValues.ancillaryData,
              proposalEvent.returnValues.request
            )
            .send({ from: rando })
        )
      );
    });
  });
  describe("Settle finalized relay", () => {
    beforeEach(async function () {
      // Add liquidity to the pool
      await l1Token.methods.approve(bridgePool.options.address, initialPoolLiquidity).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
    });
    it("Cannot settle successful disputes", async () => {
      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      const proposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent.returnValues.timestamp,
          proposalEvent.returnValues.ancillaryData,
          proposalEvent.returnValues.request
        )
        .send({ from: disputer });

      // Resolve OO request.
      const price = toWei("0");
      const stampedDisputeAncillaryData = await optimisticOracle.methods
        .stampAncillaryData(relayAncillaryData, bridgePool.options.address)
        .call();
      await mockOracle.methods
        .pushPrice(defaultIdentifier, proposalEvent.returnValues.timestamp, stampedDisputeAncillaryData, price)
        .send({ from: owner });
      const disputeEvent = (await optimisticOracle.getPastEvents("DisputePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          disputeEvent.returnValues.timestamp,
          disputeEvent.returnValues.ancillaryData,
          disputeEvent.returnValues.request
        )
        .send({ from: accounts[0] });

      // The OO.settle should have called back into the BridgePool. Since the disputed request resolved to 0, we should
      // not be able to settle the relay.
      assert(await didContractThrow(bridgePool.methods.settleRelay(depositData).send({ from: relayer })));

      // Check payouts since we directly settled with the OO. Disputer should receive full dispute bond back +
      // portion of loser's bond.
      assert.equal(
        (await l1Token.methods.balanceOf(disputer).call()).toString(),
        totalDisputeRefund.toString(),
        "Disputer should receive entire bond back + 1/2 of loser's bond"
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
        "Pool should have initial liquidity amount"
      );
    });
    it("Can settle unsuccessful disputes", async () => {
      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Dispute bond should be equal to proposal bond, and OptimisticOracle needs to be able to pull dispute bond
      // from disputer.
      await l1Token.methods.approve(optimisticOracle.options.address, totalRelayBond).send({ from: disputer });
      const proposalEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .disputePrice(
          bridgePool.options.address,
          defaultIdentifier,
          proposalEvent.returnValues.timestamp,
          proposalEvent.returnValues.ancillaryData,
          proposalEvent.returnValues.request
        )
        .send({ from: disputer });

      // Speed up relay to confirm instant + slow relayer payouts.
      await l1Token.methods.approve(bridgePool.options.address, slowRelayAmountSubFee).send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

      // Resolve Oracle price so that dispute was unsuccessful.
      const price = toWei("1");
      const stampedDisputeAncillaryData = await optimisticOracle.methods
        .stampAncillaryData(relayAncillaryData, bridgePool.options.address)
        .call();
      await mockOracle.methods
        .pushPrice(defaultIdentifier, proposalEvent.returnValues.timestamp, stampedDisputeAncillaryData, price)
        .send({ from: owner });
      const disputeEvent = (await optimisticOracle.getPastEvents("DisputePrice", { fromBlock: 0 }))[0];

      // Cannot settle relay until OO resolves a request.
      assert(await didContractThrow(bridgePool.methods.settleRelay(depositData).send({ from: rando })));
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          disputeEvent.returnValues.timestamp,
          disputeEvent.returnValues.ancillaryData,
          disputeEvent.returnValues.request
        )
        .send({ from: accounts[0] });

      // Settle relay and check event logs and post-settlement balances.
      const relayHash =
        "0x" +
        web3.utils
          .hexToUtf8(await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call())
          .split(":")[1];
      const settleTxn = await bridgePool.methods.settleRelay(depositData).send({ from: rando });
      await assertEventEmitted(settleTxn, bridgePool, "RelaySettled", (ev) => {
        return ev.depositHash === depositHash && ev.relayHash === relayHash && ev.caller === rando;
      });

      // Dispute was unsuccessful and proposer's original price of "1" was correct. Slow relayer should receive full
      // relay bond back + portion of loser's bond + slow relayer fee. Instant relayer should receive full relay amount
      // + instant relayer fee - LP and slow relay fees.
      assert.equal(
        (await l1Token.methods.balanceOf(relayer).call()).toString(),
        totalDisputeRefund.add(realizedSlowRelayFeeAmount).toString(),
        "Slow relayer should receive entire bond back + 1/2 of loser's bond + slow relayer fee"
      );
      assert.equal(
        (await l1Token.methods.balanceOf(instantRelayer).call()).toString(),
        toBN(instantRelayAmountSubFee).add(realizedInstantRelayFeeAmount).toString(),
        "Instant relayer should receive instant relayer fee + relay amount - LP fee"
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
        toBN(initialPoolLiquidity).sub(
          toBN(instantRelayAmountSubFee).add(realizedInstantRelayFeeAmount).add(realizedSlowRelayFeeAmount)
        ),
        "Pool should have initial liquidity amount minus relay amount sub LP fee"
      );
    });
    it("Can settle pending relays that passed challenge period", async () => {
      // Cache price request timestamp.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();

      // Proposer approves pool to withdraw total bond.
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];

      // Cannot settle if there is no price available
      assert.equal(
        await optimisticOracle.methods
          .hasPrice(
            bridgePool.options.address,
            defaultIdentifier,
            proposeEvent.returnValues.timestamp,
            proposeEvent.returnValues.ancillaryData,
            proposeEvent.returnValues.request
          )
          .call(),
        false
      );
      assert(await didContractThrow(bridgePool.methods.settleRelay(depositData).send({ from: relayer })));

      // Set time such that optimistic price request is settleable.
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });

      // Cannot settle relay until OO resolves a request.
      assert.equal(
        await optimisticOracle.methods
          .hasPrice(
            bridgePool.options.address,
            defaultIdentifier,
            proposeEvent.returnValues.timestamp,
            proposeEvent.returnValues.ancillaryData,
            proposeEvent.returnValues.request
          )
          .call(),
        true
      );
      assert(await didContractThrow(bridgePool.methods.settleRelay(depositData).send({ from: rando })));

      // Resolve OO request.
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });

      // Settle relay and check event logs.
      const settleTxn = await bridgePool.methods.settleRelay(depositData).send({ from: rando });
      const relayHash =
        "0x" +
        web3.utils
          .hexToUtf8(await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call())
          .split(":")[1];
      await assertEventEmitted(settleTxn, bridgePool, "RelaySettled", (ev) => {
        return ev.depositHash === depositHash && ev.relayHash === relayHash && ev.caller === rando;
      });

      // Cannot re-settle.
      assert(await didContractThrow(bridgePool.methods.settleRelay(depositData).send({ from: rando })));

      // Check token balances.
      // -Slow relayer should get back their proposal bond from OO and reward from BridgePool.
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

      // - Bridge pool should have the amount original pool liquidity minus the amount sent to l1Recipient and amount
      // sent to slow relayer. This is equivalent to the initial pool liquidity - the relay amount + realized LP fee.
      assert.equal(
        (await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(),
        toBN(initialPoolLiquidity).sub(toBN(relayAmount)).add(realizedLpFeeAmount).toString(),
        "BridgePool should have balance reduced by relay amount less slow fees and rewards"
      );

      // - Recipient should receive the bridged amount minus the slow relay fee and the LP fee.
      assert.equal(
        (await l1Token.methods.balanceOf(l1Recipient).call()).toString(),
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
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Speed up relay.
      await l1Token.methods.approve(bridgePool.options.address, slowRelayAmountSubFee).send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

      // Set time such that optimistic price request is settleable.
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });

      const relayerBalanceBefore = await l1Token.methods.balanceOf(relayer).call();
      const instantRelayerBalanceBefore = await l1Token.methods.balanceOf(instantRelayer).call();

      // Settle OO request.
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });

      // Settle relay.
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // Check token balances.
      // - Slow relayer should get back their proposal bond from OO and reward from BridgePool.
      // - Fast relayer should get reward from BridgePool and the relayed amount, minus LP and slow relay fee. This
      // is equivalent to what the l1Recipient received + the instant relayer fee.
      assert.equal(
        toBN(await l1Token.methods.balanceOf(relayer).call())
          .sub(toBN(relayerBalanceBefore))
          .toString(),
        toBN(totalRelayBond).add(realizedSlowRelayFeeAmount).toString(),
        "Slow relayer should receive proposal bond + slow relay reward"
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
        "BridgePool should have balance reduced by relayed amount to l1Recipient"
      );
    });
    it("Only OO can call priceSettled", async function () {
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      assert(
        await didContractThrow(
          bridgePool.methods
            .priceSettled(
              defaultIdentifier,
              proposeEvent.returnValues.timestamp,
              proposeEvent.returnValues.ancillaryData,
              proposeEvent.returnValues.request
            )
            .send({ from: rando })
        )
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
    it("Withdraw liquidity is blocked when utilization is too high", async () => {
      // Approve funds and add to liquidity.
      await l1Token.methods.approve(bridgePool.options.address, MAX_UINT_VAL).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });

      // Initiate a relay. The relay amount is 10% of the total pool liquidity.
      await l1Token.methods.approve(bridgePool.options.address, MAX_UINT_VAL).send({ from: relayer });
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });
      assert.equal(await bridgePool.methods.pendingReserves().call(), depositData.amount);

      // If the LP tries to pull out anything more than 90% of the pool funds this should revert. The 10% of the funds
      // are allocated for the deposit and the contract should prevent any additional amount over this from being removed.
      assert(
        await didContractThrow(
          bridgePool.methods
            .removeLiquidity(
              toBN(initialPoolLiquidity)
                .mul(toBN(toWei("0.90"))) // try withdrawing 95%. should fail
                .div(toBN(toWei("1")))
                .addn(1) // 90% + 1 we
                .toString()
            )
            .send({ from: liquidityProvider })
        )
      );

      // Should be able to withdraw 90% exactly, leaving the exact amount of liquidity in the pool to finalize the relay.
      await bridgePool.methods
        .removeLiquidity(
          toBN(initialPoolLiquidity)
            .mul(toBN(toWei("0.9"))) // try withdrawing 95%. should fail
            .div(toBN(toWei("1")))
            .toString()
        )
        .send({ from: liquidityProvider });

      // As we've removed all free liquidity the liquid reserves should now be zero.
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando });

      // Next, finalize the bridging action. This should reset the pendingReserves to 0 and increment the utilizedReserves.
      // Expire and settle proposal on the OptimisticOracle.
      await timer.methods
        .setCurrentTime(Number(await bridgePool.methods.getCurrentTime().call()) + defaultLiveness)
        .send({ from: owner });
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // Check the balances have updated correctly. Pending should be 0 (funds are actually utilized now), liquid should
      // be equal to the LP fee of 10 and the utilized should equal the total bridged amount (100).
      assert.equal(await bridgePool.methods.pendingReserves().call(), "0");
      assert.equal(await bridgePool.methods.liquidReserves().call(), toWei("10"));
      assert.equal(await bridgePool.methods.utilizedReserves().call(), depositData.amount);

      // The LP should be able to withdraw exactly 10 tokens (they still have 100 tokens in the contract). Anything
      // more than this is not possible as the remaining funds are in transit from L2.
      assert(
        await didContractThrow(
          bridgePool.methods.removeLiquidity(toBN(toWei("10")).addn(1).toString()).send({ from: liquidityProvider })
        )
      );
      await bridgePool.methods.removeLiquidity(toWei("10")).send({ from: liquidityProvider });

      assert.equal(await bridgePool.methods.pendingReserves().call(), "0");
      assert.equal(await bridgePool.methods.liquidReserves().call(), "0");
      assert.equal(await bridgePool.methods.utilizedReserves().call(), depositData.amount);
    });
  });
  describe("Virtual balance accounting", () => {
    beforeEach(async function () {
      // For the next few tests, add liquidity, relay and finalize the relay as the initial state.

      // Approve funds and add to liquidity.
      await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, MAX_UINT_VAL).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });

      // Mint relayer bond.
      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });

      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();

      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Expire and settle proposal on the OptimisticOracle.
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });

      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });
    });
    it("SettleRelay modifies virtual balances", async () => {
      // Exchange rate should still be 1, no fees accumulated yet as no time has passed from the settlement. Pool
      // balance, liquidReserves and utilizedReserves should update accordingly. Calculate the bridge tokens used as
      // the amount sent to the receiver+the bond.
      const bridgeTokensUsed = toBN(slowRelayAmountSubFee).add(realizedSlowRelayFeeAmount);

      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));
      assert.equal(
        (await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(),
        toBN(initialPoolLiquidity).sub(bridgeTokensUsed).toString()
      );
      assert.equal((await lpToken.methods.balanceOf(liquidityProvider).call()).toString(), initialPoolLiquidity);
      assert.equal(
        (await bridgePool.methods.liquidReserves().call()).toString(),
        toBN(initialPoolLiquidity).sub(bridgeTokensUsed).toString()
      );
      assert.equal(
        (await bridgePool.methods.utilizedReserves().call()).toString(),
        bridgeTokensUsed.add(realizedLpFeeAmount).toString()
      );
    });
    it("Fees correctly accumulate to LPs over the one week loan interval", async () => {
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando }); // force sync

      // As no time has elapsed, no fees should be earned and the exchange rate should still be 1.
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Advance time by a 2 days (172800s) and check that the exchange rate increments accordingly. From the bridging
      // action 10 L1 tokens have been allocated for fees (defaultRealizedLpFee and the relayAmount is 100). At a rate
      // of lpFeeRatePerSecond set to 0.0000015, the expected fee allocation should be rate_per_second *
      // seconds_since_last_action* undistributed_fees: 0.0000015*172800*10=2.592. Expected exchange rate is
      // (liquidReserves+utilizedReserves+cumulativeFeesUnbridged-undistributedLpFees)/totalLpTokenSupply
      // =(910+90+10-7.408)/1000=1.002592.
      await advanceTime(172800);

      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.002592"));

      // If we now call exchangeRateCurrent the fee state variables should increment to the expected size.
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando }); // force sync
      // undistributedLpFees should be the total fees (10) minus the cumulative fees.
      assert.equal((await bridgePool.methods.undistributedLpFees().call()).toString(), toWei("7.408")); // 10-2.592
      // Last LP fee update should be the current time.
      assert.equal(
        await (await bridgePool.methods.lastLpFeeUpdate().call()).toString(),
        (await timer.methods.getCurrentTime().call()).toString()
      );

      // Next, To simulate finalization of L2->L1 token transfers due to bridging (via the canonical bridge) send tokens
      // directly to the bridgePool. Note that on L1 this is exactly how this will happen as the finalization of bridging
      // occurs without informing the l1Recipient (tokens are just "sent"). Validate the sync method updates correctly.
      // Also increment time such that we are past the 1 week liveness from OO. increment by 5 days (432000s).
      await advanceTime(432000);

      // At this point it is useful to verify that the exchange rate right before the tokens hit the contract is equal
      // to the rate right after they hit the contract, without incrementing any time. This proves the exchangeRate
      // equation has no discontinuity in it and that fees are correctly captured when syncing the pool balance.
      // accumulated fees should be updated accordingly. a total of 1 week has passed at a rate of 0.0000015. Total
      // expected cumulative LP fees earned of 2.592+7.408* 4 32000*0.0000015=7.392384
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando }); // force sync

      // expected exchange rate of (910+90+10-(10-7.392384))/1000=1.007392384
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.007392384"));

      // Now, we can mint the tokens to the bridge pool. When we call exchangeRateCurrent again it will first sync the
      // token balances, thereby updating the variables to: • liquidReserves=1010 (initial liquidity+LP fees)
      // • utilizedReserves=0 (-10 from sync +10 from LP fees)• cumulativeFeesUnbridged =0 (all fees moved over).
      // • undistributedLpFees=10-7.392384=2.607616 (unchanged from before as no time has elapsed)
      // overall expected exchange rate should be the SAME as (1010+0+0-(10-7.392384))/1000
      await l1Token.methods.mint(bridgePool.options.address, relayAmount).send({ from: owner });
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando }); // force sync
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.007392384"));
      // We can check all other variables to validate the match to the above comment.
      assert.equal((await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(), toWei("1010"));
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("1010"));
      assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), "0");
      assert.equal((await bridgePool.methods.undistributedLpFees().call()).toString(), toWei("2.607616"));
    });
    it("Fees correctly accumulate with multiple relays", async () => {
      // Advance time by a 2 days (172800s) and check that the exchange rate increments accordingly. Expected exchange rate is (910+90+10-(10-0.0000015*172800*10))/1000=1.002592.
      await advanceTime(172800);

      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.002592"));

      // Next, bridge another relay. This time for 50 L1 tokens. Keep the fee percentages at the same size: 10% LP fee
      // 1% slow and 1% instant relay fees. Update the existing data structures to simplify the process.
      depositData.depositId = depositData.depositId + 1;
      depositData.amount = toWei("50");
      depositData.l1Recipient = rando;
      depositData.quoteTimestamp = depositData.quoteTimestamp + 172800;

      await l1Token.methods.mint(relayer, totalRelayBond).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond).send({ from: relayer });

      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      depositHash = generateDepositHash(depositData);

      // Expire and settle proposal on the OptimisticOracle.
      await advanceTime(defaultLiveness);

      relayAncillaryData = await bridgePool.methods.getRelayAncillaryData(depositData, relayData).call();

      // Settle the relay action.
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[1];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // Double check the rando balance incremented by the expected amount of: 50-5 (LP fee)-0.5 (slow relay fee).
      assert.equal((await l1Token.methods.balanceOf(rando).call()).toString(), toWei("44.5"));

      // The exchanger rate should have been increased by the initial deposits fees grown over defaultLiveness. As the
      // second deposit happened after this time increment, no new fees should be accumulated at this point for these
      // funds. Expected exchange rate is: (865.5+134.5+15-(15-0.0000015*(172800+100)*10+0))/1000=1.0025935
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.0025935"));

      // Advance time by another 2 days and check that rate updates accordingly to capture the generated.
      await advanceTime(172800);

      // Expected exchange rate at this point is easiest to reason about if we consider the two deposits separately.
      // Deposit1 was 10 tokens of fees, grown over 4 days+100 seconds. Deposit2 was 5 tokens fees, grown over 2 days.
      // Deposit1's first period was 0.0000015*(172800+100)*10=2.5935. This leaves 10-2.5935=7.4065 remaining.
      // Deposit1's second period is therefore 0.0000015*(172800)*7.4065=1.9197648. Total accumulated for Deposit1
      // =2.5935+1.9197648=4.5132648. Deposit2 is just 0.0000015*(172800)*5=1.296. Total accumulated fees for
      // both deposits is therefore 4.5132648+1.296=5.8092648. We can compute the expected exchange rate using a
      // simplified form of (total LP Deposits+accumulated fees)/totalSupply (this form is equivalent to the contracts
      // but is easier to reason about as it ignores any bridging actions) giving us (1000+5.8092648)/1000=1.0058092648
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.0058092648"));

      // Next, advance time past the finalization of the first deposits L2->L1 bridge time by plus 3 days (259200s).
      await advanceTime(259200);
      await l1Token.methods.mint(bridgePool.options.address, relayAmount).send({ from: owner });

      // Expected exchange rate can be calculated with the same modified format as before Deposit1's second period is
      // now 0.0000015*(172800+259200)*7.4065=4.799412 and Deposit2 is 0.0000015*(172800+259200)*5=3.24. Cumulative fees
      // are 2.5935+4.799412+3.24=10.632912 Therefore expected exchange rate is (1000+10.632912)/1000=1.010632912
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando }); // force sync
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.010632912"));

      // balance is 1000 initial liquidity - 90 bridged for Deposit1, -45 bridged for Deposit2 +100 for
      // finalization of Deposit1=1000-90-45+100=965
      assert.equal((await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(), toWei("965"));
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("965"));
      // utilizedReserves is 90 for Deposit1 45 for Deposit2 -100 for finalization of Deposit1. utilizedReserves also
      // contains the implicit LP fees so that's 10 for Deposit1 and 5 for Deposit2=90+45-100+10+5=50
      assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), toWei("50"));
      // undistributedLpFees is 10+5 for the deposits - 10.632912 (the total paid thus far)=10+5-10.632912=4.367088
      assert.equal((await bridgePool.methods.undistributedLpFees().call()).toString(), toWei("4.367088"));

      // Advance time another 2 days and finalize the Deposit2.
      // Next, advance time past the finalization of the first deposits L2->L1 bridge time by plus 3 days (259200s).
      await advanceTime(172800);
      await l1Token.methods.mint(bridgePool.options.address, depositData.amount).send({ from: owner });

      // Expected exchange rate is now Deposit1's second period is now 0.0000015*(172800)*(7.4065-4.799412)=0.6757572096
      // and Deposit2 is 0.0000015*(172800)*(5-3.24)=0.456192. Cumulative fees are 10.632912+0.6757572096+0.456192=
      // 11.7648612096 Therefore expected exchange rate is (1000+11.7648612096)/1000=1.0117648612096
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando }); // force sync
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.0117648612096"));
      // Token balance should be 1000 initial liquidity - 90 bridged for Deposit1, -45 bridged for Deposit2+100 for
      // finalization of Deposit1+50 for finalization of Deposit2 = 1000-90-45+100+50=965. This is equivalent to the
      // original liquidity+the total LP fees (1000+10+5).
      assert.equal((await l1Token.methods.balanceOf(bridgePool.options.address).call()).toString(), toWei("1015"));
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("1015"));
      // utilizedReserves is 90 for Deposit1 45 for Deposit2 -100 -50 for finalization of deposits=90+45-100-50=-15
      // assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), toWei("-15"));
      // undistributedLpFees is 10+5 for the deposits - 11.7648612096 (the total paid thus far)=10+5-11.7648612096=3.2351387904
      assert.equal((await bridgePool.methods.undistributedLpFees().call()).toString(), toWei("3.2351387904"));

      // Finally, advance time by a lot into the future (100 days). All remaining fees should be paid out. Exchange rate
      // should simply be (1000+10+5)/1000=1.015 for the culmination of the remaining fees.
      await advanceTime(8640000);
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando }); // force sync
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.015"));
      // All fees have been distributed. 0 remaining fees.
      assert.equal((await bridgePool.methods.undistributedLpFees().call()).toString(), toWei("0"));
    });
    it("Adding/removing impact exchange rate accumulation as expected", async () => {
      // Advance time by a 2 days (172800s). Exchange rate should be (1000+10*172800*0.0000015)/1000=1.002592
      await advanceTime(172800);
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.002592"));

      // Now, remove the equivalent of 100 units of LP Tokens. This method takes in the number of LP tokens so we will
      // end up withdrawing slightly more than the number of LP tokens as the number of LP tokens * the exchange rate.
      await bridgePool.methods.removeLiquidity(toWei("100")).send({ from: liquidityProvider });
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.002592"));

      // The internal counts should have updated as expected.
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando }); // force sync
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("809.7408")); // 1000-90-100*1.002592
      // utilizedReserves have 90 for the bridging action and 10 for the pending LP fees[unchanged]
      assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), toWei("100"));
      assert.equal((await bridgePool.methods.undistributedLpFees().call()).toString(), toWei("7.408")); // 10-10*172800*0.0000015

      // Advance time by 2 days to accumulate more fees. As a result of that decrease number of liquid+utilized reserves,
      // the exchange rate should increment faster. Exchange rate is calculated using the equation ExchangeRate :=
      // (liquidReserves+utilizedReserves+cumulativeLpFeesEarned-undistributedLpFees)/lpTokenSupply. undistributedLpFees
      // is found as the total fees to earn, minus the sum of period1's fees earned and the second period's fees. The
      // first period is 10*172800*0.0000015=2.592. The second period is the remaining after the first, with fees applied
      // as (10-2.592)*172800*0.0000015=1.9201536. Total fees paid are 2.592+1.9201536=4.5121536. Therefore, undistributedLpFees= 10-4.5121536=5.4878464. Exchange rate is therefore (809.7408+90+10-5.4878464)/900=1.004725504
      await advanceTime(172800);
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.004725504"));

      // Next, advance time past the conclusion of this deposit (+5 days) and mint tokens to the contract.
      await advanceTime(432000);
      await l1Token.methods.mint(bridgePool.options.address, toWei("100")).send({ from: owner });

      // Recalculate the exchange rate. As we did not force sync at the previous step we can just extent the period2
      // accumulated fees as (10-2.592)*(172800+432000)*0.0000015=6.7205376. Cumulative fees are therefore
      // 2.592+6.7205376=9.3125376. Hence, undistributedLpFees=10-9.3125376=0.6874624. Exchange rate is thus
      // (809.7408+90+10-0.6874624)/900=1.010059264
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.010059264"));

      // Finally, increment time such that the remaining fees are attributed (say 100 days). Expected exchange rate is
      // simply the previous equation with the undistributedLpFees set to 0. Exchange rate will be
      // (809.7408+90+10-0)/900=1.010823111111111111
      await advanceTime(8640000);
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.010823111111111111"));
    });
    it("Fees & Exchange rate can correctly handel gifted tokens", async () => {
      // We cant control when funds are sent to the contract, just like we cant control when the bridging action
      // concludes. If someone was to randomly send the contract tokens the exchange rate should ignore this. The
      // contract should ignore the exchange rate if someone was to randomly send tokens.

      // Advance time by a 2 days (172800s). Exchange rate should be (1000+10*172800*0.0000015)/1000=1.002592
      await advanceTime(172800);
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.002592"));

      // Now, randomly send the contract 10 tokens. This is not part of the conclusion of any bridging action. The
      // exchange rate should not be modified at all.
      await l1Token.methods.mint(bridgePool.options.address, toWei("10")).send({ from: owner });
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.002592"));

      // However, the internal counts should have updated as expected.
      await bridgePool.methods.exchangeRateCurrent().send({ from: rando }); // force sync
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("920")); // 1000-90+10
      // utilizedReserves are 90 for the bridging action, -10 for the tokens sent to the bridge +10 for the pending LP fees.
      assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), toWei("90")); // 90-10+10
      assert.equal((await bridgePool.methods.undistributedLpFees().call()).toString(), toWei("7.408")); // 10-10*172800*0.0000015

      // Advance time by 100 days to accumulate the remaining fees. Exchange rate should accumulate accordingly to
      // (1000+10)/1000=1.01
      await advanceTime(8640000);
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.01"));

      // Sending more tokens does not modify the rate.
      await l1Token.methods.mint(bridgePool.options.address, toWei("100")).send({ from: owner });
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.01"));
    });
  });
  describe("Liquidity utilization rato", () => {
    beforeEach(async function () {
      // Approve funds and add to liquidity.
      await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, MAX_UINT_VAL).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });

      // Mint relayer bond.
      await l1Token.methods.mint(relayer, totalRelayBond.muln(10)).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond.muln(10)).send({ from: relayer });
    });
    it("Rate updates as expected in slow relay", async () => {
      // Before any relays (nothing in flight and none finalized) the rate should be 0 (no utilization).
      assert.equal((await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(), toWei("0"));

      // liquidityUtilizationPostRelay of the relay size should correctly factor in the relay.
      assert.equal(
        (await bridgePool.methods.liquidityUtilizationPostRelay(relayAmount).call()).toString(),
        toWei("0.1")
      );

      // Next, relay the deposit and check the utilization updates.
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // The relay amount is set to 10% of the pool liquidity. As a result, the post relay utilization should be 10%.
      assert.equal((await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(), toWei("0.1"));

      // Advance time and settle the relay. This will send  funds from the bridge pool to the recipient and slow relayer.
      // After this action, the utilized reserves should increase. The conclusion of the bridging action pays the slow
      // relayer their reward of 1% and the recipient their bridged amount of 89% of the 100 bridged (100%-1%-10%).
      // As a result, the pool should have it's initial balance, minus recipient amount, minus slow relayer reward.
      // i.e 1000-1-89=910. As a result, the utalized reserves should be at 100 and the liquid reserves should be 910.
      // With this, the pool liquidity utilization should be equal to 100/910=0.109890109890109890

      // Settle the relay action.
      await advanceTime(defaultLiveness);
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      // Validate the balances and utilized ratio match to the above comment.
      assert.equal((await bridgePool.methods.pendingReserves().call()).toString(), toWei("0"));
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("910"));
      assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), toWei("100"));
      assert.equal((await l1Token.methods.balanceOf(l1Recipient).call()).toString(), toWei("89"));
      assert.equal(
        (await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(),
        toWei("0.109890109890109890")
      );

      // Mimic the finilization of the bridging action over the canonical bridge by minting tokens to the bridgepool.
      // This should bring the bridge pool balance up to 1010 (the initial 1000 + 10% LP reward from bridging action).
      // The utilization ratio should go back down to 0 at this point.
      await l1Token.methods.mint(bridgePool.options.address, relayAmount).send({ from: owner });

      assert.equal((await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(), toWei("0"));
    });

    it("Rate updates as expected with multiple relays and instant relay", async () => {
      // Before any relays (nothing in flight and none finalized) the rate should be 0 (no utilization).
      assert.equal((await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(), toWei("0"));

      // Next, relay the deposit and check the utilization updates.
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // The relay amount is set to 10% of the pool liquidity. As a result, the post relay utilization should be 10%.
      assert.equal((await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(), toWei("0.1"));

      // Send another relay. This time make the amount bigger (150 tokens). The utilization should be (100+150)/1000= 25%.

      // First, check the liquidityUtilizationPostRelay of the relay size returns expected value.
      assert.equal(
        (await bridgePool.methods.liquidityUtilizationPostRelay(toWei("150")).call()).toString(),
        toWei("0.25")
      );
      await bridgePool.methods
        .relayDeposit(...generateRelayParams({ depositId: 1, amount: toWei("150") }))
        .send({ from: relayer });

      assert.equal((await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(), toWei("0.25"));

      // Speed up the first relay. This should not modify the utilization ratio as no pool funds are used until finalization.
      await l1Token.methods
        .approve(bridgePool.options.address, instantRelayAmountSubFee)
        .send({ from: instantRelayer });
      await bridgePool.methods.speedUpRelay(depositData).send({ from: instantRelayer });

      assert.equal((await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(), toWei("0.25"));

      // Advance time and settle the first relay. After this, the liquid reserves should be decremented by the bridged
      // amount + the LP fees (to 910, same as in the first test). The pending reserves should be 150, from the second
      // bridging action. The utilized reserves should be 100 for the funds in flight from the first bridging action.
      // The recipient token balance should be the initial amount, - 1%  slow relay, - 1%  fast relay - 10% lp fee.
      // The utilization ratio should, therefore, be: (150+100)/910=0.274725274725274725
      await advanceTime(defaultLiveness);
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });

      assert.equal((await bridgePool.methods.pendingReserves().call()).toString(), toWei("150"));
      assert.equal((await bridgePool.methods.liquidReserves().call()).toString(), toWei("910"));
      assert.equal((await bridgePool.methods.utilizedReserves().call()).toString(), toWei("100"));
      assert.equal((await l1Token.methods.balanceOf(l1Recipient).call()).toString(), toWei("88"));
      assert.equal(
        (await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(),
        toWei("0.274725274725274725")
      );

      // Finally, mimic the finalization of the first relay by minting tokens to the pool. After this action, the pool
      // will gain 100 tokens from the first deposit. At this point the pendingReserves should be 150 (as before), liquid
      // reserves are now 1010 and utilized reserves are set to 0. The utilization ratio is: (150+0)/1010=0.148514851485148514
      await l1Token.methods.mint(bridgePool.options.address, relayAmount).send({ from: owner });
      assert.equal(
        (await bridgePool.methods.liquidityUtilizationCurrent().call()).toString(),
        toWei("0.148514851485148514")
      );
    });
  });
  describe("Canonical bridge finalizing before insured bridge settlement edge cases", () => {
    beforeEach(async function () {
      await l1Token.methods.mint(liquidityProvider, initialPoolLiquidity).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, MAX_UINT_VAL).send({ from: liquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: liquidityProvider });
      await l1Token.methods.mint(relayer, totalRelayBond.muln(100)).send({ from: owner });
      await l1Token.methods.approve(bridgePool.options.address, totalRelayBond.muln(100)).send({ from: relayer });
    });
    it("Exchange rate correctly handles the canonical bridge finalizing before insured relayer begins", async () => {
      // Consider the edge case where a user deposits on L2 and no actions happen on L1. This might be due to their
      // deposit fees being under priced (not picked up by a relayer). After a week their funds arrive on L1 via the
      // canonical bridge. At this point, the transfer is relayed. The exchange rate should correctly deal with this
      // without introducing a step in the rate at any point.

      // Advance time by 1 week past the end of the of the L2->L1 liveness period.
      await advanceTime(604800);
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Now, simulate the finalization of of the bridge action by the canonical bridge by minting tokens to the pool.
      await l1Token.methods.mint(bridgePool.options.address, toWei("100")).send({ from: owner });

      // The exchange rate should not have updated.
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Only now that the bridging action has concluded through the canonical bridge does a relayer pick up the
      // transfer. This could also have been the depositor self relaying.
      const requestTimestamp = (await bridgePool.methods.getCurrentTime().call()).toString();
      const expectedExpirationTimestamp = (Number(requestTimestamp) + defaultLiveness).toString();
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // Expire and settle proposal on the OptimisticOracle.
      await timer.methods.setCurrentTime(expectedExpirationTimestamp).send({ from: owner });
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Going forward, the rate should increment as normal, starting from the settlement of the relay. EG advancing time
      // by 2 days(172800s) which should increase the rate accordingly (910+90+10-(10-0.0000015*172800*10))/1000=1.002592.
      await advanceTime(172800);
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.002592"));
    });
    it("Exchange rate correctly handles the canonical bridge finalizing before insured relayer finalizes(slow)", async () => {
      // Similar to the previous edge case test, consider a case where a user deposit on L2 and the L1 action is only
      // half completed (not finalized). This test validates this in the slow case.
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });

      // The exchange rate should still be 0 as no funds are actually "used" until the relay concludes.
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Advance time by 1 week past the end of the of the L2->L1 liveness period.
      await advanceTime(604800);
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Now, simulate the finalization of of the bridge action by the canonical bridge by minting tokens to the pool.
      await l1Token.methods.mint(bridgePool.options.address, toWei("100")).send({ from: owner });

      // The exchange rate should not have updated.
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Only now that the bridging action has concluded do we finalize the relay action.
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Going forward, the rate should increment as normal, starting from the settlement of the relay. EG advancing time
      // by 2 days(172800s) which should increase the rate accordingly (910+90+10-(10-0.0000015*172800*10))/1000=1.002592.
      await advanceTime(172800);
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.002592"));
    });
    it("Exchange rate correctly handles the canonical bridge finalizing before insured relayer finalizes(instant)", async () => {
      // Finally, consider the same case as before except speed up the relay. The behaviour should be the same as the
      // previous test (no rate change until the settlement of the relay and ignore tokens sent "early").
      await bridgePool.methods.relayDeposit(...generateRelayParams()).send({ from: relayer });
      await bridgePool.methods.speedUpRelay(depositData).call({ from: relayer });

      // The exchange rate should still be 0 as no funds are actually "used" until the relay concludes.
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Advance time by 1 week past the end of the of the L2->L1 liveness period.
      await advanceTime(604800);
      const proposeEvent = (await optimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 }))[0];
      await optimisticOracle.methods
        .settle(
          bridgePool.options.address,
          defaultIdentifier,
          proposeEvent.returnValues.timestamp,
          proposeEvent.returnValues.ancillaryData,
          proposeEvent.returnValues.request
        )
        .send({ from: accounts[0] });
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Now, simulate the finalization of of the bridge action by the canonical bridge by minting tokens to the pool.
      await l1Token.methods.mint(bridgePool.options.address, toWei("100")).send({ from: owner });

      // The exchange rate should not have updated.
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Only now that the bridging action has concluded do we finalize the relay action.
      await bridgePool.methods.settleRelay(depositData).send({ from: rando });
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1"));

      // Going forward, the rate should increment as normal, starting from the settlement of the relay. EG advancing time
      // by 2 days(172800s) which should increase the rate accordingly (910+90+10-(10-0.0000015*172800*10))/1000=1.002592.
      await advanceTime(172800);
      assert.equal((await bridgePool.methods.exchangeRateCurrent().call()).toString(), toWei("1.002592"));
    });
  });
});
