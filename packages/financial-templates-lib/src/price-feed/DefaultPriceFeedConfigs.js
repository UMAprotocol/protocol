const { getPrecisionForIdentifier } = require("@uma/common");

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
    minTimeBetweenUpdates: 60,
    experimentalPriceFeeds: [
      {
        type: "medianizer",
        computeMean: true,
        medianizedFeeds: [
          { type: "cryptowatch", exchange: "bittrex", pair: "ustusdt" },
          {
            type: "uniswap",
            uniswapAddress: "0xc50ef7861153c51d383d9a7d48e6c9467fb90c38",
            twapLength: 2
          }
        ]
      },
      {
        type: "medianizer",
        computeMean: true,
        medianizedFeeds: [
          { type: "cryptowatch", exchange: "binance", pair: "busdusdt" },
          {
            type: "uniswap",
            uniswapAddress: "0xa0abda1f980e03d7eadb78aed8fc1f2dd0fe83dd",
            twapLength: 2
          }
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
            type: "medianizer",
            computeMean: true,
            medianizedFeeds: [
              { type: "cryptowatch", exchange: "bitfinex", pair: "usdtusd" },
              { type: "cryptowatch", exchange: "kraken", pair: "usdtusd" }
            ]
          },
          {
            type: "medianizer",
            computeMean: true,
            medianizedFeeds: [
              { type: "cryptowatch", exchange: "kraken", pair: "usdcusd" },
              { type: "cryptowatch", exchange: "bitstamp", pair: "usdcusd" }
            ]
          }
        ]
      }
    ],
    denominatorPriceFeed: {
      type: "medianizer",
      medianizedFeeds: [
        { type: "cryptowatch", exchange: "coinbase-pro", pair: "ethusd" },
        { type: "cryptowatch", exchange: "binance", pair: "ethusdt" }
      ]
    }
  },
  "STABLESPREAD/USDC": {
    type: "basketspread",
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    experimentalPriceFeeds: [
      {
        type: "medianizer",
        computeMean: true,
        medianizedFeeds: [
          { type: "cryptowatch", exchange: "bittrex", pair: "ustusdt" },
          {
            type: "uniswap",
            uniswapAddress: "0xc50ef7861153c51d383d9a7d48e6c9467fb90c38",
            twapLength: 2
          }
        ]
      },
      {
        type: "medianizer",
        computeMean: true,
        medianizedFeeds: [
          { type: "cryptowatch", exchange: "binance", pair: "busdusdt" },
          {
            type: "uniswap",
            uniswapAddress: "0xa0abda1f980e03d7eadb78aed8fc1f2dd0fe83dd",
            twapLength: 2
          }
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
            type: "medianizer",
            computeMean: true,
            medianizedFeeds: [
              { type: "cryptowatch", exchange: "bitfinex", pair: "usdtusd" },
              { type: "cryptowatch", exchange: "kraken", pair: "usdtusd" }
            ]
          },
          {
            type: "medianizer",
            computeMean: true,
            medianizedFeeds: [
              { type: "cryptowatch", exchange: "kraken", pair: "usdcusd" },
              { type: "cryptowatch", exchange: "bitstamp", pair: "usdcusd" }
            ]
          }
        ]
      }
    ]
  },
  "STABLESPREAD/BTC": {
    type: "basketspread",
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    experimentalPriceFeeds: [
      {
        type: "medianizer",
        computeMean: true,
        medianizedFeeds: [
          { type: "cryptowatch", exchange: "bittrex", pair: "ustusdt" },
          {
            type: "uniswap",
            uniswapAddress: "0xc50ef7861153c51d383d9a7d48e6c9467fb90c38",
            twapLength: 2
          }
        ]
      },
      {
        type: "medianizer",
        computeMean: true,
        medianizedFeeds: [
          { type: "cryptowatch", exchange: "binance", pair: "busdusdt" },
          {
            type: "uniswap",
            uniswapAddress: "0xa0abda1f980e03d7eadb78aed8fc1f2dd0fe83dd",
            twapLength: 2
          }
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
            type: "medianizer",
            computeMean: true,
            medianizedFeeds: [
              { type: "cryptowatch", exchange: "bitfinex", pair: "usdtusd" },
              { type: "cryptowatch", exchange: "kraken", pair: "usdtusd" }
            ]
          },
          {
            type: "medianizer",
            computeMean: true,
            medianizedFeeds: [
              { type: "cryptowatch", exchange: "kraken", pair: "usdcusd" },
              { type: "cryptowatch", exchange: "bitstamp", pair: "usdcusd" }
            ]
          }
        ]
      }
    ],
    denominatorPriceFeed: {
      type: "medianizer",
      medianizedFeeds: [
        { type: "cryptowatch", exchange: "kraken", pair: "btcusd" },
        { type: "cryptowatch", exchange: "bitstamp", pair: "btcusd" }
      ]
    }
  },
  "ELASTIC_STABLESPREAD/USDC": {
    type: "basketspread",
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    experimentalPriceFeeds: [
      {
        type: "medianizer",
        medianizedFeeds: [
          // FRAX/USDC:
          {
            type: "uniswap",
            uniswapAddress: "0x97c4adc5d28a86f9470c70dd91dc6cc2f20d2d4d",
            twapLength: 2
          }
        ]
      },
      {
        type: "medianizer",
        medianizedFeeds: [
          // ESD/USDC:
          {
            type: "uniswap",
            uniswapAddress: "0x88ff79eb2bc5850f27315415da8685282c7610f9",
            twapLength: 2
          }
        ]
      },
      {
        type: "medianizer",
        medianizedFeeds: [
          // BAC/DAI:
          { type: "uniswap", uniswapAddress: "0xd4405f0704621dbe9d4dea60e128e0c3b26bddbd", twapLength: 2 }
        ]
      }
    ],
    baselinePriceFeeds: [
      {
        type: "medianizer",
        medianizedFeeds: [
          {
            type: "medianizer",
            computeMean: true,
            medianizedFeeds: [
              { type: "cryptowatch", exchange: "bitfinex", pair: "usdtusd" },
              { type: "cryptowatch", exchange: "kraken", pair: "usdtusd" }
            ]
          },
          {
            type: "medianizer",
            computeMean: true,
            medianizedFeeds: [
              { type: "cryptowatch", exchange: "kraken", pair: "usdcusd" },
              { type: "cryptowatch", exchange: "bitstamp", pair: "usdcusd" }
            ]
          }
        ]
      }
    ]
  },
  "GASETH-TWAP-1Mx1M": {
    type: "uniswap",
    uniswapAddress: "0x2b5dfb7874f685bea30b7d8426c9643a4bcf5873",
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
  },
  "COMPUSDC-APR-MAR28/USDC": {
    type: "uniswap",
    uniswapAddress: "0xd8ecab1d50c3335d01885c17b1ce498105238f24",
    twapLength: 7200,
    poolDecimals: 6
  },
  BTCDOM: {
    type: "domfi",
    pair: "BTCDOM",
    minTimeBetweenUpdates: 60,
    lookback: 7200
  },
  ALTDOM: {
    type: "domfi",
    pair: "ALTDOM",
    minTimeBetweenUpdates: 60,
    lookback: 7200
  },
  AMPLUSD: {
    type: "medianizer",
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "ftx", pair: "amplusdt" },
      { type: "cryptowatch", exchange: "gateio", pair: "amplusdt" },
      { type: "cryptowatch", exchange: "bitfinex", pair: "amplusd" }
    ]
  },
  DEFI_PULSE_TOTAL_TVL: {
    type: "defipulse",
    lookback: 604800,
    minTimeBetweenUpdates: 600,
    project: "all"
  },
  DEFI_PULSE_SUSHI_TVL: {
    type: "defipulse",
    lookback: 604800,
    minTimeBetweenUpdates: 600,
    project: "SushiSwap"
  },
  DEFI_PULSE_UNISWAP_TVL: {
    type: "defipulse",
    lookback: 604800,
    minTimeBetweenUpdates: 600,
    project: "Uniswap"
  },
  SUSHIUNI: {
    type: "expression",
    expression: "10 * DEFI_PULSE_SUSHI_TVL / DEFI_PULSE_UNISWAP_TVL"
  },
  CNYUSD: {
    type: "fallback",
    orderedFeeds: [
      {
        type: "tradermade",
        pair: "CNYUSD",
        minTimeBetweenUpdates: 600,
        minuteLookback: 7200,
        hourlyLookback: 259200,
        ohlcPeriod: 10 // CNYUSD only available at 10 minute granularity
      },
      {
        type: "forexdaily",
        base: "CNY",
        symbol: "USD",
        lookback: 259200
      }
    ]
  },
  EURUSD: {
    type: "fallback",
    orderedFeeds: [
      {
        type: "tradermade",
        pair: "EURUSD",
        minTimeBetweenUpdates: 60,
        minuteLookback: 7200,
        hourlyLookback: 259200
      },
      {
        type: "forexdaily",
        base: "EUR",
        symbol: "USD",
        lookback: 259200
      }
    ]
  },
  PHPDAI: {
    type: "medianizer",
    computeMean: true,
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      {
        type: "coinmarketcap",
        symbol: "DAI",
        quoteCurrency: "PHP",
        invertPrice: true
      },
      {
        type: "coingecko",
        contractAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
        quoteCurrency: "php",
        invertPrice: true
      }
    ]
  },
  "ETH-BASIS-6M/USDC": {
    type: "expression",
    expression: `
      SPOT = median(SPOT_BINANCE, SPOT_OKEX, SPOT_FTX);
      FUTURES = median(FUT_BINANCE, FUT_OKEX, FUT_FTX);
      min(1.25, max(0.75, 1.0 + ((FUTURES - SPOT) / SPOT))) * 100
      `,
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    customFeeds: {
      SPOT_BINANCE: { type: "cryptowatch", exchange: "binance", pair: "ethusdt" },
      SPOT_OKEX: { type: "cryptowatch", exchange: "okex", pair: "ethusdt" },
      SPOT_FTX: { type: "cryptowatch", exchange: "ftx", pair: "ethusdt" },
      FUT_BINANCE: { type: "cryptowatch", exchange: "binance", pair: "ethusd-quarterly-future-inverse-25jun21" },
      FUT_OKEX: { type: "cryptowatch", exchange: "okex", pair: "ethusd-biquarterly-future-inverse" },
      FUT_FTX: { type: "cryptowatch", exchange: "ftx", pair: "ethusd-quarterly-futures-25jun21" }
    }
  },
  "ETH-BASIS-3M/USDC": {
    type: "expression",
    expression: `
      SPOT = median(SPOT_BINANCE, SPOT_OKEX, SPOT_FTX);
      FUTURES = median(FUT_BINANCE, FUT_OKEX, FUT_FTX);
      min(1.25, max(0.75, 1.0 + ((FUTURES - SPOT) / SPOT))) * 100
      `,
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    customFeeds: {
      SPOT_BINANCE: { type: "cryptowatch", exchange: "binance", pair: "ethusdt" },
      SPOT_OKEX: { type: "cryptowatch", exchange: "okex", pair: "ethusdt" },
      SPOT_FTX: { type: "cryptowatch", exchange: "ftx", pair: "ethusdt" },
      FUT_BINANCE: { type: "cryptowatch", exchange: "binance", pair: "ethusd-quarterly-future-inverse-26mar21" },
      FUT_OKEX: { type: "cryptowatch", exchange: "okex", pair: "ethusd-quarterly-future-inverse" },
      FUT_FTX: { type: "cryptowatch", exchange: "ftx", pair: "ethusd-quarterly-futures-26mar21" }
    }
  },
  "BTC-BASIS-6M/USDC": {
    type: "expression",
    expression: `
      SPOT = median(SPOT_BINANCE, SPOT_OKEX, SPOT_FTX);
      FUTURES = median(FUT_BINANCE, FUT_OKEX, FUT_FTX);
      min(1.25, max(0.75, 1.0 + ((FUTURES - SPOT) / SPOT))) * 100
      `,
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    customFeeds: {
      SPOT_BINANCE: { type: "cryptowatch", exchange: "binance", pair: "btcusdt" },
      SPOT_OKEX: { type: "cryptowatch", exchange: "okex", pair: "btcusdt" },
      SPOT_FTX: { type: "cryptowatch", exchange: "ftx", pair: "btcusdt" },
      FUT_BINANCE: { type: "cryptowatch", exchange: "binance", pair: "btcusd-quarterly-future-inverse-25jun21" },
      FUT_OKEX: { type: "cryptowatch", exchange: "okex", pair: "btcusd-biquarterly-future-inverse" },
      FUT_FTX: { type: "cryptowatch", exchange: "ftx", pair: "btcusd-quarterly-futures-25jun21" }
    }
  },
  "BTC-BASIS-3M/USDC": {
    type: "expression",
    expression: `
      SPOT = median(SPOT_BINANCE, SPOT_OKEX, SPOT_FTX);
      FUTURES = median(FUT_BINANCE, FUT_OKEX, FUT_FTX);
      min(1.25, max(0.75, 1.0 + ((FUTURES - SPOT) / SPOT))) * 100
      `,
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    customFeeds: {
      SPOT_BINANCE: { type: "cryptowatch", exchange: "binance", pair: "btcusdt" },
      SPOT_OKEX: { type: "cryptowatch", exchange: "okex", pair: "btcusdt" },
      SPOT_FTX: { type: "cryptowatch", exchange: "ftx", pair: "btcusdt" },
      FUT_BINANCE: { type: "cryptowatch", exchange: "binance", pair: "btcusd-quarterly-future-inverse-26mar21" },
      FUT_OKEX: { type: "cryptowatch", exchange: "okex", pair: "btcusd-quarterly-future-inverse" },
      FUT_FTX: { type: "cryptowatch", exchange: "ftx", pair: "btcusd-quarterly-futures-26mar21" }
    }
  },
  "USD/bBadger": {
    type: "expression",
    // Note: lower-case variables are intermediate, upper-case are configured feeds.
    expression: `
      wbtc_usd = mean(WBTC_ETH_SUSHI, WBTC_ETH_UNI) / USDETH;
      badger_usd_sushi = wbtc_usd * BADGER_WBTC_SUSHI;
      badger_usd_uni = wbtc_usd * BADGER_WBTC_UNI;
      badger_usd = median(badger_usd_sushi, badger_usd_uni, BADGER_USD_HUOBI);
      1 / (badger_usd * BBADGER_BADGER)
    `,
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    twapLength: 300,
    priceFeedDecimals: 18,
    customFeeds: {
      WBTC_ETH_SUSHI: { type: "uniswap", uniswapAddress: "0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58" },
      WBTC_ETH_UNI: { type: "uniswap", uniswapAddress: "0xBb2b8038a1640196FbE3e38816F3e67Cba72D940" },
      BADGER_WBTC_SUSHI: {
        type: "uniswap",
        uniswapAddress: "0x110492b31c59716ac47337e616804e3e3adc0b4a",
        invertPrice: true
      },
      BADGER_WBTC_UNI: {
        type: "uniswap",
        uniswapAddress: "0xcd7989894bc033581532d2cd88da5db0a4b12859",
        invertPrice: true
      },
      BADGER_USD_HUOBI: { type: "cryptowatch", exchange: "huobi", pair: "badgerusdt" },
      BBADGER_BADGER: { type: "vault", address: "0x19d97d8fa813ee2f51ad4b4e04ea08baf4dffc28" }
    }
  },
  "USD-[bwBTC/ETH SLP]": {
    type: "expression",
    expression: `
      wbtc_usd = mean(WBTC_ETH_SUSHI, WBTC_ETH_UNI) / USDETH;
      eth_usd = 1 / USDETH;
      lp_usd = (wbtc_usd * WBTC_PER_SHARE) + (eth_usd * ETH_PER_SHARE);
      1 / (BLP_LP * lp_usd)
    `,
    lookback: 7200,
    minTimeBetweenUpdates: 60,
    twapLength: 300,
    priceFeedDecimals: 18,
    customFeeds: {
      WBTC_ETH_SUSHI: { type: "uniswap", uniswapAddress: "0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58" },
      WBTC_ETH_UNI: { type: "uniswap", uniswapAddress: "0xBb2b8038a1640196FbE3e38816F3e67Cba72D940" },
      ETH_PER_SHARE: {
        type: "lp",
        poolAddress: "0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58",
        tokenAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
      },
      WBTC_PER_SHARE: {
        type: "lp",
        poolAddress: "0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58",
        tokenAddress: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"
      },
      BLP_LP: { type: "vault", address: "0x758A43EE2BFf8230eeb784879CdcFF4828F2544D" }
    }
  },
  XAUPERL: {
    type: "expression",
    expression: "XAUUSD * USDPERL"
  },
  XAUUSD: {
    type: "tradermade",
    pair: "XAUUSD",
    minuteLookback: 7200,
    hourlyLookback: 259200,
    minTimeBetweenUpdates: 60
  },
  uSTONKS_APR21: {
    type: "uniswap",
    uniswapAddress: "0xedf187890af846bd59f560827ebd2091c49b75df",
    twapLength: 7200,
    invertPrice: true
  },
  USDAAVE: {
    type: "medianizer",
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "aaveusd" },
      { type: "cryptowatch", exchange: "binance", pair: "aaveusdt" },
      { type: "cryptowatch", exchange: "okex", pair: "aaveusdt" }
    ]
  },
  AAVEUSD: {
    type: "medianizer",
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "aaveusd" },
      { type: "cryptowatch", exchange: "binance", pair: "aaveusdt" },
      { type: "cryptowatch", exchange: "okex", pair: "aaveusdt" }
    ]
  },
  USDLINK: {
    type: "medianizer",
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "linkusd" },
      { type: "cryptowatch", exchange: "binance", pair: "linkusdt" },
      { type: "cryptowatch", exchange: "okex", pair: "linkusdt" }
    ]
  },
  LINKUSD: {
    type: "medianizer",
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "linkusd" },
      { type: "cryptowatch", exchange: "binance", pair: "linkusdt" },
      { type: "cryptowatch", exchange: "okex", pair: "linkusdt" }
    ]
  },
  USDSNX: {
    type: "medianizer",
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "snxusd" },
      { type: "cryptowatch", exchange: "binance", pair: "snxusdt" },
      { type: "cryptowatch", exchange: "okex", pair: "snxusdt" }
    ]
  },
  SNXUSD: {
    type: "medianizer",
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "snxusd" },
      { type: "cryptowatch", exchange: "binance", pair: "snxusdt" },
      { type: "cryptowatch", exchange: "okex", pair: "snxusdt" }
    ]
  },
  USDUMA: {
    type: "medianizer",
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "umausd" },
      { type: "cryptowatch", exchange: "binance", pair: "umausdt" },
      { type: "cryptowatch", exchange: "okex", pair: "umausdt" }
    ]
  },
  UMAUSD: {
    type: "medianizer",
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "umausd" },
      { type: "cryptowatch", exchange: "binance", pair: "umausdt" },
      { type: "cryptowatch", exchange: "okex", pair: "umausdt" }
    ]
  },
  USDUNI: {
    type: "medianizer",
    invertPrice: true,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "uniusd" },
      { type: "cryptowatch", exchange: "binance", pair: "uniusdt" },
      { type: "cryptowatch", exchange: "okex", pair: "uniusdt" }
    ]
  },
  UNIUSD: {
    type: "medianizer",
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "uniusd" },
      { type: "cryptowatch", exchange: "binance", pair: "uniusdt" },
      { type: "cryptowatch", exchange: "okex", pair: "uniusdt" }
    ]
  }
};

// Pull in the number of decimals for each identifier from the common getPrecisionForIdentifier. This is used within the
// Voterdapp and ensures that price feeds are consistently scaled through the UMA ecosystem.
Object.keys(defaultConfigs).forEach(identifierName => {
  defaultConfigs[identifierName].priceFeedDecimals = getPrecisionForIdentifier(identifierName);
});

module.exports = { defaultConfigs };
