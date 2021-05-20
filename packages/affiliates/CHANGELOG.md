# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [1.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/affiliates@1.2.0...@uma/affiliates@1.3.0) (2021-05-20)

### Bug Fixes

- **affiliates-ci:** removed private from package.json ([#2978](https://github.com/UMAprotocol/protocol/issues/2978)) ([5e1e72f](https://github.com/UMAprotocol/protocol/commit/5e1e72f01f9ded4b870125a7cd7f1413f58e0135))
- **core,affiliates:** log warning to console.error, make json piping easier to find issues ([#2913](https://github.com/UMAprotocol/protocol/issues/2913)) ([3679242](https://github.com/UMAprotocol/protocol/commit/3679242181b4134595048ecf8134c7916f8559fc))

### Features

- **affiliates:** add uniswap v3 single pool LM script ([#2953](https://github.com/UMAprotocol/protocol/issues/2953)) ([3b55015](https://github.com/UMAprotocol/protocol/commit/3b550158414d6384a2b44cd9232345f78d1430be))
- **affiliates:** uniswap v3 fetch state proof of concept ([#2923](https://github.com/UMAprotocol/protocol/issues/2923)) ([269aee9](https://github.com/UMAprotocol/protocol/commit/269aee9b3379941dfe7a79f4eb0435f580d0ac0e))
- **core:** add typescript types for core ([#2927](https://github.com/UMAprotocol/protocol/issues/2927)) ([3ba662f](https://github.com/UMAprotocol/protocol/commit/3ba662f99bb9d1c33b207457ce9fa6cb90336d98))
- **gas-rebate:** Rebate 9 ([#2948](https://github.com/UMAprotocol/protocol/issues/2948)) ([4bc5fcf](https://github.com/UMAprotocol/protocol/commit/4bc5fcf93b7526655fec75d8da6d3ab6c04f55cf))
- **version-management:** Update hard coded latest package versions in the bots to use 2.0 packages ([#2872](https://github.com/UMAprotocol/protocol/issues/2872)) ([b8225c5](https://github.com/UMAprotocol/protocol/commit/b8225c580ea48f58ef44aa308f966fbed5a99cf3))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/affiliates@1.1.0...@uma/affiliates@1.2.0) (2021-04-23)

### Bug Fixes

- **affilates:** properly use SHEET_TAB from env ([#2853](https://github.com/UMAprotocol/protocol/issues/2853)) ([e7cfd74](https://github.com/UMAprotocol/protocol/commit/e7cfd741fc3dbbf3e06b0f12e273b165219b5f80))
- **affiliates:** dapp minng issue/pr template and dapp mining emp version ([#2868](https://github.com/UMAprotocol/protocol/issues/2868)) ([6bd4e00](https://github.com/UMAprotocol/protocol/commit/6bd4e00bdfe648623f7ef7365e139f6e8074bc3b))
- **affiliates:** error process if no price found ([#2717](https://github.com/UMAprotocol/protocol/issues/2717)) ([5829952](https://github.com/UMAprotocol/protocol/commit/58299522f0119200b9e7e92389154d615136f1cd))
- **affiliates:** fix various issues found during last automation run ([#2805](https://github.com/UMAprotocol/protocol/issues/2805)) ([636c95e](https://github.com/UMAprotocol/protocol/commit/636c95efcb04f24e3249707795b6b2aa5252a550))
- **affiliates:** remove expired contracts from empWhitelist ([#2869](https://github.com/UMAprotocol/protocol/issues/2869)) ([48c290f](https://github.com/UMAprotocol/protocol/commit/48c290fd0600cbc35aad8c9193a31a1a692311de))
- **lm-payouts:** address wrong week number in YD-BTC ([#2855](https://github.com/UMAprotocol/protocol/issues/2855)) ([d1f5051](https://github.com/UMAprotocol/protocol/commit/d1f5051a53d1f28c28599ab224abf88165786b19))

### Features

- **gas-rebate:** Enable 2Key wallet overrides ([#2843](https://github.com/UMAprotocol/protocol/issues/2843)) ([175a4dc](https://github.com/UMAprotocol/protocol/commit/175a4dcc5bc98a8fd2ea5a596219e0baece89100))

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/affiliates@1.0.1...@uma/affiliates@1.1.0) (2021-03-16)

### Bug Fixes

- **affiliates:** explicitly set version of emp abi ([#2662](https://github.com/UMAprotocol/protocol/issues/2662)) ([9cf1e75](https://github.com/UMAprotocol/protocol/commit/9cf1e754a6bd9b1dc39040d9b590c4d468d0be8c))
- **affiliates:** winston logger configured to log only to stderr ([#2684](https://github.com/UMAprotocol/protocol/issues/2684)) ([63fc198](https://github.com/UMAprotocol/protocol/commit/63fc198e664a33d5f1290e1cc7539af1d229e72a))

### Features

- **affiliates:** add composable dev/dapp mining apps for future automation ([#2595](https://github.com/UMAprotocol/protocol/issues/2595)) ([859161f](https://github.com/UMAprotocol/protocol/commit/859161fa558424135b114f6bb82f2653eccc6ec5))
- **affiliates:** add minting lookback technique as dappmining v2 ([#2648](https://github.com/UMAprotocol/protocol/issues/2648)) ([bfad236](https://github.com/UMAprotocol/protocol/commit/bfad2360a5cd5ccfac2658ea56bce434efe18768))
- **affiliates:** add pr template generation and app ([#2663](https://github.com/UMAprotocol/protocol/issues/2663)) ([6727132](https://github.com/UMAprotocol/protocol/commit/672713252b03e764c8d1908bbec5eaf2a680fbc9))

## [1.0.1](https://github.com/UMAprotocol/protocol/compare/@uma/affiliates@1.0.0...@uma/affiliates@1.0.1) (2021-02-27)

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
