// Default price feed configs for currently approved identifiers.
const defaultConfigs = {
  "ETH/BTC": {
    type: "medianizer",
    pair: "ethbtc",
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro" },
      { type: "cryptowatch", exchange: "binance" },
      { type: "cryptowatch", exchange: "bitstamp" }
    ]
  },
  "COMP/USD": {
    // Kovan uses the "/"
    type: "medianizer",
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "compusd" },
      { type: "cryptowatch", exchange: "poloniex", pair: "compusdt" },
      { type: "cryptowatch", exchange: "ftx", pair: "compusd" }
    ]
  },
  COMPUSD: {
    // Mainnet has no "/"
    type: "medianizer",
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "compusd" },
      { type: "cryptowatch", exchange: "poloniex", pair: "compusdt" },
      { type: "cryptowatch", exchange: "ftx", pair: "compusd" }
    ]
  },
  USDETH: {
    type: "medianizer",
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "ethusd" },
      { type: "cryptowatch", exchange: "binance", pair: "ethusdt" },
      { type: "cryptowatch", exchange: "kraken", pair: "ethusd" }
    ]
  },
  USDBTC: {
    type: "medianizer",
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "btcusd" },
      { type: "cryptowatch", exchange: "binance", pair: "btcusdt" },
      { type: "cryptowatch", exchange: "bitstamp", pair: "btcusd" }
    ]
  },
  USDPERL: {
    type: "medianizer",
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [{ type: "cryptowatch", exchange: "binance", pair: "perlusdt" }]
  },
  BCHNBTC: {
    type: "medianizer",
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "BCHBTC" },
      { type: "cryptowatch", exchange: "binance", pair: "BCHBTC" },
      { type: "cryptowatch", exchange: "huobi", pair: "BCHBTC" }
    ]
  },
  STABLESPREAD: {
    // This is alternatively known as "STABLESPREAD/ETH"
    type: "basketspread",
    lookback: 7200,
    // We override the default value of 172800, equal to the liquidationLiveness of this EMP, so that
    // the BalancerPriceFeed does not throw a "too many web3 requests" error.
    minTimeBetweenUpdates: 60,
    experimentalPriceFeeds: [
      {
        type: "medianizer",
        computeMean: true,
        medianizedFeeds: [
          { type: "cryptowatch", exchange: "bittrex", pair: "ustusdt" },
          { type: "cryptowatch", exchange: "uniswap-v2", pair: "ustusdt" }
        ]
      },
      {
        type: "medianizer",
        computeMean: true,
        medianizedFeeds: [
          { type: "cryptowatch", exchange: "binance", pair: "busdusdt" },
          { type: "cryptowatch", exchange: "uniswap-v2", pair: "busdusdt" }
        ]
      },
      {
        type: "medianizer",
        computeMean: true,
        medianizedFeeds: [
          { type: "cryptowatch", exchange: "bittrex", pair: "cusdusdt" }
          // NOTE: The OKCoin exchange is not available on Cryptowatch for this pair,
          // presumably because it has such low volume.
          // { type: "cryptowatch", exchange: "okcoin" }
        ]
      }
    ],
    baselinePriceFeeds: [
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "balancer",
            balancerAddress: "0x72cd8f4504941bf8c5a21d1fd83a96499fd71d2c",
            // Setting USDC as tokenIn and MUSD as tokenOut, we get the price of MUSD denominated in USDC.
            balancerTokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC in
            balancerTokenOut: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5", // MUSD out
            poolDecimals: 6 // Prices are reported from this pool in 6 decimals to match USDC
          }
        ]
      }
    ],
    denominatorPriceFeed: {
      type: "medianizer",
      medianizedFeeds: [
        { type: "cryptowatch", exchange: "coinbase-pro", pair: "ethusd" },
        { type: "cryptowatch", exchange: "binance", pair: "ethusdt" },
        { type: "cryptowatch", exchange: "kraken", pair: "ethusd" }
      ]
    }
  },
  "GASETH-TWAP-1Mx1M": {
    type: "uniswap",
    uniswapAddress: "0x25fb29D865C1356F9e95D621F21366d3a5DB6BB0",
    twapLength: 7200
  },
  "GASETH-FEB21": {
    type: "uniswap",
    uniswapAddress: "0x4a8a2ea3718964ed0551a3191c30e49ea38a5ade",
    twapLength: 7200
  },
  "GASETH-MAR21": {
    type: "uniswap",
    uniswapAddress: "0x683ea972ffa19b7bad6d6be0440e0a8465dba71c",
    twapLength: 7200
  }
};

module.exports = { defaultConfigs };
