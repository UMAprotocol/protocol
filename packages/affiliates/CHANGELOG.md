# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.0.1](https://github.com/mrice32/protocol/compare/@uma/affiliates@1.0.0...@uma/affiliates@1.0.1) (2021-02-27)

**Note:** Version bump only for package @uma/affiliates

# [1.0.0](https://github.com/UMAprotocol/protocol/compare/@uma/affiliates@0.1.0...@uma/affiliates@1.0.0) (2021-02-26)

### Bug Fixes

- **affiliates:** switch between price feed output and also convert time to ms ([#2463](https://github.com/UMAprotocol/protocol/issues/2463)) ([81ea894](https://github.com/UMAprotocol/protocol/commit/81ea8948e7c857708deac24ea53ba4a411bffacc))
- **affiliates:** update synthPrices with fixed decimals, allow default fallback prices ([#2398](https://github.com/UMAprotocol/protocol/issues/2398)) ([88d9dd2](https://github.com/UMAprotocol/protocol/commit/88d9dd2a77f14e950bc572cdafcd384a0b0c0fc7))

### Features

- **affiliate:** deployer rewards week 3 ([#2246](https://github.com/UMAprotocol/protocol/issues/2246)) ([45fc5d3](https://github.com/UMAprotocol/protocol/commit/45fc5d3a9c0e4902ba81be27e268ef942b014d63))
- **affiliates:** add coingecko synthetic price fallback and calculator ([#2257](https://github.com/UMAprotocol/protocol/issues/2257)) ([d54a637](https://github.com/UMAprotocol/protocol/commit/d54a6370e5f78cccd62cac1c634f31e1615f9313))
- **affiliates:** add dapp mining script entrypoint and config example ([#2355](https://github.com/UMAprotocol/protocol/issues/2355)) ([084d39d](https://github.com/UMAprotocol/protocol/commit/084d39d7fac12e17f8d331e5e7b8b788c1dd719a))
- **affiliates:** add readmes and examples for dapp mining tagging ([#2321](https://github.com/UMAprotocol/protocol/issues/2321)) ([aa7a2c4](https://github.com/UMAprotocol/protocol/commit/aa7a2c41e8c398a0414cb900ae07c91ba137afb6))
- **affiliates:** add script to read from google sheet dev mining status ([#2516](https://github.com/UMAprotocol/protocol/issues/2516)) ([5673495](https://github.com/UMAprotocol/protocol/commit/5673495b26833f8c94f1e17cb64e0be21fe7c484))
- **affiliates:** emps which expire do not contribute to rewards after expiry ([#2417](https://github.com/UMAprotocol/protocol/issues/2417)) ([9ff740d](https://github.com/UMAprotocol/protocol/commit/9ff740da064a11d760c51db05faaa0600f32fc78))
- **disputer,liquidator,monitorfinancial-templates-lib:** rename all instances of emp to financialContract ([#2528](https://github.com/UMAprotocol/protocol/issues/2528)) ([e8c9b1e](https://github.com/UMAprotocol/protocol/commit/e8c9b1e06f1b88fbeea02858b5f5974f29a0d4a8))
- **LM:** add Uniswap Liquidity mining script ([#2255](https://github.com/UMAprotocol/protocol/issues/2255)) ([60486dd](https://github.com/UMAprotocol/protocol/commit/60486dd18f7860f7b3dfd8b0648cea4bd19098ac))
- **optimistic-oracle-keeper:** Add functionality to propose prices for price requests ([#2505](https://github.com/UMAprotocol/protocol/issues/2505)) ([cc71ea5](https://github.com/UMAprotocol/protocol/commit/cc71ea56ef6fd944232f9e8f6a7e190ce2ab250d))

# [0.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/affiliates@0.0.1...@uma/affiliates@0.1.0) (2020-11-23)

### Bug Fixes

- **affiliates:** fix bigquery bug where timestamps computed incorrectly ([#2178](https://github.com/UMAprotocol/protocol/issues/2178)) ([6b18caa](https://github.com/UMAprotocol/protocol/commit/6b18caa177e9f4a6a8e12e2d73b1a586c9f3eeb3))
- **affiliates:** when getting balances use all time logs instead of logs from start time ([#2174](https://github.com/UMAprotocol/protocol/issues/2174)) ([8816955](https://github.com/UMAprotocol/protocol/commit/88169554da4652268c68c3bb04082d18a891f874))

### Features

- **affiliates:** add 2020-11-09 emp deployer payouts calculation ([#2192](https://github.com/UMAprotocol/protocol/issues/2192)) ([40bf57a](https://github.com/UMAprotocol/protocol/commit/40bf57a6de2b6b0c05b56b6e1d62434afdc52bb1))
- **affiliates:** add extra data to deployer reward results ([#2172](https://github.com/UMAprotocol/protocol/issues/2172)) ([a0f038c](https://github.com/UMAprotocol/protocol/commit/a0f038ca961df8e00050a57542228da89294575e))
- **emp:** financial product library to apply price transformation ([#2185](https://github.com/UMAprotocol/protocol/issues/2185)) ([5a7e2ec](https://github.com/UMAprotocol/protocol/commit/5a7e2ec25c5ecbc09397284839a553fee9d5636d))
