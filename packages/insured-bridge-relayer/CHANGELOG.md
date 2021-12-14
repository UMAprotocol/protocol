# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.12.3](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.12.2...@uma/insured-bridge-relayer@1.12.3) (2021-12-13)

### Bug Fixes

- **slack-logger/relay-logs:** small logger fixes ([#3685](https://github.com/UMAprotocol/protocol/issues/3685)) ([06ba1e4](https://github.com/UMAprotocol/protocol/commit/06ba1e40d04135b6f73e6ac4048cdd16d1b8ce54))

## [1.12.2](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.12.0...@uma/insured-bridge-relayer@1.12.2) (2021-12-07)

**Note:** Version bump only for package @uma/insured-bridge-relayer

## [1.12.1](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.12.0...@uma/insured-bridge-relayer@1.12.1) (2021-12-07)

**Note:** Version bump only for package @uma/insured-bridge-relayer

# [1.12.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.11.0...@uma/insured-bridge-relayer@1.12.0) (2021-12-06)

### Bug Fixes

- **across-bots:** address issues found when launching on optimism regarding multiple chainIds ([#3637](https://github.com/UMAprotocol/protocol/issues/3637)) ([962b946](https://github.com/UMAprotocol/protocol/commit/962b9467efd4f251762cc50441ad42e27ac16dcf))
- **across-relayer:** Key BridgePool.l2Tokens by chain ID ([#3639](https://github.com/UMAprotocol/protocol/issues/3639)) ([78f0262](https://github.com/UMAprotocol/protocol/commit/78f0262ce16feafe4909095fd41e8f951f3f06ba))
- **across-relayer:** Key L1 client dictionary by checksummed addresses ([#3644](https://github.com/UMAprotocol/protocol/issues/3644)) ([184000e](https://github.com/UMAprotocol/protocol/commit/184000e28a44a2dd95aa73ae381f9075856de080))
- **across-relayer:** Prune L1 token whitelist using L1 contract state instead of L2 event data ([#3648](https://github.com/UMAprotocol/protocol/issues/3648)) ([4e26423](https://github.com/UMAprotocol/protocol/commit/4e2642374c1edaaa00be07e38fa4eb534383449f))
- **across-relayer:** Skipped relay should add `undefined` to disputeRelay array, not `null` ([#3640](https://github.com/UMAprotocol/protocol/issues/3640)) ([e85d58b](https://github.com/UMAprotocol/protocol/commit/e85d58b7ec855b1be2842f553f476968254d92b2))

### Features

- **across:** add sync caller helper ([#3657](https://github.com/UMAprotocol/protocol/issues/3657)) ([321b5d3](https://github.com/UMAprotocol/protocol/commit/321b5d3a893d2b49d8179a99dd0e3842c3d1bde1))
- **logging:** add error logging on disputes and slow relay. Decode OO ancillary data ([#3635](https://github.com/UMAprotocol/protocol/issues/3635)) ([8022ff7](https://github.com/UMAprotocol/protocol/commit/8022ff70b399589c058dc676a33fa43430f0521d))
- **transaction-manager:** enable early return from runTransaction method ([#3609](https://github.com/UMAprotocol/protocol/issues/3609)) ([fcfe27a](https://github.com/UMAprotocol/protocol/commit/fcfe27a21c1b34ae6683534e6059e186684b1819))

# [1.11.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.10.0...@uma/insured-bridge-relayer@1.11.0) (2021-11-18)

### Features

- **across:** Add Badger pool ([#3603](https://github.com/UMAprotocol/protocol/issues/3603)) ([f61a064](https://github.com/UMAprotocol/protocol/commit/f61a064abb599175cc7e9b5c225bbd4eb3a09d04))
- **across-relayer:** enable batch disputing ([#3608](https://github.com/UMAprotocol/protocol/issues/3608)) ([29713da](https://github.com/UMAprotocol/protocol/commit/29713da6d361f21323d7d752f043e0a967cdcf64))
- **across-relayer:** sort by deposit size when disputing ([#3607](https://github.com/UMAprotocol/protocol/issues/3607)) ([7fc75fc](https://github.com/UMAprotocol/protocol/commit/7fc75fc01afc34d4f678532aeb864592e0eab5c1))

# [1.10.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.9.1...@uma/insured-bridge-relayer@1.10.0) (2021-11-11)

### Bug Fixes

- **across-relayer:** Two small patches ([#3593](https://github.com/UMAprotocol/protocol/issues/3593)) ([fe27d33](https://github.com/UMAprotocol/protocol/commit/fe27d333ef3ff72f16e757d2e75edb309809e2f5))

### Features

- **across-relayer:** Add ability to finalize L2->L1 transfer actions ([#3585](https://github.com/UMAprotocol/protocol/issues/3585)) ([e41ab0d](https://github.com/UMAprotocol/protocol/commit/e41ab0d60d5598a6af71405db94f4d2e8479a004))

## [1.9.1](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.9.0...@uma/insured-bridge-relayer@1.9.1) (2021-11-09)

### Bug Fixes

- **across-relayer:** Deposit search should start at BridgeDeposit block height, not BridgePool block height ([#3566](https://github.com/UMAprotocol/protocol/issues/3566)) ([665e78e](https://github.com/UMAprotocol/protocol/commit/665e78eb56cdb4ce2fc8736c6b5441dbbc79f282))
- **across-relayer:** Finalizer can settle multiple L1 tokens ([#3580](https://github.com/UMAprotocol/protocol/issues/3580)) ([aa36f1f](https://github.com/UMAprotocol/protocol/commit/aa36f1f1426a7379b36ffab0236c9fde61ea291a))
- **across-relayer:** tiny logging fix to improve logging ([#3584](https://github.com/UMAprotocol/protocol/issues/3584)) ([2492e60](https://github.com/UMAprotocol/protocol/commit/2492e60218a5a77cb12dd9dd9165aad565e6fec1))
- **L1-client:** optimize how the L1 client fetches some internal data ([#3588](https://github.com/UMAprotocol/protocol/issues/3588)) ([fa2c538](https://github.com/UMAprotocol/protocol/commit/fa2c538c4af638a0e304e013de1f5d66b81842cc))

# [1.9.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.8.0...@uma/insured-bridge-relayer@1.9.0) (2021-11-05)

### Bug Fixes

- **insured-bridge-relayer:** Key deployTimestamps by lowercase addresses ([#3557](https://github.com/UMAprotocol/protocol/issues/3557)) ([fc14de5](https://github.com/UMAprotocol/protocol/commit/fc14de5abedc72c4890e9f354463438c1d2f3164))

### Features

- **across-relayer:** Enable batch relays via multicall and improve log production ([#3559](https://github.com/UMAprotocol/protocol/issues/3559)) ([f1cfecc](https://github.com/UMAprotocol/protocol/commit/f1cfecc3d085d5be86a4557682b0ae931cbb24b5))

# [1.8.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.7.0...@uma/insured-bridge-relayer@1.8.0) (2021-11-02)

### Bug Fixes

- **across-bots:** Address issue where relayer produces an error after every relay ([#3544](https://github.com/UMAprotocol/protocol/issues/3544)) ([0d84e58](https://github.com/UMAprotocol/protocol/commit/0d84e5861f4fa51d03ea6e3d8baee9edb13398d3))
- **BridgeAdmin:** Fix typographical in contracts ([#3540](https://github.com/UMAprotocol/protocol/issues/3540)) ([e70a342](https://github.com/UMAprotocol/protocol/commit/e70a34282a0a6a3f92ffe1e88d4ea96fa4f3f54c))

### Features

- use faster block finder ([#3522](https://github.com/UMAprotocol/protocol/issues/3522)) ([d0336ef](https://github.com/UMAprotocol/protocol/commit/d0336ef86d16dc28607a4693356f8c9e7c8e457a))

# [1.7.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.6.0...@uma/insured-bridge-relayer@1.7.0) (2021-10-29)

### Bug Fixes

- **GasEstimator:** protocol upgrade for EIP1559 ([#3306](https://github.com/UMAprotocol/protocol/issues/3306)) ([8245391](https://github.com/UMAprotocol/protocol/commit/8245391ee07dca37be3c52a9a9ba47ed4d63f6f7))
- **insured-bridge-relayer:** Dispute any relay with non-whitelisted chain ID even if not using same chain ID as L2 client ([#3511](https://github.com/UMAprotocol/protocol/issues/3511)) ([557aeb9](https://github.com/UMAprotocol/protocol/commit/557aeb94cead79854ffc49b56dcab0cd52c39b48))
- **insured-bridge-relayer:** Handle case where computing realized LP fee % fails ([#3504](https://github.com/UMAprotocol/protocol/issues/3504)) ([9c69a9d](https://github.com/UMAprotocol/protocol/commit/9c69a9d3f545741820fbf73d5436b7f9f30aa8e0))
- **insured-bridge-relayer:** Key deposits by deposit hash instead of deposit ID ([#3510](https://github.com/UMAprotocol/protocol/issues/3510)) ([d75c342](https://github.com/UMAprotocol/protocol/commit/d75c34279c89f8d880416ef765cd36c0dc9b97b5))

### Features

- **create-price-feed:** Add InsuredBridge ([#3388](https://github.com/UMAprotocol/protocol/issues/3388)) ([4dd8116](https://github.com/UMAprotocol/protocol/commit/4dd811635fd5647bf5916eb366daf5d613f3856c))

# [1.6.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.5.0...@uma/insured-bridge-relayer@1.6.0) (2021-10-27)

### Bug Fixes

- **insured-bridge-relayer:** Do not fetch l1Token from DepositRelayed log ([#3505](https://github.com/UMAprotocol/protocol/issues/3505)) ([8e5ab9e](https://github.com/UMAprotocol/protocol/commit/8e5ab9e8d120e689197157ac576d535a24e443b5))
- **insured-bridge-relayer:** Fix usage of Logger ([#3483](https://github.com/UMAprotocol/protocol/issues/3483)) ([09c9b72](https://github.com/UMAprotocol/protocol/commit/09c9b720cdb9feb956ba4201f530a5134b4a235f))

### Features

- **across:** Add Disputer mode to bot ([#3474](https://github.com/UMAprotocol/protocol/issues/3474)) ([e2e8c6b](https://github.com/UMAprotocol/protocol/commit/e2e8c6bf1ee7432dc7dfe951f4de7ec95f3e1f2d))

# [1.5.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.4.0...@uma/insured-bridge-relayer@1.5.0) (2021-10-19)

### Features

- **across-bots:** add ability for relayer bot to finalize relays ([#3464](https://github.com/UMAprotocol/protocol/issues/3464)) ([0f9c26d](https://github.com/UMAprotocol/protocol/commit/0f9c26d8bda06aac0d08b5797e0bec2f2168c015))
- **insured-bridge:** Block instant relays post-expiry and change relayDeposit interface to match relayAndSpeedUp ([#3458](https://github.com/UMAprotocol/protocol/issues/3458)) ([25ac3c0](https://github.com/UMAprotocol/protocol/commit/25ac3c00be8afb33a6c6e134509f068699591025))
- **insured-bridge:** Update Arbitrum messenger contracts after e2e tests ([#3448](https://github.com/UMAprotocol/protocol/issues/3448)) ([fd2f9c5](https://github.com/UMAprotocol/protocol/commit/fd2f9c5976300cd3c82801884ef14abf890e1461))

# [1.4.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.3.0...@uma/insured-bridge-relayer@1.4.0) (2021-10-08)

### Bug Fixes

- **insured-bridge:** fix whitelist to work with multiple L2 chains ([#3436](https://github.com/UMAprotocol/protocol/issues/3436)) ([58f727e](https://github.com/UMAprotocol/protocol/commit/58f727e2cb96fa828385835e562f691d7c4fd6e3))
- **insured-bridge:** Instant relayer should only receive refund iff they sped up valid relay ([#3425](https://github.com/UMAprotocol/protocol/issues/3425)) ([27d3634](https://github.com/UMAprotocol/protocol/commit/27d3634c6fbe9cf1eb8419641d0dbddf9cb56569))

### Features

- **insured-bridge:** add Eth->Weth support on deposits and withdraws ([#3440](https://github.com/UMAprotocol/protocol/issues/3440)) ([33d01d4](https://github.com/UMAprotocol/protocol/commit/33d01d471437e1ab6861e4545ea4bb3895fd4d74))
- **insured-bridge:** Integrate SkinnyOptimisticOracle with BridgePool ([#3430](https://github.com/UMAprotocol/protocol/issues/3430)) ([554641c](https://github.com/UMAprotocol/protocol/commit/554641c25d79c4331e08a757f000621d55fe2675))
- **insured-bridge:** Reduce function gas costs by storing hash of Relay params instead of full struct ([#3438](https://github.com/UMAprotocol/protocol/issues/3438)) ([ff231b4](https://github.com/UMAprotocol/protocol/commit/ff231b4df83ede216c0cb431d32e6920b36aec7d))

# [1.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.2.0...@uma/insured-bridge-relayer@1.3.0) (2021-10-01)

### Features

- **insured-bridge:** War games 1 ([#3399](https://github.com/UMAprotocol/protocol/issues/3399)) ([8773494](https://github.com/UMAprotocol/protocol/commit/8773494d29cf0428ca6d65f0272b135ba3dafcbf))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.1.0...@uma/insured-bridge-relayer@1.2.0) (2021-10-01)

### Features

- **insured-bridge:** Remove deposit contract from relay params ([#3401](https://github.com/UMAprotocol/protocol/issues/3401)) ([c607211](https://github.com/UMAprotocol/protocol/commit/c607211b0cf0653ad5bb128042515b27efa492a3))

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/@uma/insured-bridge-relayer@1.0.0...@uma/insured-bridge-relayer@1.1.0) (2021-09-28)

### Features

- **insured-bridge:** Add ArbitrumMessenger ([#3392](https://github.com/UMAprotocol/protocol/issues/3392)) ([fa56d3c](https://github.com/UMAprotocol/protocol/commit/fa56d3c02c40fc72fe2288a286ea7849f14754f2))
- **insured-bridge:** Add realized LP fee pct computation ([#3373](https://github.com/UMAprotocol/protocol/issues/3373)) ([95abd8d](https://github.com/UMAprotocol/protocol/commit/95abd8d2d6e481a54e234bda6c7f8585babaa5eb))
- **insured-bridge:** BridgeAdmin supports multiple L2s ([#3390](https://github.com/UMAprotocol/protocol/issues/3390)) ([96cb0a4](https://github.com/UMAprotocol/protocol/commit/96cb0a4afd9b2f78a44d2cb481ec25c6e069cf58))
- **insured-bridge:** Modify relay ancillary data to enhance off-chain bots ([#3363](https://github.com/UMAprotocol/protocol/issues/3363)) ([1c2ea19](https://github.com/UMAprotocol/protocol/commit/1c2ea19af1d586c79ba0fe51a7be6cdbd25bea7c))
- **insured-bridge:** Refactoring for gas savings ([#3369](https://github.com/UMAprotocol/protocol/issues/3369)) ([1568cd9](https://github.com/UMAprotocol/protocol/commit/1568cd91406f38f8b69ba48753f1a7d094b8ea18))
- **insured-bridge-bot:** instant relay logic ([#3364](https://github.com/UMAprotocol/protocol/issues/3364)) ([65600ae](https://github.com/UMAprotocol/protocol/commit/65600aec5f53ae17792b4191a8dd03a03deceba7))
- **insured-bridge-relayer:** Add additional relay logic, should relay and slow relay implementation ([#3359](https://github.com/UMAprotocol/protocol/issues/3359)) ([2a81888](https://github.com/UMAprotocol/protocol/commit/2a81888934594815a5d85a7358c357397083ea23))
- **insured-bridge-relayer:** add speed up bridging and additional standardization ([#3362](https://github.com/UMAprotocol/protocol/issues/3362)) ([dfb578a](https://github.com/UMAprotocol/protocol/commit/dfb578a1008a4954534fa87b3f7752ef3c8fa9b1))
- **insured-bridge-relayer:** initial relayer logic implementation ([#3351](https://github.com/UMAprotocol/protocol/issues/3351)) ([a350bd9](https://github.com/UMAprotocol/protocol/commit/a350bd9d1fc9a8c58b4a57f58fee62e7cfd75141))
- **insured-bridge-relayer:** Stub imports of L1 and L2 Bridge clients ([#3333](https://github.com/UMAprotocol/protocol/issues/3333)) ([1cf7925](https://github.com/UMAprotocol/protocol/commit/1cf792523acf9393b352df25d0428f48c22e31f1))
