const hre = require("hardhat");
const { web3 } = require("hardhat");
const { predeploys } = require("@eth-optimism/contracts");

const { getContract } = hre;

const winston = require("winston");

const { toWei } = web3.utils;

const { assert } = require("chai");

const { deployOptimismContractMock } = require("../../../core/test/insured-bridge/helpers/SmockitHelper");

// Client to test
const { InsuredBridgeL2Client } = require("../../dist/clients/InsuredBridgeL2Client");

// Helper contracts
const BridgeDepositBox = getContract("OVM_BridgeDepositBox");
const Token = getContract("ExpandedERC20");
const Timer = getContract("OVM_Timer");

// Contract objects
let depositBox, l2CrossDomainMessengerMock, l1TokenAddress, l2Token, timer, client;

// As these tests are in the context of l2, we dont have the deployed notion of a "L1 Token". The L1 token is within
// another domain (L1). To represent this, we can generate a random address to represent the L1 token.
l1TokenAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const depositAmount = toWei("50");
const slowRelayFeePct = toWei("0.005");
const instantRelayFeePct = toWei("0.005");
const quoteTimestampOffset = 60; // 60 seconds into the past.

describe("InsuredBridgeL2Client", () => {
  const generateDepositHash = (depositData) => {
    const depositDataAbiEncoded = web3.eth.abi.encodeParameters(
      ["uint64", "uint64", "address", "address", "address", "uint256", "uint64", "uint64", "uint64"],
      [
        depositData.depositId,
        depositData.depositTimestamp,
        depositData.l1Recipient,
        depositData.l2Sender,
        depositData.l1Token,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
      ]
    );
    return web3.utils.soliditySha3(depositDataAbiEncoded);
  };

  // Account objects
  let accounts, deployer, user1, user2, bridgeAdmin, bridgePool;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, user1, user2, bridgeAdmin, bridgePool] = accounts;

    timer = await Timer.new().send({ from: deployer });
  });

  beforeEach(async function () {
    // Initialize the cross domain massager messenger mock at the address of the OVM pre-deploy. The OVM will always use
    // this address for L1<->L2 messaging. Seed this address with some funds so it can send transactions.
    l2CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L2CrossDomainMessenger", {
      address: predeploys.OVM_L2CrossDomainMessenger,
    });
    await web3.eth.sendTransaction({ from: deployer, to: predeploys.OVM_L2CrossDomainMessenger, value: toWei("1") });

    depositBox = await BridgeDepositBox.new(bridgeAdmin, minimumBridgingDelay, timer.options.address).send({
      from: deployer,
    });

    l2Token = await Token.new("L2 Wrapped Ether", "WETH", 18).send({ from: deployer });
    await l2Token.methods.addMember(1, deployer).send({ from: deployer });

    // Whitelist the token in the deposit box.
    l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin);
    await depositBox.methods
      .whitelistToken(l1TokenAddress, l2Token.options.address, bridgePool)
      .send({ from: predeploys.OVM_L2CrossDomainMessenger });

    // The InsuredBridgeL2Client does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    client = new InsuredBridgeL2Client(dummyLogger, web3, depositBox.options.address);
  });

  it("Correctly returns deposit event information", async () => {
    // Before adding any data should return nothing when updating.

    await client.update();
    assert.equal(JSON.stringify(client.getAllDeposits()), JSON.stringify([]));

    // Deposit some tokens. Check the client picks it up accordingly.
    await l2Token.methods.mint(user1, toWei("200")).send({ from: deployer });
    await l2Token.methods.approve(depositBox.options.address, toWei("200")).send({ from: user1 });
    const depositTimestamp = Number(await timer.methods.getCurrentTime().call());
    const quoteTimestamp = depositTimestamp + quoteTimestampOffset;
    await depositBox.methods
      .deposit(user1, l2Token.options.address, depositAmount, slowRelayFeePct, instantRelayFeePct, quoteTimestamp)
      .send({ from: user1 });

    await client.update();

    let expectedDeposits = [
      {
        depositId: 0,
        depositHash: "",
        depositTimestamp,
        l1Recipient: user1,
        l2Sender: user1,
        l1Token: l1TokenAddress,
        amount: depositAmount,
        slowRelayFeePct,
        instantRelayFeePct,
        quoteTimestamp,
      },
    ];
    expectedDeposits[0].depositHash = generateDepositHash(expectedDeposits[0]);
    assert.equal(JSON.stringify(client.getAllDeposits()), JSON.stringify(expectedDeposits));

    // Updating again should not re-index the same deposit
    await client.update();
    assert.equal(JSON.stringify(client.getAllDeposits()), JSON.stringify(expectedDeposits));

    // Deposit again. This time set the recipient to user2. Client should update accordingly.
    await timer.methods
      .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + 20)
      .send({ from: deployer });
    const depositTimestamp2 = Number(await timer.methods.getCurrentTime().call());
    const quoteTimestamp2 = depositTimestamp2 + quoteTimestampOffset;

    await depositBox.methods
      .deposit(user2, l2Token.options.address, depositAmount, slowRelayFeePct, instantRelayFeePct, quoteTimestamp2)
      .send({ from: user1 });

    await client.update();
    expectedDeposits.push({
      depositId: 1, // ID should increment, as expected.
      depositHash: "",
      depositTimestamp: depositTimestamp2,
      l1Recipient: user2,
      l2Sender: user1,
      l1Token: l1TokenAddress,
      amount: depositAmount,
      slowRelayFeePct,
      instantRelayFeePct,
      quoteTimestamp: quoteTimestamp2,
    });
    expectedDeposits[1].depositHash = generateDepositHash(expectedDeposits[1]);
    assert.equal(JSON.stringify(client.getAllDeposits()), JSON.stringify(expectedDeposits));
  });
});

[
  {
    depositId: 0,
    depositHash: "0x0866d3a3c76fdab5ba4d7a60fd47e94d409a0c3aeef1f8c531058648d457f27e",
    depositTimestamp: 1631549290,
    l2Sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    l1Recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    l1Token: "0xAEcD71E5859dE755268bbA6f240Dd1201c52D4DC",
    amount: "50000000000000000000",
    slowRelayFeePct: "5000000000000000",
    instantRelayFeePct: "5000000000000000",
    quoteTimestamp: 1631549350,
  },
  {
    depositId: 1,
    depositHash: "0xec70590dbe5337614d3c6286ad1bfac1692c4db3d3cd63ebca652f4caff59095",
    depositTimestamp: 1631549310,
    l2Sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    l1Recipient: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    l1Token: "0xAEcD71E5859dE755268bbA6f240Dd1201c52D4DC",
    amount: "50000000000000000000",
    slowRelayFeePct: "5000000000000000",
    instantRelayFeePct: "5000000000000000",
    quoteTimestamp: 1631549370,
  },
] +
  [
    {
      depositId: 0,
      depositHash: "0x0866d3a3c76fdab5ba4d7a60fd47e94d409a0c3aeef1f8c531058648d457f27e",
      depositTimestamp: 1631549290,
      l2Sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      l1Recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      l1Token: "0xAEcD71E5859dE755268bbA6f240Dd1201c52D4DC",
      amount: "50000000000000000000",
      slowRelayFeePct: "5000000000000000",
      instantRelayFeePct: "5000000000000000",
      quoteTimestamp: 1631549350,
    },
    {
      depositId: 1,
      depositHash: "0x9955534fcffc2d8aa5817cb814da5533dde12fedf74f4d28fd06d69f6ae7d8ea",
      depositTimestamp: 1631549310,
      l2Sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      l1Recipient: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      l1Token: "0xAEcD71E5859dE755268bbA6f240Dd1201c52D4DC",
      amount: "50000000000000000000",
      slowRelayFeePct: "5000000000000000",
      instantRelayFeePct: "5000000000000000",
      quoteTimestamp: 1631549370,
    },
  ];
