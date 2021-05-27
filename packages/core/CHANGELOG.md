# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [2.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.2.0...@uma/core@2.3.0) (2021-05-20)

### Bug Fixes

- **core:** fix typescript exports ([#2981](https://github.com/UMAprotocol/protocol/issues/2981)) ([b53757c](https://github.com/UMAprotocol/protocol/commit/b53757cd6e131aaca285ebccae625c7f5df88c4e))
- **core,affiliates:** log warning to console.error, make json piping easier to find issues ([#2913](https://github.com/UMAprotocol/protocol/issues/2913)) ([3679242](https://github.com/UMAprotocol/protocol/commit/3679242181b4134595048ecf8134c7916f8559fc))
- **ReserveCurrencyLiquidator:** improve how the contract handles reserve OR collateral currency shortfall ([#2896](https://github.com/UMAprotocol/protocol/issues/2896)) ([bfaf8e5](https://github.com/UMAprotocol/protocol/commit/bfaf8e53cfddce4463adf3751a1c999cfe361fd9))
- **Trader:** Post wargames changes ([#2955](https://github.com/UMAprotocol/protocol/issues/2955)) ([4acb0ea](https://github.com/UMAprotocol/protocol/commit/4acb0eabdae1513a7841bd2d2d00d81a26a9e89b))
- Add contract hash ([#2919](https://github.com/UMAprotocol/protocol/issues/2919)) ([17fdf6f](https://github.com/UMAprotocol/protocol/commit/17fdf6f9829c238868082627d1ea928eac7eb3f3))
- fixes \_minSponsorTokens description in contract docs ([#2710](https://github.com/UMAprotocol/protocol/issues/2710)) ([fa13bf5](https://github.com/UMAprotocol/protocol/commit/fa13bf57f90f3c66941eac4d43de5c02c7cb8a86))

### Features

- **core:** add SourceGovernor to hardhat deployment ([#2999](https://github.com/UMAprotocol/protocol/issues/2999)) ([73644b1](https://github.com/UMAprotocol/protocol/commit/73644b1794f89078dd5d185402f92d6b7bd14a92))
- Add Mainnet deployments for Beacon (L2<>L1) contracts + new hardhat features ([#2998](https://github.com/UMAprotocol/protocol/issues/2998)) ([0f2d295](https://github.com/UMAprotocol/protocol/commit/0f2d295d43b3f27b4f14962148d239e124796d6b))
- Deploy Polygon mainnet and testnet contracts + update helper scripts ([#2980](https://github.com/UMAprotocol/protocol/issues/2980)) ([4a4e4d3](https://github.com/UMAprotocol/protocol/commit/4a4e4d385d27937e3e3e5da0aa20cb5e5df90331))
- **chainbridge:** Demo script showing how cross-chain price request would work ([#2894](https://github.com/UMAprotocol/protocol/issues/2894)) ([d1cc34b](https://github.com/UMAprotocol/protocol/commit/d1cc34baa09eb4434c29e84646d1271df9d74d0a))
- **common:** Refactor HardhatConfig exported module ([#2960](https://github.com/UMAprotocol/protocol/issues/2960)) ([42a7b5c](https://github.com/UMAprotocol/protocol/commit/42a7b5c46ba2a03f29d7f54b555d7bcaa85129d8))
- **core:** add governor source and sink ([#2969](https://github.com/UMAprotocol/protocol/issues/2969)) ([ba19b22](https://github.com/UMAprotocol/protocol/commit/ba19b2297552ccecbf4d8d68df14e81e0a7cc868))
- **core:** add typescript types for core ([#2927](https://github.com/UMAprotocol/protocol/issues/2927)) ([3ba662f](https://github.com/UMAprotocol/protocol/commit/3ba662f99bb9d1c33b207457ce9fa6cb90336d98))
- **core:** updated solidity version to 0.8.x ([#2924](https://github.com/UMAprotocol/protocol/issues/2924)) ([5db0d71](https://github.com/UMAprotocol/protocol/commit/5db0d7178cd6a3c807db4586eeb22a16229e9213))
- **disputer:** single reserve currency disputer + unit tests ([#2970](https://github.com/UMAprotocol/protocol/issues/2970)) ([4eb065f](https://github.com/UMAprotocol/protocol/commit/4eb065fda0ca44aa5691f8de1c30343db3e27581))
- **L2:** Implement BeaconOracle designed for cross-chain PriceRequest communication ([#2903](https://github.com/UMAprotocol/protocol/issues/2903)) ([e0df36b](https://github.com/UMAprotocol/protocol/commit/e0df36be3765df77305db4980ea5dbc763ffbfa9))
- **lib:** add post-expiration price transformation fpl ([#2926](https://github.com/UMAprotocol/protocol/issues/2926)) ([8e5cfd6](https://github.com/UMAprotocol/protocol/commit/8e5cfd6f1ce019131f53e0bf41f8fe26f5b46eb1))
- **price-feeds:** add uniswap v3 price feed ([#2918](https://github.com/UMAprotocol/protocol/issues/2918)) ([d87066c](https://github.com/UMAprotocol/protocol/commit/d87066cac46b72b3d1a5e4734d8a7536c6a93da8))
- **range-trader:** add uniswap v3 support to uniswap broker ([#2928](https://github.com/UMAprotocol/protocol/issues/2928)) ([9d643e9](https://github.com/UMAprotocol/protocol/commit/9d643e98c87ffcf960aada56d21add769f61719b))
- **trader:** add uniswapv3 broker to trader ([#2942](https://github.com/UMAprotocol/protocol/issues/2942)) ([4612097](https://github.com/UMAprotocol/protocol/commit/4612097ead953b89daa6e237cdb6c704460025dd))
- Add hardhat deployment infrastructure ([#2950](https://github.com/UMAprotocol/protocol/issues/2950)) ([45c8851](https://github.com/UMAprotocol/protocol/commit/45c8851643407aeb3cd745f5dee923546658fa6f))
- **version-management:** Update hard coded latest package versions in the bots to use 2.0 packages ([#2872](https://github.com/UMAprotocol/protocol/issues/2872)) ([b8225c5](https://github.com/UMAprotocol/protocol/commit/b8225c580ea48f58ef44aa308f966fbed5a99cf3))

# [2.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@3.0.0...@uma/core@2.2.0) (2021-04-23)

### Features

- **FindContractVersion:** update FindContractVersion to build contract hashes during core build process ([#2873](https://github.com/UMAprotocol/protocol/issues/2873)) ([4e5a3bd](https://github.com/UMAprotocol/protocol/commit/4e5a3bddfb90b2e868bbd04274947b5bcf0eebb9))
- **scripts:** add WithdrawTokens for bot wallet consolidation ([#2874](https://github.com/UMAprotocol/protocol/issues/2874)) ([8be35c6](https://github.com/UMAprotocol/protocol/commit/8be35c6643220fcd365f9c90fe863b547ffa0ca0))

# [2.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.0.1...@uma/core@2.1.0) (2021-03-16)

### Bug Fixes

- **kovan:** update perp creator kovan address ([#2650](https://github.com/UMAprotocol/protocol/issues/2650)) ([6d2a0cb](https://github.com/UMAprotocol/protocol/commit/6d2a0cb89216a0d7a0d8d38d8af124b7d53fa1e0))

### Features

- **core:** ExecuteAdmin script can now execute multiple proposals ([#2618](https://github.com/UMAprotocol/protocol/issues/2618)) ([80988e5](https://github.com/UMAprotocol/protocol/commit/80988e53ab7e5d0e6a620cf1c004e59a6f9d803b))
- **core:** general improvements to claim rewards script ([#2647](https://github.com/UMAprotocol/protocol/issues/2647)) ([0e560fa](https://github.com/UMAprotocol/protocol/commit/0e560fa0537d065bc7a7823a50ea38f81e896953))
- **encoding:** add EncodeParams example script ([#2616](https://github.com/UMAprotocol/protocol/issues/2616)) ([8867ab9](https://github.com/UMAprotocol/protocol/commit/8867ab9d56473d7e897d6d6b00efcebfbab2c4b2))
- **financial-product-library:** Create a covered call financial product library ([#2668](https://github.com/UMAprotocol/protocol/issues/2668)) ([fbbad6f](https://github.com/UMAprotocol/protocol/commit/fbbad6f4632077cac36ad451f4b1325e32b56443))
- **KPI-Options:** add simple script for calculating UMA TVL ([#2682](https://github.com/UMAprotocol/protocol/issues/2682)) ([00f6dc3](https://github.com/UMAprotocol/protocol/commit/00f6dc3e3f6d93107f1183d5ddde1466dedb923c))
- **merkle-distributor:** Initial Merkle Distribution contract + unit tests + merkle root generator script ([#2598](https://github.com/UMAprotocol/protocol/issues/2598)) ([b23d7cf](https://github.com/UMAprotocol/protocol/commit/b23d7cf4792bfb02d2068eb390e8bd4540aac26f))
- **merkle-distributor:** Make claimMulti more generalized ([#2672](https://github.com/UMAprotocol/protocol/issues/2672)) ([c08f9de](https://github.com/UMAprotocol/protocol/commit/c08f9de95bd77a1af600ba4da4685be38f799d79))
- **trader:** add Ranger Trader, Exchange Adapter and initial trader implementation ([#2579](https://github.com/UMAprotocol/protocol/issues/2579)) ([8bc3dad](https://github.com/UMAprotocol/protocol/commit/8bc3dad7f34abd805ce24638415cdd7cca6314ed))
- **trader+DSProxyManager:** Few small tweaks after war games + useful DSProxy token management script ([#2656](https://github.com/UMAprotocol/protocol/issues/2656)) ([684f78f](https://github.com/UMAprotocol/protocol/commit/684f78f09e284466fac74c7388cab56d56aadd4c))
- **voter-dapp:** fetch users 2key contract state, and show migration banner if required ([#2640](https://github.com/UMAprotocol/protocol/issues/2640)) ([d04d7f1](https://github.com/UMAprotocol/protocol/commit/d04d7f134460bb1e2f52b71a169c186d5d60e282))

## [2.0.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.0.0...@uma/core@2.0.1) (2021-02-27)

**Note:** Version bump only for package @uma/core

# [2.0.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@1.2.0...@uma/core@2.0.0) (2021-02-26)

### Bug Fixes

- **dec-20-audit:** [H01] Bond penalty may not apply ([#2329](https://github.com/UMAprotocol/protocol/issues/2329)) ([953ae65](https://github.com/UMAprotocol/protocol/commit/953ae6519e2bae899e79fd8e0bd84da2afe4341e))
- **dec-20-audit:** [H01] fix optimistic oracle fee burning logic when final fee == 0 ([#2429](https://github.com/UMAprotocol/protocol/issues/2429)) ([32c27fe](https://github.com/UMAprotocol/protocol/commit/32c27fea08a84f9fd79fa9d0da8a538db9017402))
- **dec-20-audit:** [L02] Complex Repay Function ([#2309](https://github.com/UMAprotocol/protocol/issues/2309)) ([0f53b49](https://github.com/UMAprotocol/protocol/commit/0f53b4962a19e20db97d8276a7454ac3c40e7dab))
- **dec-20-audit:** [L03] Current config not update ([#2313](https://github.com/UMAprotocol/protocol/issues/2313)) ([b0f27cb](https://github.com/UMAprotocol/protocol/commit/b0f27cb9c8ae9aae48b5b66f89d3256ea9a7169b))
- **dec-20-audit:** [L04] Emergency shutdown defined at the wrong level ([#2310](https://github.com/UMAprotocol/protocol/issues/2310)) ([7d22206](https://github.com/UMAprotocol/protocol/commit/7d22206b3afb52195b6a763b308247e3457e120b))
- **dec-20-audit:** [L06] Inconsistent hasPrice determination ([#2319](https://github.com/UMAprotocol/protocol/issues/2319)) ([baa4332](https://github.com/UMAprotocol/protocol/commit/baa4332fbd41c164508be3bfc9f3ec218daf9263))
- **dec-20-audit:** [L07] Incorrect error message ([#2304](https://github.com/UMAprotocol/protocol/issues/2304)) ([5f59726](https://github.com/UMAprotocol/protocol/commit/5f5972623569d96e2ae631eaed1120013dabeaca))
- **dec-20-audit:** [M01] Lack of event emission after sensitive actions ([#2311](https://github.com/UMAprotocol/protocol/issues/2311)) ([0c732ec](https://github.com/UMAprotocol/protocol/commit/0c732ec3f48394d4eb1cb8049483f876e1c5c3e9))
- **dec-20-audit:** [N01] Add notes about Approximate compounding ([#2328](https://github.com/UMAprotocol/protocol/issues/2328)) ([a5070ae](https://github.com/UMAprotocol/protocol/commit/a5070ae0e8bf2f9deb56c9f81e74bcdb22a4c859))
- **dec-20-audit:** [N07] TODOs in code ([#2327](https://github.com/UMAprotocol/protocol/issues/2327)) ([26ef98f](https://github.com/UMAprotocol/protocol/commit/26ef98f5746832411b15082d32609c87197f7211))
- **dec-2020-audit:** [L05] Event missing emit keyword ([#2303](https://github.com/UMAprotocol/protocol/issues/2303)) ([0796d56](https://github.com/UMAprotocol/protocol/commit/0796d567edeee7150b9416d86ea67340989ebdc6))
- **dec-2020-audit:** [L08] Misleading comments ([#2308](https://github.com/UMAprotocol/protocol/issues/2308)) ([b0c68e0](https://github.com/UMAprotocol/protocol/commit/b0c68e09f9598e61b41b2398d2633fd1eb280cae))
- **dec-2020-audit:** [L09] Missing NatSpec comments ([#2305](https://github.com/UMAprotocol/protocol/issues/2305)) ([1aeb070](https://github.com/UMAprotocol/protocol/commit/1aeb070f7099ed83f89bfd5446128cb764557516))
- **dec-2020-audit:** [L10] Functions not failing early ([#2306](https://github.com/UMAprotocol/protocol/issues/2306)) ([9954a87](https://github.com/UMAprotocol/protocol/commit/9954a8731153dcb65fb70a6a045481fa64611326))
- **dec-2020-audit:** [L11] require non zero proposer/disputer address ([#2314](https://github.com/UMAprotocol/protocol/issues/2314)) ([e867fcd](https://github.com/UMAprotocol/protocol/commit/e867fcdf0cb5eabad72e5bfe040c596f2e874093))
- **dec-2020-audit:** [M02] Functions with unexpected side-effects ([#2318](https://github.com/UMAprotocol/protocol/issues/2318)) ([c3efdd6](https://github.com/UMAprotocol/protocol/commit/c3efdd695b3359d2a4a5a4096e80aa3c5789069f))
- **dec-2020-audit:** [N03] Incorrect filename ([#2317](https://github.com/UMAprotocol/protocol/issues/2317)) ([f6a9c9d](https://github.com/UMAprotocol/protocol/commit/f6a9c9d388e7959075fc441ab91637b6836ea76b))
- **dec-2020-audit:** [N08] Typographical errors ([#2312](https://github.com/UMAprotocol/protocol/issues/2312)) ([2028711](https://github.com/UMAprotocol/protocol/commit/202871133ad16ee39cf255cbf49d6df53a94fc8e))
- **dec-2020-audit:** [N09] Unnecessary imports ([#2315](https://github.com/UMAprotocol/protocol/issues/2315)) ([74d4d1b](https://github.com/UMAprotocol/protocol/commit/74d4d1bd9735ab5c071930f7faec662c3fca0463))
- **dec-2020-audit:** [N10] Unnecessary type cast ([#2316](https://github.com/UMAprotocol/protocol/issues/2316)) ([9ce936b](https://github.com/UMAprotocol/protocol/commit/9ce936bc0e96027099cc687fd6a766f0af1e4353))
- **deploy-script:** add version parameter to deployment script ([#2264](https://github.com/UMAprotocol/protocol/issues/2264)) ([c452750](https://github.com/UMAprotocol/protocol/commit/c452750a073488aa9b7caa86bb6206396412dcf9))
- **funding-rate-applier:** reset proposal time to 0 if proposal doesn't exist ([#2280](https://github.com/UMAprotocol/protocol/issues/2280)) ([1de80a3](https://github.com/UMAprotocol/protocol/commit/1de80a3728f17fb52ba636878fc2584e230e62e2))
- **oo:** update optimistic oracle address for kovan ([#2580](https://github.com/UMAprotocol/protocol/issues/2580)) ([dbb8d87](https://github.com/UMAprotocol/protocol/commit/dbb8d87a60092733ae4bbc93f0d4248b0b3a633a))
- **optimistic-oracle:** add future time require to optimistic oracle ([#2267](https://github.com/UMAprotocol/protocol/issues/2267)) ([1c08573](https://github.com/UMAprotocol/protocol/commit/1c08573c0f99a2753e350fded2920b044760e336))
- **scripts:** fix conversion in historical price feed script ([#2421](https://github.com/UMAprotocol/protocol/issues/2421)) ([5f09c03](https://github.com/UMAprotocol/protocol/commit/5f09c03a159f8ff3c3a4e0d759fd349515ec4253))
- **smart-contracts:** fixed audit PR typos ([#2422](https://github.com/UMAprotocol/protocol/issues/2422)) ([26dd9b9](https://github.com/UMAprotocol/protocol/commit/26dd9b9527b43571bb434b05cd1b4b1b53e7b5cf))
- **voter-dapp:** fix QA script ([#2430](https://github.com/UMAprotocol/protocol/issues/2430)) ([a137482](https://github.com/UMAprotocol/protocol/commit/a137482eec4dffb499f290590308de8d1d653693))
- **voting:** Limit length of ancillary data ([#2287](https://github.com/UMAprotocol/protocol/issues/2287)) ([86603d6](https://github.com/UMAprotocol/protocol/commit/86603d69dcbcc24e22cca5ff7705a70a4233d1e4))

### Features

- **bot-infrastructure:** add a generic DSProxy client ([#2559](https://github.com/UMAprotocol/protocol/issues/2559)) ([b275463](https://github.com/UMAprotocol/protocol/commit/b275463c0bfe2c3a45a5c049534b5acc3df58688))
- **core:** update vote simulate script to run on N proposols rather than just 1 ([#2302](https://github.com/UMAprotocol/protocol/issues/2302)) ([631504f](https://github.com/UMAprotocol/protocol/commit/631504f6beabf7e405aa6504a9399dc2d178742b))
- **disputer,liquidator,monitorfinancial-templates-lib:** rename all instances of emp to financialContract ([#2528](https://github.com/UMAprotocol/protocol/issues/2528)) ([e8c9b1e](https://github.com/UMAprotocol/protocol/commit/e8c9b1e06f1b88fbeea02858b5f5974f29a0d4a8))
- **emp:** financial product library to apply collateralization ratio transformation ([#2191](https://github.com/UMAprotocol/protocol/issues/2191)) ([2c7c11d](https://github.com/UMAprotocol/protocol/commit/2c7c11dbd107bb5f3093300d5d099ac3435ccceb))
- **emp:** financial product library to apply price identifier transformation ([#2221](https://github.com/UMAprotocol/protocol/issues/2221)) ([e6b63e5](https://github.com/UMAprotocol/protocol/commit/e6b63e583b48ea6fbfdc53caa2d4c9871b84c3d4))
- **emp:** replace liquidation and settlement logic from DVM to optimistic oracle ([#2242](https://github.com/UMAprotocol/protocol/issues/2242)) ([b54edc7](https://github.com/UMAprotocol/protocol/commit/b54edc735516fa83c64692f40e29bffaa212c453))
- **fee-payer:** Add gulp method to distribute excess collateral to all sponsors ([#2278](https://github.com/UMAprotocol/protocol/issues/2278)) ([47e1e75](https://github.com/UMAprotocol/protocol/commit/47e1e75e8a5ad04068aeb1b4e66d4a63351e423f))
- **financial-templates-lib:** add `DominationFinancePriceFeed` for BTCDOM, ALTDOM (UMIP-21) ([#2379](https://github.com/UMAprotocol/protocol/issues/2379)) ([e14cc7b](https://github.com/UMAprotocol/protocol/commit/e14cc7b361a008de713c31d15978b147ba5b31e1)), closes [#2378](https://github.com/UMAprotocol/protocol/issues/2378) [#2378](https://github.com/UMAprotocol/protocol/issues/2378) [#2378](https://github.com/UMAprotocol/protocol/issues/2378) [#2378](https://github.com/UMAprotocol/protocol/issues/2378) [#2378](https://github.com/UMAprotocol/protocol/issues/2378)
- **financial-templates-lib:** add Badger Sett default feeds ([#2576](https://github.com/UMAprotocol/protocol/issues/2576)) ([ca6e348](https://github.com/UMAprotocol/protocol/commit/ca6e3488e81e311187fd792ab54673568cd12c36))
- **financial-templates-lib:** add price feed for yearn-style vaults ([#2542](https://github.com/UMAprotocol/protocol/issues/2542)) ([9d62c32](https://github.com/UMAprotocol/protocol/commit/9d62c32958a36773cfbb29daef993e3bf3dd4f3f))
- **financial-templates-lib:** make getHistoricalPrice async ([#2493](https://github.com/UMAprotocol/protocol/issues/2493)) ([c91e11b](https://github.com/UMAprotocol/protocol/commit/c91e11bad264509efd4ef98044e448e6e5b8b5f0))
- **funding-rate-applier:** Don't update multiplier post-emergency shutdown ([#2199](https://github.com/UMAprotocol/protocol/issues/2199)) ([bccaefe](https://github.com/UMAprotocol/protocol/commit/bccaefe1ee4e187af03a91c3e84512d1d5353ba6))
- **get-all-sponsors:** Helper script to query all historical sponsors across all EMP's ([#2587](https://github.com/UMAprotocol/protocol/issues/2587)) ([095eb7c](https://github.com/UMAprotocol/protocol/commit/095eb7ccec33bc48cb3c8825b007175ee53fc17f))
- **kovan:** update kovan addresses ([#2535](https://github.com/UMAprotocol/protocol/issues/2535)) ([143fa9b](https://github.com/UMAprotocol/protocol/commit/143fa9ba653a66266621d0915a64b24fcc2e83cc))
- **optimistic-oracle:** add optimistic oracle ([#2212](https://github.com/UMAprotocol/protocol/issues/2212)) ([decaf5d](https://github.com/UMAprotocol/protocol/commit/decaf5d0058741eae7ea6eb2439b077b74d59b78))
- **optimistic-oracle:** integrate ancillary data into optimistic oracle ([#2239](https://github.com/UMAprotocol/protocol/issues/2239)) ([8e2d6a5](https://github.com/UMAprotocol/protocol/commit/8e2d6a5010472e73f5116939fa3c896ca76d83b0))
- **optimistic-oracle-keeper:** Add OptimisticOracleClient stub code ([#2330](https://github.com/UMAprotocol/protocol/issues/2330)) ([03173e2](https://github.com/UMAprotocol/protocol/commit/03173e2a0abe2f2ee4adfc9e5879df1e5ac82cf7))
- **optimistic-oracle-proposer:** Add dispute logic ([#2546](https://github.com/UMAprotocol/protocol/issues/2546)) ([8ef696e](https://github.com/UMAprotocol/protocol/commit/8ef696e2b02744a820893a3c646e47496488bdfd))
- **perp:** allow deployer to scale token value ([#2244](https://github.com/UMAprotocol/protocol/issues/2244)) ([1631ef7](https://github.com/UMAprotocol/protocol/commit/1631ef7ad29aaeba756ef3b9a01c667e1343df85))
- **perpetual:** Create ConfigStore to house mutable perpetual params (upgradeable after timelock) ([#2223](https://github.com/UMAprotocol/protocol/issues/2223)) ([9e8543b](https://github.com/UMAprotocol/protocol/commit/9e8543b5ebd884e4c2fb26e23751b7e8ebd6658c))
- **trader:** start trader package with typescript support ([#2484](https://github.com/UMAprotocol/protocol/issues/2484)) ([9fcc512](https://github.com/UMAprotocol/protocol/commit/9fcc5128fe3d684f4a87e2efa3d2e49934b96766))
- **trader:** uniswap trading broker ([#2545](https://github.com/UMAprotocol/protocol/issues/2545)) ([cd4ea94](https://github.com/UMAprotocol/protocol/commit/cd4ea94206e455d107c53c58b6fa8d4c6fa6920c))
- **yarn:** enable concurrency between test threads ([#2449](https://github.com/UMAprotocol/protocol/issues/2449)) ([b17b655](https://github.com/UMAprotocol/protocol/commit/b17b6558b714a9ac9f762dccdfa95764f9dfe1b9))

# [1.2.2](https://github.com/UMAprotocol/protocol/compare/@uma/core@1.2.1...@uma/core@1.2.2) (2020-12-22)

- **core:** Update hardhat test hooks ([57c91f9](https://github.com/UMAprotocol/protocol/commit/57c91f9ff15bffde91213d4d64b78187d7b74259))

# [1.2.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@1.2.0...@uma/core@1.2.1) (2020-12-18)

### Bug Fixes

- **core:** Fix liveness-reset feature and replace false-positive tests ([#2203](https://github.com/UMAprotocol/protocol/pull/2203))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@1.1.0...@uma/core@1.2.0) (2020-11-23)

### Bug Fixes

- **affiliates:** bump web3 version ([#2214](https://github.com/UMAprotocol/protocol/issues/2214)) ([41225bb](https://github.com/UMAprotocol/protocol/commit/41225bba6198a1134b0ea39972b8af940201fba0))

### Features

- **contracts:** add signed fixed point ([#2102](https://github.com/UMAprotocol/protocol/issues/2102)) ([3d11583](https://github.com/UMAprotocol/protocol/commit/3d1158309f58e22d95b92d2626097ac27fe71328))
- **core:** add legacy versioning ([#2181](https://github.com/UMAprotocol/protocol/issues/2181)) ([dc97320](https://github.com/UMAprotocol/protocol/commit/dc973209b9e4b32ed8a1f78b4e96dc9ab1785570))
- **emp:** financial product library to apply price transformation ([#2185](https://github.com/UMAprotocol/protocol/issues/2185)) ([5a7e2ec](https://github.com/UMAprotocol/protocol/commit/5a7e2ec25c5ecbc09397284839a553fee9d5636d))
- **pmp:** add funding rate store ([#2088](https://github.com/UMAprotocol/protocol/issues/2088)) ([ee9c8b8](https://github.com/UMAprotocol/protocol/commit/ee9c8b8dcdb557f5fff519449ed325b34a0a8c4e))
- **pmp:** integrate signed fixed point into funding rate applier ([#2107](https://github.com/UMAprotocol/protocol/issues/2107)) ([892042c](https://github.com/UMAprotocol/protocol/commit/892042c0f941252b95bb8f8aa6aa5e6735ffc46a))
- **scripts:** update UMIP collateral script ([#2146](https://github.com/UMAprotocol/protocol/issues/2146)) ([d745a80](https://github.com/UMAprotocol/protocol/commit/d745a8050430385ad9a028e4444680eac18f3fb7))

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@1.0.0...@uma/core@1.1.0) (2020-10-05)

### Bug Fixes

- **scripts:** slightly generalize deploy emp script to work in more envs ([#2057](https://github.com/UMAprotocol/protocol/issues/2057)) ([b0a6dd9](https://github.com/UMAprotocol/protocol/commit/b0a6dd99a534d0afff9a8708bf3ad6d74f371780))
- **umip-test:** Tweaks to EMPCreator Propose scripts Npai/update creator umip script ([#2000](https://github.com/UMAprotocol/protocol/issues/2000)) ([11d2232](https://github.com/UMAprotocol/protocol/commit/11d223259958ef26bcceded15cf6ab39ecc18242))

### Features

- **core:** add new voting contract deployment ([#2027](https://github.com/UMAprotocol/protocol/issues/2027)) ([2c0e0a1](https://github.com/UMAprotocol/protocol/commit/2c0e0a1e221b78ef1554fcbe38cc72f736a8c2d7))
- **emp:** add trimExcess function to send excess tokens ([#1975](https://github.com/UMAprotocol/protocol/issues/1975)) ([658f4d9](https://github.com/UMAprotocol/protocol/commit/658f4d90cff9ece8b05a2922dcb0f78e9b62c80d))
- **emp:** allow users to redeem and cancel withdraw requests after expiry ([#1968](https://github.com/UMAprotocol/protocol/issues/1968)) ([5643675](https://github.com/UMAprotocol/protocol/commit/5643675b035d404440de5f41c7c4e26a26a64350))
- **liquidity-mining:** liquidity rolling logic with split pools ([#2028](https://github.com/UMAprotocol/protocol/issues/2028)) ([9cf421b](https://github.com/UMAprotocol/protocol/commit/9cf421b083ee36508819c089c61472644675bd70))
- **scripts:** add script to batch reward retrieval for many voters at once ([#2014](https://github.com/UMAprotocol/protocol/issues/2014)) ([f41b43a](https://github.com/UMAprotocol/protocol/commit/f41b43af46afcc078b90cf877e85bc981f81475c))

# 1.0.0 (2020-09-15)

Initial Release!
