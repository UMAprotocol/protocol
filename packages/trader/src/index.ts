import { config } from "dotenv";
config();
import retry from "async-retry";
import { TraderConfig } from "./TraderConfig";
const { createExchangeAdapter } = require("./exchange-adapters/CreateExchangeAdapter");
const { getWeb3, MAX_UINT_VAL, findContractVersion, SUPPORTED_CONTRACT_VERSIONS } = require("@uma/common");
const {
  GasEstimator,
  FinancialContractClient,
  Networker,
  Logger,
  createReferencePriceFeedForFinancialContract,
  createTokenPriceFeedForFinancialContract,
  waitForLogger,
  delay,
  DSProxyManager
} = require("@uma/financial-templates-lib");

const { RangeTrader } = require("./RangeTrader");
// Contract ABIs and network Addresses.
const { getAbi, getAddress } = require("@uma/core");

export async function run(logger: any, web3: any): Promise<void> {
  const getTime = () => Math.round(new Date().getTime() / 1000);
  // Config Processing
  const config = new TraderConfig(process.env);
  console.log("config", config);

  // Load unlocked web3 accounts, get the networkId and set up price feed.
  const networker = new Networker(logger);
  const accounts = await web3.eth.getAccounts();

  // TODO: create a method to pull out constants for the uniswap factory, router.

  const gasEstimator = new GasEstimator(logger);

  const dsProxyManager = new DSProxyManager({
    logger,
    web3,
    gasEstimator,
    account: accounts[0],
    dsProxyFactoryAddress: config.dsProxyFactoryAddress,
    dsProxyFactoryAbi: getAbi("DSProxyFactory"),
    dsProxyAbi: getAbi("DSProxy")
  });

  await dsProxyManager.initializeDSProxy();

  const [tokenPriceFeed, referencePriceFeed, exchangeAdapter] = await Promise.all([
    createTokenPriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      config.financialContractAddress,
      config.tokenPriceFeedConfig
    ),

    createReferencePriceFeedForFinancialContract(
      logger,
      web3,
      networker,
      getTime,
      config.financialContractAddress,
      config.referencePriceFeedConfig
    ),
    createExchangeAdapter(logger, web3, dsProxyManager, config.exchangeAdapterConfig)
  ]);

  const rangeTrader = new RangeTrader(tokenPriceFeed, referencePriceFeed, exchangeAdapter);
  await retry(
    async () => {
      // Trading logic here.
    },
    {
      retries: 3,
      minTimeout: 5 * 1000, // delay between retries in ms
      randomize: false,
      onRetry: (error: Error, attempt: number) => {
        console.log(error, attempt);
      }
    }
  );
}

if (require.main === module) {
  run(Logger, getWeb3())
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
