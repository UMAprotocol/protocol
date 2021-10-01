# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [2.8.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@2.7.0...@uma/common@2.8.0) (2021-10-01)

### Bug Fixes

- **price-identifier-utils:** Blacklist stablespread identifier ([#3416](https://github.com/UMAprotocol/protocol/issues/3416)) ([4031ca5](https://github.com/UMAprotocol/protocol/commit/4031ca5153bd91b0003ad526ddd83621ce48c455))
- **price-identifier-utils:** Blacklist uPunks identifiers from OO ([#3411](https://github.com/UMAprotocol/protocol/issues/3411)) ([f99813b](https://github.com/UMAprotocol/protocol/commit/f99813b4b1a76d46ff1eecd7f0c1d5352bff07a2))

### Features

- **core:** move all active scripts out of core and deprecate rest ([#3397](https://github.com/UMAprotocol/protocol/issues/3397)) ([f96b8c9](https://github.com/UMAprotocol/protocol/commit/f96b8c90b01002594bf44ac44f03f6d021bee460))

# [2.7.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@2.6.0...@uma/common@2.7.0) (2021-09-28)

### Bug Fixes

- **common:** fix issues with gckms typescript conversion ([#3297](https://github.com/UMAprotocol/protocol/issues/3297)) ([d10f9f6](https://github.com/UMAprotocol/protocol/commit/d10f9f6051f71d1549e6e3f279e86e18a924b718))
- **contracts-frontend:** remove surrounding quote characters from bytecode ([#3382](https://github.com/UMAprotocol/protocol/issues/3382)) ([db8b972](https://github.com/UMAprotocol/protocol/commit/db8b97271b61e9f425a09149d29c6d88a7b035f6))
- **fx-tunnel-relayer:** Bump maticjs version and update RelayerConfig ([#3352](https://github.com/UMAprotocol/protocol/issues/3352)) ([286265c](https://github.com/UMAprotocol/protocol/commit/286265ca371fb8016c96c2875f75f44b86430e01))
- **hardhat:** longer timeout for localhost ([#3319](https://github.com/UMAprotocol/protocol/issues/3319)) ([f83a417](https://github.com/UMAprotocol/protocol/commit/f83a417f6f36afac1095cfee535102fa04b3b74b))
- make unused variables an error in the typescript linter ([#3279](https://github.com/UMAprotocol/protocol/issues/3279)) ([1d26dfc](https://github.com/UMAprotocol/protocol/commit/1d26dfcd500cc4f84dc5672de0c8f9a7c5592e43))

### Features

- **ancillary:** first pass at an ancillary data parser in typescript ([#3320](https://github.com/UMAprotocol/protocol/issues/3320)) ([cc4f4ec](https://github.com/UMAprotocol/protocol/commit/cc4f4ecb24914da46ecab7b92a417a3a688b86dc))
- **common:** add getWeb3 by chainId ([#3358](https://github.com/UMAprotocol/protocol/issues/3358)) ([88f4a21](https://github.com/UMAprotocol/protocol/commit/88f4a21aff9892978fcc86c526894d7529d84e34))
- **common:** Ignore Optimistic Oracle requests for identifiers without price feeds ([#3338](https://github.com/UMAprotocol/protocol/issues/3338)) ([367395a](https://github.com/UMAprotocol/protocol/commit/367395abbe592c27059f87c0d00b6d8180e88f1c))
- **common:** Initial PR adding Optimism plugin to Hardhat config ([#3154](https://github.com/UMAprotocol/protocol/issues/3154)) ([9e6eb07](https://github.com/UMAprotocol/protocol/commit/9e6eb078096c2c986ecfc3d014b7e45ee5e4be54))
- **contracts-node:** export similar functions in contracts-node as contracts-frontend ([#3381](https://github.com/UMAprotocol/protocol/issues/3381)) ([57b8a9f](https://github.com/UMAprotocol/protocol/commit/57b8a9ff61a4ddb0fee2bd90c9247681e816b130))
- **core:** add tasks to manage artifacts and deployments ([#3229](https://github.com/UMAprotocol/protocol/issues/3229)) ([15a8f31](https://github.com/UMAprotocol/protocol/commit/15a8f31e3d3ce0df9b68b03ae56f8df789ae481a))
- **df-pf-configs:** Add GASETH-0921 default price feed config ([#3330](https://github.com/UMAprotocol/protocol/issues/3330)) ([e5d6002](https://github.com/UMAprotocol/protocol/commit/e5d600280094d2ffeca110a32727650b1a91f192))
- **financial-templates-lib:** convert src to typescript ([#3315](https://github.com/UMAprotocol/protocol/issues/3315)) ([3955d80](https://github.com/UMAprotocol/protocol/commit/3955d80038df1c54663a59b44d6e23bd09c7dcdc))
- **financial-templates-lib:** Stub for InsuredBridgePriceFeed ([#3356](https://github.com/UMAprotocol/protocol/issues/3356)) ([8abd36f](https://github.com/UMAprotocol/protocol/commit/8abd36f0c938d85985661245f2fd51f465601df4))
- **fx-tunnel-relayer:** Implement bot that can relay messages from Polygon ChildTunnel to Ethereum RootTunnel ([#3314](https://github.com/UMAprotocol/protocol/issues/3314)) ([dc1a6b0](https://github.com/UMAprotocol/protocol/commit/dc1a6b08202444e0c97ff84dc7b3cd3d66e2de48))
- **insured-bridge:** add arbitrum contract support to deposit box inheritance path ([#3385](https://github.com/UMAprotocol/protocol/issues/3385)) ([c77cce7](https://github.com/UMAprotocol/protocol/commit/c77cce7e5a0c37b9880cad045403f7b79dabc626))
- **insured-bridge:** Add realized LP fee pct computation ([#3373](https://github.com/UMAprotocol/protocol/issues/3373)) ([95abd8d](https://github.com/UMAprotocol/protocol/commit/95abd8d2d6e481a54e234bda6c7f8585babaa5eb))
- **insured-bridge:** Change internal relay data structures ([#3276](https://github.com/UMAprotocol/protocol/issues/3276)) ([07d083e](https://github.com/UMAprotocol/protocol/commit/07d083e1da49e94e5886c2ab1496a5b3bef3b1e0))
- **insured-bridge:** end to end testing stub ([#3255](https://github.com/UMAprotocol/protocol/issues/3255)) ([dda6f10](https://github.com/UMAprotocol/protocol/commit/dda6f108e6e5c023c0324988d79fc7eabef97039))
- **insured-bridge:** whitelist collateral cross-chain end to end tests ([#3269](https://github.com/UMAprotocol/protocol/issues/3269)) ([3780fb7](https://github.com/UMAprotocol/protocol/commit/3780fb7c00993dabde2b70b12dcc4033c024f446))
- **Insured-Bridge:** initial contract interfaces & smocking ([#3249](https://github.com/UMAprotocol/protocol/issues/3249)) ([aeea8ae](https://github.com/UMAprotocol/protocol/commit/aeea8ae30c6f7d5065e3857d25c75b8d69005d81))
- **insured-bridge-relayer:** Add additional relay logic, should relay and slow relay implementation ([#3359](https://github.com/UMAprotocol/protocol/issues/3359)) ([2a81888](https://github.com/UMAprotocol/protocol/commit/2a81888934594815a5d85a7358c357397083ea23))
- **insured-bridge-relayer:** Stub imports of L1 and L2 Bridge clients ([#3333](https://github.com/UMAprotocol/protocol/issues/3333)) ([1cf7925](https://github.com/UMAprotocol/protocol/commit/1cf792523acf9393b352df25d0428f48c22e31f1))
- Add cross-chain governance to UMIP collateral and identifier scripts ([#3234](https://github.com/UMAprotocol/protocol/issues/3234)) ([247a367](https://github.com/UMAprotocol/protocol/commit/247a367d7967a8673b05d2f4fb3e2bb4c35a2b02))
- Upgrade hardhat to 2.5 to be compatible with London hardfork ([#3248](https://github.com/UMAprotocol/protocol/issues/3248)) ([b1524ce](https://github.com/UMAprotocol/protocol/commit/b1524ce868fc17c7486872a8ef632497f757288d))
- **liquidator,disputer,monitor:** remove unnecessary unit conversion helpers in tests ([#3215](https://github.com/UMAprotocol/protocol/issues/3215)) ([77993f4](https://github.com/UMAprotocol/protocol/commit/77993f4d8ffa5ba821f66d5ff5d7c0cac7813009))

# [2.6.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@2.5.0...@uma/common@2.6.0) (2021-07-19)

### Features

- Update OptimisticOracle and Polygon Tunnel Addresses ([#3209](https://github.com/UMAprotocol/protocol/issues/3209)) ([6593fe5](https://github.com/UMAprotocol/protocol/commit/6593fe5aa1980c45ab570da049a9373e8f172c11))

# [2.5.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@2.4.0...@uma/common@2.5.0) (2021-07-15)

### Features

- **common:** add compiler overrides to allow most contracts to be gas optimized ([#3214](https://github.com/UMAprotocol/protocol/issues/3214)) ([0f82473](https://github.com/UMAprotocol/protocol/commit/0f8247337098e61a06ee8f5e303805198e63d767))
- **core:** refactor core tests to no longer use truffle ([#3202](https://github.com/UMAprotocol/protocol/issues/3202)) ([349401a](https://github.com/UMAprotocol/protocol/commit/349401a869e89f9b5583d34c1f282407dca021ac))
- **linter:** proposal to minimize object sizing ([#3222](https://github.com/UMAprotocol/protocol/issues/3222)) ([c925524](https://github.com/UMAprotocol/protocol/commit/c925524e888f73e1f694c4f9bf4ad1fb31e456bc))
- **liquidator,disputer,monitor:** deprecate legacy tests ([#3212](https://github.com/UMAprotocol/protocol/issues/3212)) ([498ecfc](https://github.com/UMAprotocol/protocol/commit/498ecfcfd3d767ceeb28e37f42ee5a1b7d4f0c83))

# [2.4.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@2.3.0...@uma/common@2.4.0) (2021-07-07)

### Bug Fixes

- common README ([#3149](https://github.com/UMAprotocol/protocol/issues/3149)) ([6aa9288](https://github.com/UMAprotocol/protocol/commit/6aa9288e8a1d008ee21672bce8c58d41c86028bd))

### Features

- **common:** add hardhat plugin to enhance web3 ease of use ([#3180](https://github.com/UMAprotocol/protocol/issues/3180)) ([5aa0335](https://github.com/UMAprotocol/protocol/commit/5aa0335aa8fd4d9ca31b7835a3ada1030e3fb0c3))
- **pf-configs:** Add default pf config for uSTONKS_0921 and add to OO ignore list ([#3183](https://github.com/UMAprotocol/protocol/issues/3183)) ([e1c4c24](https://github.com/UMAprotocol/protocol/commit/e1c4c2472e81c5911bbba13e4e06d4757b6f5ee6))
- **price-id-utils:** Ignore uTVL_KPI_UMA for OO proposals ([#3162](https://github.com/UMAprotocol/protocol/issues/3162)) ([bb07296](https://github.com/UMAprotocol/protocol/commit/bb07296ed00c46149762b059913076ad1587d219))

# [2.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@2.2.0...@uma/common@2.3.0) (2021-06-21)

### Bug Fixes

- **common:** explicitly require the hardhat etherscan verification plugin ([#3121](https://github.com/UMAprotocol/protocol/issues/3121)) ([3648597](https://github.com/UMAprotocol/protocol/commit/3648597eaf72bcb8840aacce1139692fd0fe0b78))
- **common:** Fix PublicNetworks ([#3033](https://github.com/UMAprotocol/protocol/issues/3033)) ([34fda80](https://github.com/UMAprotocol/protocol/commit/34fda805f0fad99b8ae3e53273814e08cc8ede5e))
- **common-ContractUtils:** Add web3 param injection to createContractObjectFromJson ([#3060](https://github.com/UMAprotocol/protocol/issues/3060)) ([805003a](https://github.com/UMAprotocol/protocol/commit/805003a94c01f2d8fb4556701382b0f4bbf26cd8))
- **TruffleConfig:** Increase networkCheckTimeout for slower connections ([#3029](https://github.com/UMAprotocol/protocol/issues/3029)) ([930960a](https://github.com/UMAprotocol/protocol/commit/930960aa774c90d4d00725e0928cd9ce9949b45c))

### Features

- **core:** add all truffle migrations to hardhat deploy ([#3068](https://github.com/UMAprotocol/protocol/issues/3068)) ([0004bd7](https://github.com/UMAprotocol/protocol/commit/0004bd7401211f628c80198be6ec99cff3156c36))
- **hardhat:** add default hardhat test fixture ([#3080](https://github.com/UMAprotocol/protocol/issues/3080)) ([4840786](https://github.com/UMAprotocol/protocol/commit/484078630dd0ced42c3ec3642995834123c8d7c0))
- **optimistic-oracle:** Enable universal blacklist ([#3127](https://github.com/UMAprotocol/protocol/issues/3127)) ([ad84c86](https://github.com/UMAprotocol/protocol/commit/ad84c861b5081d6b9844d62bf2d8373b049faedb))
- **polygon-amb:** Add Governor Tunnel contracts and unit tests ([#3089](https://github.com/UMAprotocol/protocol/issues/3089)) ([20a3866](https://github.com/UMAprotocol/protocol/commit/20a386693cc380827b3eedd7ff7382b15d7670f3))
- **polygon-fx-tunnel:** Add Oracle tunnel integrating with Polygon hosted Arbitrary Message Bridge ([#3054](https://github.com/UMAprotocol/protocol/issues/3054)) ([a3bf462](https://github.com/UMAprotocol/protocol/commit/a3bf46270787cbaae4ed2218f064b1217c153a50))
- **price-identifier-utils:** Ignore SPACEXLAUNCH price id OO requests ([#3126](https://github.com/UMAprotocol/protocol/issues/3126)) ([22e1dd1](https://github.com/UMAprotocol/protocol/commit/22e1dd15353e33a57914f1bccd3c447cb84cd5d7))
- Add hardhat task to migrate identifier whitelist to new contract ([#3046](https://github.com/UMAprotocol/protocol/issues/3046)) ([4e98402](https://github.com/UMAprotocol/protocol/commit/4e98402896fe50a5013c8decfaa0f261363ae33c))
- **run-transaction:** add multi EOA transaction runner to DSProxy bots ([#2961](https://github.com/UMAprotocol/protocol/issues/2961)) ([ab88497](https://github.com/UMAprotocol/protocol/commit/ab88497f180d72f1d9e8305fdeabf786f5883b7c))
- **Winston-logger:** add multiple escalation paths depending on message context ([#3042](https://github.com/UMAprotocol/protocol/issues/3042)) ([cd9412d](https://github.com/UMAprotocol/protocol/commit/cd9412d1bac4c0def413309423fe9ff8e487e4c1))

# [2.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@2.1.0...@uma/common@2.2.0) (2021-05-20)

### Bug Fixes

- **allowances:** Change default allowance value ([#2725](https://github.com/UMAprotocol/protocol/issues/2725)) ([94bcf9c](https://github.com/UMAprotocol/protocol/commit/94bcf9cba1cc258ac7f8536e12ddbbef37c9a4ce))
- **common:** duplicate key causing lint to fail ([#2719](https://github.com/UMAprotocol/protocol/issues/2719)) ([f53147d](https://github.com/UMAprotocol/protocol/commit/f53147d24b29f79f268aa4db5d32fcdb1c925284))
- **common:** fix build issue ([#3000](https://github.com/UMAprotocol/protocol/issues/3000)) ([c0b5f58](https://github.com/UMAprotocol/protocol/commit/c0b5f5832cf552959f855ba7df30bcbc52874f8d))
- **find-contract-version:** Add EMP and perp contract hashes ([#2791](https://github.com/UMAprotocol/protocol/issues/2791)) ([89aa209](https://github.com/UMAprotocol/protocol/commit/89aa2091f1e5ebcebe4f1ca1e78b9130f7948c01))
- **find-contract-version:** Fix the perpetual bytecode hash ([#2777](https://github.com/UMAprotocol/protocol/issues/2777)) ([02b70a2](https://github.com/UMAprotocol/protocol/commit/02b70a22ea8e8b9d03a0d467754a7a558b16998b))
- **package.json:** bump web3 to 1.3.5 ([#2982](https://github.com/UMAprotocol/protocol/issues/2982)) ([335d0d4](https://github.com/UMAprotocol/protocol/commit/335d0d47b4e1f90cd77ee28116f6d06da83e8865))
- **trader & atomic liquidator:** add wait for block to be mined util to address slow node updates ([#2871](https://github.com/UMAprotocol/protocol/issues/2871)) ([0106a8d](https://github.com/UMAprotocol/protocol/commit/0106a8dc22c26ee3d7aaf777ed12b6d894e88863))

### Features

- Add Mainnet deployments for Beacon (L2<>L1) contracts + new hardhat features ([#2998](https://github.com/UMAprotocol/protocol/issues/2998)) ([0f2d295](https://github.com/UMAprotocol/protocol/commit/0f2d295d43b3f27b4f14962148d239e124796d6b))
- Deploy Polygon mainnet and testnet contracts + update helper scripts ([#2980](https://github.com/UMAprotocol/protocol/issues/2980)) ([4a4e4d3](https://github.com/UMAprotocol/protocol/commit/4a4e4d385d27937e3e3e5da0aa20cb5e5df90331))
- **trader:** add uniswapv3 broker to trader ([#2942](https://github.com/UMAprotocol/protocol/issues/2942)) ([4612097](https://github.com/UMAprotocol/protocol/commit/4612097ead953b89daa6e237cdb6c704460025dd))
- Add polygon networks to truffle and hardhat configs ([#2973](https://github.com/UMAprotocol/protocol/issues/2973)) ([24be128](https://github.com/UMAprotocol/protocol/commit/24be12837b51bdf81c1e3eba0eaea2041437a410))
- **common:** Refactor HardhatConfig exported module ([#2960](https://github.com/UMAprotocol/protocol/issues/2960)) ([42a7b5c](https://github.com/UMAprotocol/protocol/commit/42a7b5c46ba2a03f29d7f54b555d7bcaa85129d8))
- Add hardhat deployment infrastructure ([#2950](https://github.com/UMAprotocol/protocol/issues/2950)) ([45c8851](https://github.com/UMAprotocol/protocol/commit/45c8851643407aeb3cd745f5dee923546658fa6f))
- **common:** add retry provider ([#2907](https://github.com/UMAprotocol/protocol/issues/2907)) ([528f5df](https://github.com/UMAprotocol/protocol/commit/528f5df3d7c81da530e017c3d2dc1e37ff2bd96c))
- **core:** updated solidity version to 0.8.x ([#2924](https://github.com/UMAprotocol/protocol/issues/2924)) ([5db0d71](https://github.com/UMAprotocol/protocol/commit/5db0d7178cd6a3c807db4586eeb22a16229e9213))
- **financial-product-library:** Create a KPI Options financial product library ([#2768](https://github.com/UMAprotocol/protocol/issues/2768)) ([4648458](https://github.com/UMAprotocol/protocol/commit/464845861cb0781dfc31196cdd78c34bc9d8ba57))
- **financial-templates-lib:** Add default price feed configs for XSUSHIUSD, BALUSD and uSTONKS_JUN21 ([#2876](https://github.com/UMAprotocol/protocol/issues/2876)) ([709f23a](https://github.com/UMAprotocol/protocol/commit/709f23a2b8827bcab8c849507ac799de0ffb01d1))
- **find-contract-verion:** add back perpetual hash ([#2827](https://github.com/UMAprotocol/protocol/issues/2827)) ([7976f92](https://github.com/UMAprotocol/protocol/commit/7976f927fb8e6266a30fd47df19d989fdc23ad7d))
- **FindContractVersion:** update FindContractVersion to build contract hashes during core build process ([#2873](https://github.com/UMAprotocol/protocol/issues/2873)) ([4e5a3bd](https://github.com/UMAprotocol/protocol/commit/4e5a3bddfb90b2e868bbd04274947b5bcf0eebb9))
- **L2:** Implement BeaconOracle designed for cross-chain PriceRequest communication ([#2903](https://github.com/UMAprotocol/protocol/issues/2903)) ([e0df36b](https://github.com/UMAprotocol/protocol/commit/e0df36be3765df77305db4980ea5dbc763ffbfa9))
- **liquidation-reserve-currency:** add reserve currency liquidator to bots and refine smart contract ([#2775](https://github.com/UMAprotocol/protocol/issues/2775)) ([0eea3fb](https://github.com/UMAprotocol/protocol/commit/0eea3fbb610f74694c22ca36f6902faf3fa9092b))
- **liquidator:** remove one inch intergration ([#2756](https://github.com/UMAprotocol/protocol/issues/2756)) ([03e20c0](https://github.com/UMAprotocol/protocol/commit/03e20c09a6a2e1ced754507b64ebfb67ee812c75))
- **optimistic-oracle-proposer:** Blacklist identifiers to skip post-expiry ([#2826](https://github.com/UMAprotocol/protocol/issues/2826)) ([0de392f](https://github.com/UMAprotocol/protocol/commit/0de392f18bf0f3e5019c118996ebca771ebb2aa7))
- **packages:** update version of truffle-ledger-provider to avoid libudev ([#2690](https://github.com/UMAprotocol/protocol/issues/2690)) ([69b87e9](https://github.com/UMAprotocol/protocol/commit/69b87e98283b6970375358010d906f55fa29dd9b))
- **run-transaction-helper:** Move ynatm functionality into runTransaction helper ([#2804](https://github.com/UMAprotocol/protocol/issues/2804)) ([cd3f3ef](https://github.com/UMAprotocol/protocol/commit/cd3f3ef0c96be742a2a585a957db2f884a234744))
- **scripts:** improve scripts for running Kovan EMP war games ([#2605](https://github.com/UMAprotocol/protocol/issues/2605)) ([0ddb8db](https://github.com/UMAprotocol/protocol/commit/0ddb8db66af688b4ade346a6738aba49d766db81))
- **version-management:** Update hard coded latest package versions in the bots to use 2.0 packages ([#2872](https://github.com/UMAprotocol/protocol/issues/2872)) ([b8225c5](https://github.com/UMAprotocol/protocol/commit/b8225c580ea48f58ef44aa308f966fbed5a99cf3))

# [2.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@2.0.1...@uma/common@2.1.0) (2021-03-16)

### Bug Fixes

- **contract-versions:** Add mainnet contract hash ([#2636](https://github.com/UMAprotocol/protocol/issues/2636)) ([8a40a88](https://github.com/UMAprotocol/protocol/commit/8a40a88fa5440b35d8f7b2040918f45a4062ebe1))
- **PriceIdentifierUtils:** Remove identifiers that should be scaled to 18 decimals ([#2574](https://github.com/UMAprotocol/protocol/issues/2574)) ([898a230](https://github.com/UMAprotocol/protocol/commit/898a2308f0d8bef435e4c90ec13d292f98faed5c))

### Features

- **provider-utils:** enable network parameterization ([#2689](https://github.com/UMAprotocol/protocol/issues/2689)) ([c6e5572](https://github.com/UMAprotocol/protocol/commit/c6e55725fd1a0a9acb0b3a75eb85dbf50f986bd4))

## [2.0.1](https://github.com/UMAprotocol/protocol/compare/@uma/common@2.0.0...@uma/common@2.0.1) (2021-02-27)

### Bug Fixes

- **common:** missing required file in common ([#2608](https://github.com/UMAprotocol/protocol/issues/2608)) ([9850c11](https://github.com/UMAprotocol/protocol/commit/9850c11667655042b76bc77b7edf9bca6eeebb61))

# [2.0.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@1.1.0...@uma/common@2.0.0) (2021-02-26)

### Bug Fixes

- **common:** add missing dependency to fix tests ([#2562](https://github.com/UMAprotocol/protocol/issues/2562)) ([5f9ae6c](https://github.com/UMAprotocol/protocol/commit/5f9ae6cb3f329883cda0a9fa86b5b5f7db6930b8))
- **FindContractVersion:** address inconsistent provider behavior ([#2502](https://github.com/UMAprotocol/protocol/issues/2502)) ([3bf1d31](https://github.com/UMAprotocol/protocol/commit/3bf1d31ff16576a5e5bae3034a42e3acb5394228))
- **FindContractVersion:** address web3.js inconsistant production behaviour with ethers.js ([#2477](https://github.com/UMAprotocol/protocol/issues/2477)) ([0ae44df](https://github.com/UMAprotocol/protocol/commit/0ae44dfa098fc9a7453906cf9130b47740e5ed75))
- **PriceIdentifierUtils:** Add correct AMPLUSD decimals ([#2482](https://github.com/UMAprotocol/protocol/issues/2482)) ([06cd228](https://github.com/UMAprotocol/protocol/commit/06cd228a36294988d94e1219bad12b1c33f44242))

### Features

- **2291:** set higher fromBlock for EMP client, and getFromBlock function for override ([#2360](https://github.com/UMAprotocol/protocol/issues/2360)) ([cb44b67](https://github.com/UMAprotocol/protocol/commit/cb44b67829c5887b10214405db00c19a91b89616))
- **bot-infrastructure:** add a generic DSProxy client ([#2559](https://github.com/UMAprotocol/protocol/issues/2559)) ([b275463](https://github.com/UMAprotocol/protocol/commit/b275463c0bfe2c3a45a5c049534b5acc3df58688))
- **bot-tests:** generalize muli-version testing ([#2448](https://github.com/UMAprotocol/protocol/issues/2448)) ([95fb302](https://github.com/UMAprotocol/protocol/commit/95fb302f5b370658adced9cf23c3f897fe00d7d5))
- **disputer:** add perp support to disputer ([#2453](https://github.com/UMAprotocol/protocol/issues/2453)) ([c79f347](https://github.com/UMAprotocol/protocol/commit/c79f3476fee07736257582f7d92eb7c95932c300))
- **financial-templates-lib:** add BlockFinder ([#2512](https://github.com/UMAprotocol/protocol/issues/2512)) ([6afefb6](https://github.com/UMAprotocol/protocol/commit/6afefb62598767eeec92a0249baf726f246239aa))
- **optimistic-oracle:** add optimistic oracle ([#2212](https://github.com/UMAprotocol/protocol/issues/2212)) ([decaf5d](https://github.com/UMAprotocol/protocol/commit/decaf5d0058741eae7ea6eb2439b077b74d59b78))
- **optimistic-oracle-keeper:** Add functionality to propose prices for price requests ([#2505](https://github.com/UMAprotocol/protocol/issues/2505)) ([cc71ea5](https://github.com/UMAprotocol/protocol/commit/cc71ea56ef6fd944232f9e8f6a7e190ce2ab250d))
- **trader:** start trader package with typescript support ([#2484](https://github.com/UMAprotocol/protocol/issues/2484)) ([9fcc512](https://github.com/UMAprotocol/protocol/commit/9fcc5128fe3d684f4a87e2efa3d2e49934b96766))

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/common@1.0.1...@uma/common@1.1.0) (2020-11-23)

### Bug Fixes

- **affiliates:** bump web3 version ([#2214](https://github.com/UMAprotocol/protocol/issues/2214)) ([41225bb](https://github.com/UMAprotocol/protocol/commit/41225bba6198a1134b0ea39972b8af940201fba0))

### Features

- **liquidator:** adds in whale withdraw defense strategy ([#2063](https://github.com/UMAprotocol/protocol/issues/2063)) ([9ccfd3f](https://github.com/UMAprotocol/protocol/commit/9ccfd3f00fd962363214664e244e8227b4ebf2f8))

## [1.0.1](https://github.com/UMAprotocol/protocol/compare/@uma/common@1.0.0...@uma/common@1.0.1) (2020-10-05)

**Note:** Version bump only for package @uma/common

# 1.0.0 (2020-09-15)

Initial Release!
