import winston from "winston";
import sinon from "sinon";
import { run } from "../src/index";
import hre from "hardhat";

import {
  interfaceName,
  addGlobalHardhatTestingAddress,
  createConstructorParamsForContractVersion,
  HRE,
} from "@uma/common";

const { web3, getContract } = hre as HRE;
const { toWei, utf8ToHex, padRight } = web3.utils;

import { SpyTransport } from "@uma/financial-templates-lib";

describe("index.js", function () {
  let accounts: string[];
  let contractCreator: string;
  let spyLogger: any;
  let spy: any;
  let collateralToken: any;
  let syntheticToken: any;
  let financialContract: any;
  let uniswap: any;
  let store: any;
  let timer: any;
  let mockOracle: any;
  let finder: any;
  let identifierWhitelist: any;
  let configStore: any;
  let collateralWhitelist: any;
  let optimisticOracle: any;
  let defaultPriceFeedConfig: any;
  let constructorParams: any;
  let dsProxyFactory: any;

  let originalEnv: any;

  const identifier = "TEST_IDENTIFIER";
  const fundingRateIdentifier = "TEST_FUNDING";

  const FinancialContract = getContract("Perpetual");
  const Finder = getContract("Finder");
  const IdentifierWhitelist = getContract("IdentifierWhitelist");
  const AddressWhitelist = getContract("AddressWhitelist");
  const MockOracle = getContract("MockOracle");
  const Token = getContract("ExpandedERC20");
  const SyntheticToken = getContract("SyntheticToken");
  const Timer = getContract("Timer");
  const UniswapMock = getContract("UniswapV2Mock");
  const Store = getContract("Store");
  const ConfigStore = getContract("ConfigStore");
  const OptimisticOracle = getContract("OptimisticOracle");
  const DSProxyFactory = getContract("DSProxyFactory");

  after(async function () {
    process.env = originalEnv;
  });
  before(async function () {
    originalEnv = process.env;
    accounts = await web3.eth.getAccounts();
    contractCreator = accounts[0];
    finder = await Finder.new().send({ from: accounts[0] });
    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.new().send({ from: accounts[0] });
    await identifierWhitelist.methods.addSupportedIdentifier(utf8ToHex(identifier)).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(
        web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist),
        identifierWhitelist.options.address
      )
      .send({ from: accounts[0] });

    timer = await Timer.new().send({ from: accounts[0] });

    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({
      from: contractCreator,
    });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: accounts[0] });
    // Set the address in the global name space to enable disputer's index.js to access it.
    addGlobalHardhatTestingAddress("Voting", mockOracle.options.address);

    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: accounts[0] });

    // Make the contract creator the admin to enable emergencyshutdown in tests.
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.FinancialContractsAdmin), contractCreator)
      .send({ from: accounts[0] });

    dsProxyFactory = await DSProxyFactory.new().send({ from: accounts[0] });
  });

  beforeEach(async function () {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    // Create a new synthetic token & collateral token.
    syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: contractCreator });
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: contractCreator });

    collateralWhitelist = await AddressWhitelist.new().send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(
        web3.utils.utf8ToHex(interfaceName.CollateralWhitelist),
        collateralWhitelist.options.address
      )
      .send({ from: accounts[0] });
    await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: accounts[0] });

    configStore = await ConfigStore.new(
      {
        timelockLiveness: 86400, // 1 day
        rewardRatePerSecond: { rawValue: "0" },
        proposerBondPercentage: { rawValue: "0" },
        maxFundingRate: { rawValue: toWei("0.00001") },
        minFundingRate: { rawValue: toWei("-0.00001") },
        proposalTimePastLimit: 0,
      },
      timer.options.address
    ).send({ from: accounts[0] });

    await identifierWhitelist.methods
      .addSupportedIdentifier(padRight(utf8ToHex(fundingRateIdentifier), 32))
      .send({ from: accounts[0] });
    optimisticOracle = await OptimisticOracle.new(7200, finder.options.address, timer.options.address).send({
      from: accounts[0],
    });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: accounts[0] });

    // Deploy a new expiring multi party OR perpetual.
    constructorParams = await createConstructorParamsForContractVersion(
      { contractType: "Perpetual", contractVersion: "2.0.1" },
      {
        convertDecimals: toWei, // These tests do not use convertSynthetic. Override this with toWei
        finder,
        collateralToken,
        syntheticToken,
        identifier,
        fundingRateIdentifier,
        timer,
        store,
        configStore: configStore || {}, // if the contract type is not a perp this will be null.
      },
      { expirationTimestamp: parseInt(await timer.methods.getCurrentTime().call()) + 100 } // config override expiration time.
    );
    financialContract = await FinancialContract.new(constructorParams).send({ from: accounts[0] });
    await syntheticToken.methods.addMinter(financialContract.options.address).send({ from: accounts[0] });
    await syntheticToken.methods.addBurner(financialContract.options.address).send({ from: accounts[0] });

    syntheticToken = await Token.at(await financialContract.methods.tokenCurrency().call());

    uniswap = await UniswapMock.new().send({ from: accounts[0] });
    await uniswap.methods
      .setTokens(syntheticToken.options.address, collateralToken.options.address)
      .send({ from: accounts[0] });

    defaultPriceFeedConfig = {
      type: "uniswap",
      uniswapAddress: uniswap.options.address,
      twapLength: 1,
      lookback: 1,
      getTimeOverride: { useBlockTime: true }, // enable tests to run in hardhat
    };

    // Set two uniswap prices to give it a little history.
    await uniswap.methods.setPrice(toWei("1"), toWei("1")).send({ from: accounts[0] });
    await uniswap.methods.setPrice(toWei("1"), toWei("1")).send({ from: accounts[0] });
    await uniswap.methods.setPrice(toWei("1"), toWei("1")).send({ from: accounts[0] });
    await uniswap.methods.setPrice(toWei("1"), toWei("1")).send({ from: accounts[0] });
  });

  it("Runs with no errors", async function () {
    process.env.EMP_ADDRESS = financialContract.options.address;
    process.env.REFERENCE_PRICE_FEED_CONFIG = JSON.stringify(defaultPriceFeedConfig);
    process.env.TOKEN_PRICE_FEED_CONFIG = JSON.stringify(defaultPriceFeedConfig);
    process.env.DSPROXY_CONFIG = JSON.stringify({ dsProxyFactoryAddress: dsProxyFactory.options.address });
    process.env.EXCHANGE_ADAPTER_CONFIG = JSON.stringify({
      type: "uniswap-v2",
      tokenAAddress: syntheticToken.options.address,
      tokenBAddress: collateralToken.options.address,
    });
    process.env.POLLING_DELAY = "0";

    // Must not throw.
    await run(spyLogger, web3);
  });
});
