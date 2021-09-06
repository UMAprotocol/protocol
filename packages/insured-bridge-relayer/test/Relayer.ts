import { SpyTransport } from "@uma/financial-templates-lib";
const { predeploys } = require("@eth-optimism/contracts");
import winston from "winston";
import sinon from "sinon";
import hre from "hardhat";
import Web3 from "web3";

import { interfaceName, TokenRolesEnum, HRE } from "@uma/common";

const { web3, getContract } = hre as HRE;
const { toWei, utf8ToHex } = web3.utils;

// Use Ganache to create additional web3 providers with different chain ID's. This is a work around to prevent us
// needing to spin up a whole new set of testing environments to mock L2 contracts calls. Note that we ideally would use
// smockit but smockit at present does not support mocking events emitted from contracts.
const ganache = require("ganache-core");

const { deployOptimismContractMock } = require("../../core/test/insured-bridge/helpers/SmockitHelper.js");

// Helper contracts
const BridgePool = getContract("BridgePool");
const BridgeAdmin = getContract("BridgeAdmin");
const BridgeDepositBox = getContract("OVM_BridgeDepositBox");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("OptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");
const MockOracle = getContract("MockOracleAncillary");

// Contract objects
let bridgeAdmin: any;
let bridgePool: any;
let bridgeDepositBox: any;
let finder: any;
let store: any;
let identifierWhitelist: any;
let collateralWhitelist: any;
let l1Timer: any;
let l2Timer: any;
let optimisticOracle: any;
let l1Token: any;
let l2Token: any;
let mockOracle: any;

// Hard-coded test params:
const defaultGasLimit = 1_000_000;
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const lpFeeRatePerSecond = toWei("0.0000015");
const finalFee = toWei("1");
const defaultProposerBondPct = toWei("0.05");
const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.

// Tested file
import { run } from "../src/index";

describe("index.js", function () {
  let l1Accounts;
  let l1Owner: string;
  let l1CrossDomainMessengerMock: any;
  let l2CrossDomainMessengerMock: any;
  let l1Relayer: any;

  let l2Accounts;
  let l2Owner: any;
  let l2Depositor: any;

  let spyLogger: any;
  let spy: any;
  let l2Web3: any;

  const startGanacheServer = (chainId: number, port: number) => {
    const node = ganache.server({
      _chainIdRpc: chainId,
      blockGasLimit: 15_000_000,
      gasPrice: "auto",
      unlocked_accounts: [predeploys.OVM_L2CrossDomainMessenger],
    });
    node.listen(port);
    return new Web3("http://127.0.0.1:" + port);
  };

  const deployL2Contract = async (contract: any, args: any, from: string) => {
    return await new l2Web3.eth.Contract(contract.abi, undefined)
      .deploy({
        data: contract.bytecode,
        arguments: args,
      })
      .send({ from: from, gas: 5_000_000 });
  };

  l2Web3 = startGanacheServer(666, 7777);

  before(async function () {
    l1Accounts = await web3.eth.getAccounts();
    [l1Owner, l1Relayer] = l1Accounts;

    l2Accounts = await l2Web3.eth.getAccounts();
    [l2Owner, l2Depositor] = l2Accounts;

    // Deploy or fetch deployed contracts:
    finder = await Finder.new().send({ from: l1Owner });
    collateralWhitelist = await AddressWhitelist.new().send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: l1Owner });

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: l1Owner });
    l1Timer = await Timer.new().send({ from: l1Owner });
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, l1Timer.options.address).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: l1Owner });

    // Other contract setup needed to relay deposit:
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: l1Owner });
  });

  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    l1Token = await ERC20.new("TESTERC20", "TESTERC20", 18).send({ from: l1Owner });
    await l1Token.methods.addMember(TokenRolesEnum.MINTER, l1Owner).send({ from: l1Owner });
    await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: l1Owner });
    await store.methods.setFinalFee(l1Token.options.address, { rawValue: finalFee }).send({ from: l1Owner });

    // Deploy new OptimisticOracle so that we can control its timing:
    // - Set initial liveness to something != `defaultLiveness` so we can test that the custom liveness is set
    //   correctly by the BridgePool.
    optimisticOracle = await OptimisticOracle.new(
      defaultLiveness * 10,
      finder.options.address,
      l1Timer.options.address
    ).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: l1Owner });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, l1Timer.options.address).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: l1Owner });

    // Deploy and setup BridgeAdmin:
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: l1Owner });

    // Deploy the l2Timer, Deposit box and l2Token on the second web3 instance from ganache.

    console.log("a");
    l2Timer = await deployL2Contract(Timer, [], l2Owner);

    bridgeDepositBox = await deployL2Contract(
      BridgeDepositBox,
      [bridgeAdmin.options.address, minimumBridgingDelay, l2Timer.options.address],
      l2Owner
    );

    l2Token = await deployL2Contract(ERC20, ["L2ERC20", "L2ERC20", 18], l2Owner);

    console.log("bridgeDepositBox", bridgeDepositBox.options.address);

    await bridgeAdmin.methods.setDepositContract(bridgeDepositBox.options.address).send({ from: l1Owner });

    // New BridgePool linked to BridgeAdmin
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      l1Timer.options.address
    ).send({ from: l1Owner });

    // Add L1-L2 token mapping
    console.log("white", bridgePool.options.address);
    await bridgeAdmin.methods
      .whitelistToken(l1Token.options.address, l2Token.options.address, bridgePool.options.address, defaultGasLimit)
      .send({ from: l1Owner });

    console.log("1");
    l2CrossDomainMessengerMock = await deployOptimismContractMock(
      "OVM_L2CrossDomainMessenger",
      { address: predeploys.OVM_L2CrossDomainMessenger },
      l2Web3
    );
    console.log("2", l2CrossDomainMessengerMock.options.address);
    console.log("l1", await web3.eth.getCode(l2CrossDomainMessengerMock.options.address));
    console.log("l2", await l2Web3.eth.getCode(l2CrossDomainMessengerMock.options.address));
    await l2Web3.eth.sendTransaction({ from: l2Owner, to: predeploys.OVM_L2CrossDomainMessenger, value: toWei("1") });
    console.log("B");
    l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin.options.address);
    console.log("c", l1Token.options.address);
    console.log("d", l2Token.options.address);
    console.log("e", bridgePool.options.address);
    await bridgeDepositBox.methods
      .whitelistToken(l1Token.options.address, l2Token.options.address, bridgePool.options.address)
      .send({ from: predeploys.OVM_L2CrossDomainMessenger });

    console.log("end");
    // spy = sinon.spy();
    // spyLogger = winston.createLogger({
    //   level: "debug",
    //   transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    // });
  });

  it("Runs with no errors", async function () {
    console.log("HI");
  });
});
