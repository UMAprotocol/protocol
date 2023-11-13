# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [2.56.2](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.56.1...@uma/core@2.56.2) (2023-11-13)

**Note:** Version bump only for package @uma/core

## [2.56.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.56.0...@uma/core@2.56.1) (2023-10-13)

**Note:** Version bump only for package @uma/core

# [2.56.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.55.0...@uma/core@2.56.0) (2023-07-17)

### Bug Fixes

- **core:** forge event tests ([#4581](https://github.com/UMAprotocol/protocol/issues/4581)) ([6ceda11](https://github.com/UMAprotocol/protocol/commit/6ceda1188ed16756d36d30aedd85117aa3909e01))

### Features

- add excluded tokens in osnap llama adapter config ([#4553](https://github.com/UMAprotocol/protocol/issues/4553)) ([9a51c0c](https://github.com/UMAprotocol/protocol/commit/9a51c0c9d879961542739d9cf900de85c07f1a44))
- add OOV3 on Mumbai ([#4583](https://github.com/UMAprotocol/protocol/issues/4583)) ([533267a](https://github.com/UMAprotocol/protocol/commit/533267a4a4bde4d4fc305bedf5bdb53e85dd7e0f))
- add origin validator address mainnet ([#4549](https://github.com/UMAprotocol/protocol/issues/4549)) ([b6dbb45](https://github.com/UMAprotocol/protocol/commit/b6dbb45ea54c8ad41591161023a5526b44477821))
- add osnap defi llama adapter config ([#4538](https://github.com/UMAprotocol/protocol/issues/4538)) ([b0558f3](https://github.com/UMAprotocol/protocol/commit/b0558f37a5ce240a08d694ebd40f9ed327c897ed))
- add sherlock identifier update proposal script ([#4547](https://github.com/UMAprotocol/protocol/issues/4547)) ([3369652](https://github.com/UMAprotocol/protocol/commit/33696527048b600d3f322e566d207124228e5fb9))
- Deploy to Base Goerli ([#4554](https://github.com/UMAprotocol/protocol/issues/4554)) ([6c7dc62](https://github.com/UMAprotocol/protocol/commit/6c7dc62a22773da0bdb758356fdad4ca87f16725))

# [2.55.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.54.0...@uma/core@2.55.0) (2023-04-18)

### Bug Fixes

- remove temp forge directory ([#4526](https://github.com/UMAprotocol/protocol/issues/4526)) ([01d9b1b](https://github.com/UMAprotocol/protocol/commit/01d9b1b273352854081aacc6a3083e3bad86e923))

### Features

- **core:** reference requests by hash in mock oracle ([#4515](https://github.com/UMAprotocol/protocol/issues/4515)) ([ffbe2df](https://github.com/UMAprotocol/protocol/commit/ffbe2df755df67e98aca2f14c22c9fd3ce28bb56))
- **scripts:** optimistic governor scripts ([#4520](https://github.com/UMAprotocol/protocol/issues/4520)) ([62e58e8](https://github.com/UMAprotocol/protocol/commit/62e58e8cc9f69bcce46bd656a7a2728db85f0a71))

# [2.54.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.53.0...@uma/core@2.54.0) (2023-03-30)

### Features

- **core:** add optimistic governor mastercopy deployments ([#4497](https://github.com/UMAprotocol/protocol/issues/4497)) ([dde212d](https://github.com/UMAprotocol/protocol/commit/dde212da74e309ebb70e65fed09bd46c0c5039d2))
- **core:** helper contract for snapshot ([#4502](https://github.com/UMAprotocol/protocol/issues/4502)) ([fd4777b](https://github.com/UMAprotocol/protocol/commit/fd4777bd62bc8815ae6070cc0517d208c70dde89))
- **core:** optimistic governor mastercopy on avalanche ([#4507](https://github.com/UMAprotocol/protocol/issues/4507)) ([0464fca](https://github.com/UMAprotocol/protocol/commit/0464fca264d7261ca70e92da2814f778b49b64df))
- **core:** optimistic oracle v3 deployments on multisig relay chains ([#4500](https://github.com/UMAprotocol/protocol/issues/4500)) ([b4f100e](https://github.com/UMAprotocol/protocol/commit/b4f100ee8676c8148241ac8a08e9a18418817823))
- refine packages in core ([#4482](https://github.com/UMAprotocol/protocol/issues/4482)) ([6596881](https://github.com/UMAprotocol/protocol/commit/6596881e8aea36e03461768200a84e101b047563))

# [2.53.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.52.0...@uma/core@2.53.0) (2023-03-23)

### Bug Fixes

- **og:** L-01 - Restrict ProposalDeleted event emission to valid assertionId ([#4486](https://github.com/UMAprotocol/protocol/issues/4486)) ([d880037](https://github.com/UMAprotocol/protocol/commit/d88003765b84e7e41513189f79db10cb1a96ffd8))
- **og:** L-02 - Emit event on syncing upgraded OOv3 ([#4487](https://github.com/UMAprotocol/protocol/issues/4487)) ([f3ea7a6](https://github.com/UMAprotocol/protocol/commit/f3ea7a6c04bd5da53ca9a225fc7682c17f465b93))
- **og:** L-03 - Add contract address check in setEscalationManager ([#4488](https://github.com/UMAprotocol/protocol/issues/4488)) ([ed8f3fc](https://github.com/UMAprotocol/protocol/commit/ed8f3fc0d082eab65854f96019d5cde5c6a69256))
- **og:** L-04 - Rename SetBond event to SetCollateralAndBond ([#4489](https://github.com/UMAprotocol/protocol/issues/4489)) ([cf6b68f](https://github.com/UMAprotocol/protocol/commit/cf6b68fe3d823b5dd8fefc3fff35d33a03a09320))
- **og:** N-01 - Consistent variable naming ([#4490](https://github.com/UMAprotocol/protocol/issues/4490)) ([8a2f6d5](https://github.com/UMAprotocol/protocol/commit/8a2f6d5a427db6c91695fc705b6ac7bde0015985))
- **og:** N-02 - Remove payable in executeProposal ([#4491](https://github.com/UMAprotocol/protocol/issues/4491)) ([f417256](https://github.com/UMAprotocol/protocol/commit/f41725694091cbb3707921067032912dd1c83e61))
- **og:** N-03 - Swap misleading variable names ([#4492](https://github.com/UMAprotocol/protocol/issues/4492)) ([c1e996c](https://github.com/UMAprotocol/protocol/commit/c1e996c0e1b70d5d4155afa0d823a5a281ea3f77))
- **og:** N-04 - Eliminate redundant code ([#4493](https://github.com/UMAprotocol/protocol/issues/4493)) ([835a6ff](https://github.com/UMAprotocol/protocol/commit/835a6ff606badc62d06857fc3fc45ddcd55452ef))

### Features

- **core:** deploy script for og mastercopy ([#4495](https://github.com/UMAprotocol/protocol/issues/4495)) ([ef74cd3](https://github.com/UMAprotocol/protocol/commit/ef74cd320b4c3ad9ba38e5f60bb6b36359cf5638))
- **core:** update zodiac dependency version ([#4494](https://github.com/UMAprotocol/protocol/issues/4494)) ([72edf0d](https://github.com/UMAprotocol/protocol/commit/72edf0df98d10a535fd672bf9683662d9857fdfc))

# [2.52.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.51.0...@uma/core@2.52.0) (2023-03-16)

### Bug Fixes

- add updated deployment addresses and fix stake size for foundry fork test ([#4473](https://github.com/UMAprotocol/protocol/issues/4473)) ([c2ebbfe](https://github.com/UMAprotocol/protocol/commit/c2ebbfe1e5f7fc2adf24edcc7f35f98f228155d5))

### Features

- add designated voting factory on goerli ([#4469](https://github.com/UMAprotocol/protocol/issues/4469)) ([4be0810](https://github.com/UMAprotocol/protocol/commit/4be081063bc1008867c6a6e033eddb3c30397622))
- Add Multicall3 ([#4484](https://github.com/UMAprotocol/protocol/issues/4484)) ([bb4bd22](https://github.com/UMAprotocol/protocol/commit/bb4bd225c33476a4245ec48f7614d10a9474aa65))
- add optimistic governor monitoring scripts ([#4483](https://github.com/UMAprotocol/protocol/issues/4483)) ([19ed495](https://github.com/UMAprotocol/protocol/commit/19ed495312d304e6c9a63f9afd1d91b77ccf6df0))

# [2.51.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.50.0...@uma/core@2.51.0) (2023-02-28)

### Bug Fixes

- dvm-v2 contract comments ([#4457](https://github.com/UMAprotocol/protocol/issues/4457)) ([9d3ebde](https://github.com/UMAprotocol/protocol/commit/9d3ebde763c5d83f58767b88327e70888608be8a))
- rename optimistic-governor directory structure ([#4452](https://github.com/UMAprotocol/protocol/issues/4452)) ([e3d93f7](https://github.com/UMAprotocol/protocol/commit/e3d93f7107bba79d9f1e232ef505fb4663fddfce))

### Features

- add dvm2.0 addresses ([#4458](https://github.com/UMAprotocol/protocol/issues/4458)) ([4d3ae1f](https://github.com/UMAprotocol/protocol/commit/4d3ae1fa968018fc0536b2710fbd97a1ff8dc89a))
- dvm2.0 upgrade scripts updates ([#4451](https://github.com/UMAprotocol/protocol/issues/4451)) ([2fb75fb](https://github.com/UMAprotocol/protocol/commit/2fb75fbbb67c9ac7a46776f35caa1b8cdd539963))

# [2.50.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.49.0...@uma/core@2.50.0) (2023-02-20)

### Features

- add new dvm2.0 deployments goerli ([#4446](https://github.com/UMAprotocol/protocol/issues/4446)) ([23077bf](https://github.com/UMAprotocol/protocol/commit/23077bf88ac6b6520560db3caf67cfa14fd0e7ee))

# [2.49.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.48.0...@uma/core@2.49.0) (2023-02-20)

### Bug Fixes

- **dvm2.0:** H-01 - Address slashing rounding errors ([#4411](https://github.com/UMAprotocol/protocol/issues/4411)) ([923f378](https://github.com/UMAprotocol/protocol/commit/923f378db029f272eba1317296d9aa0c395c64fd))
- **dvm2.0:** H-02 - Address intra-round changes of the Slashing library ([#4414](https://github.com/UMAprotocol/protocol/issues/4414)) ([7dd0f9c](https://github.com/UMAprotocol/protocol/commit/7dd0f9c6933610e38fe94ce8f3c574489ac4a2a9))
- **dvm2.0:** L-01 address intra-round changes to maxRolls ([#4417](https://github.com/UMAprotocol/protocol/issues/4417)) ([ffe8c11](https://github.com/UMAprotocol/protocol/commit/ffe8c11ac53f3b21ade453f744f27bcacc2df7eb))
- **dvm2.0:** L-02 - Retroactively unstake cooldown ([#4430](https://github.com/UMAprotocol/protocol/issues/4430)) ([a4619e4](https://github.com/UMAprotocol/protocol/commit/a4619e4e943a1df6b50f122c60535842004b4d30))
- **dvm2.0:** L-04: Add ability to change delegate during voting round ([#4418](https://github.com/UMAprotocol/protocol/issues/4418)) ([1f537c8](https://github.com/UMAprotocol/protocol/commit/1f537c8fb4b1c14bf6af455f13ac2993d9b914e4))
- **dvm2.0:** L-05 - Add input validation ([#4421](https://github.com/UMAprotocol/protocol/issues/4421)) ([569caaf](https://github.com/UMAprotocol/protocol/commit/569caaffb6e5ed442d5da2beaa960ac84f1456ea))
- **dvm2.0:** L-08 - Address missing emmitted props when setting unstake cooldown and emission rate in construction ([#4423](https://github.com/UMAprotocol/protocol/issues/4423)) ([ea07188](https://github.com/UMAprotocol/protocol/commit/ea071885e2a7279b058cf97ba671aff9f428846b))
- **dvm2.0:** L-09 - Add missing docstrings ([#4428](https://github.com/UMAprotocol/protocol/issues/4428)) ([aecb335](https://github.com/UMAprotocol/protocol/commit/aecb3354234b02f81abf0886bcaec5eabd0a4c88))
- **dvm2.0:** L-11 - Address duplicate code ([#4424](https://github.com/UMAprotocol/protocol/issues/4424)) ([9666ed4](https://github.com/UMAprotocol/protocol/commit/9666ed4836145f76ae1fd465ea1045fc0d1e8eb8))
- **dvm2.0:** L-12 Remove redundant safe math ([#4425](https://github.com/UMAprotocol/protocol/issues/4425)) ([4ca1cef](https://github.com/UMAprotocol/protocol/commit/4ca1cef2f4955d859717ad88158d20c387cfd2a1))
- **dvm2.0:** M-01 - Inaccurate function results ([#4415](https://github.com/UMAprotocol/protocol/issues/4415)) ([1609d08](https://github.com/UMAprotocol/protocol/commit/1609d08b77bfca412455cc8a63f8c19712cbbfb3))
- **dvm2.0:** M-02 - Enable commit/reveal post migration to still enable requests to be settled if voted on during a migration ([#4416](https://github.com/UMAprotocol/protocol/issues/4416)) ([c7f60b4](https://github.com/UMAprotocol/protocol/commit/c7f60b4a9bb3c948cc3be2354030c4a375ac73af))
- **dvm2.0:** N-01 Address interface inconsistancy ([#4426](https://github.com/UMAprotocol/protocol/issues/4426)) ([f74472a](https://github.com/UMAprotocol/protocol/commit/f74472adeef521347a39a1202e547f79b8cd269a))
- **dvm2.0:** N-02 Make non-state modifying functions view ([#4427](https://github.com/UMAprotocol/protocol/issues/4427)) ([61fa46b](https://github.com/UMAprotocol/protocol/commit/61fa46ba56b6d324eaede9c822ab169dec9b9c36))
- **dvm2.0:** N-03 Small gas optimizations ([#4429](https://github.com/UMAprotocol/protocol/issues/4429)) ([f1967f5](https://github.com/UMAprotocol/protocol/commit/f1967f55d5274034e3202a53b99529ecc9ab0946))
- **dvm2.0:** N-06 - Address misleading documentation ([#4435](https://github.com/UMAprotocol/protocol/issues/4435)) ([56bb268](https://github.com/UMAprotocol/protocol/commit/56bb2682cc14eceaf86e59adb236c327f310f528))
- **dvm2.0:** N-07 Ensure all external functions are marked as such ([#4432](https://github.com/UMAprotocol/protocol/issues/4432)) ([1b7d0d5](https://github.com/UMAprotocol/protocol/commit/1b7d0d5aa575c4a518057781a9961ff26a6bb0e7))
- **dvm2.0:** N-08 - Address typographical errors ([#4436](https://github.com/UMAprotocol/protocol/issues/4436)) ([8974e1d](https://github.com/UMAprotocol/protocol/commit/8974e1d4f15dbb375e59d081df25d390884bb2e6))
- **dvm2.0:** N-09 - Remove unused import ([#4437](https://github.com/UMAprotocol/protocol/issues/4437)) ([81fde31](https://github.com/UMAprotocol/protocol/commit/81fde31008581c24d96cdc431085287aa718b834))
- **dvm2.0:** N-10 Mark all state variables that can be as immutable ([#4433](https://github.com/UMAprotocol/protocol/issues/4433)) ([3db808b](https://github.com/UMAprotocol/protocol/commit/3db808b05df0b571a02e41cea226867e58858da7))
- fix core ci due to hardhat upgrade ([#4407](https://github.com/UMAprotocol/protocol/issues/4407)) ([a89e104](https://github.com/UMAprotocol/protocol/commit/a89e10472825ca31bfaaaa4e91dba9c1e43391fb))
- **oa:** Add missing interface function for Optimistic Asseter ([#4405](https://github.com/UMAprotocol/protocol/issues/4405)) ([9ce0c62](https://github.com/UMAprotocol/protocol/commit/9ce0c62c0f4b5681619c1da042498705d9badfb0))

### Features

- add missing identifier in assertion event ([#4413](https://github.com/UMAprotocol/protocol/issues/4413)) ([eed3c65](https://github.com/UMAprotocol/protocol/commit/eed3c65d9b09a70b8b0483000b055084dcb70b1d))
- add multicaller to dvm v2 contracts ([#4444](https://github.com/UMAprotocol/protocol/issues/4444)) ([3ad31b3](https://github.com/UMAprotocol/protocol/commit/3ad31b3aab3cf342f6a91dce54032fe0ee1b15c8))
- add OOv3 deployments ([#4442](https://github.com/UMAprotocol/protocol/issues/4442)) ([92c054a](https://github.com/UMAprotocol/protocol/commit/92c054a1e4a17f1294b9e81b3763ebe8a080dc2b))
- deploy optimistic asserter on production networks ([#4394](https://github.com/UMAprotocol/protocol/issues/4394)) ([6fddb23](https://github.com/UMAprotocol/protocol/commit/6fddb23c8a62542084d6d72fdfab00213ffdcd8d))
- optimistic asserter deployment on goerli ([#4392](https://github.com/UMAprotocol/protocol/issues/4392)) ([df4e9b6](https://github.com/UMAprotocol/protocol/commit/df4e9b643f62d9f3a3fba2bd5f354b5e62cdb72a))
- optimistic governor upgrade ([#4412](https://github.com/UMAprotocol/protocol/issues/4412)) ([42ceec4](https://github.com/UMAprotocol/protocol/commit/42ceec429385d6065110857e09504d4242493082))
- rename Optimistic asserter to Optimistic Oracle V3 ([#4440](https://github.com/UMAprotocol/protocol/issues/4440)) ([e5fd755](https://github.com/UMAprotocol/protocol/commit/e5fd7556a1b88dc02c078f03e724b55a768decaa))

# [2.48.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.47.0...@uma/core@2.48.0) (2023-01-17)

### Bug Fixes

- optimize dvm-v2 variable types ([#4384](https://github.com/UMAprotocol/protocol/issues/4384)) ([661c394](https://github.com/UMAprotocol/protocol/commit/661c394acfd6606882e1d1483a739eea4e5a2a04))
- reuse storage slots for tracking processed requests ([#4381](https://github.com/UMAprotocol/protocol/issues/4381)) ([d4246c0](https://github.com/UMAprotocol/protocol/commit/d4246c039983ebc8e64f9996d1e2a755401d6a27))

### Features

- add getProcessedPendingRequests ([#4376](https://github.com/UMAprotocol/protocol/issues/4376)) ([69a497b](https://github.com/UMAprotocol/protocol/commit/69a497b7829c63ac832a1518ce3a0cb04634aa6f))
- add new voting v2 goerli address ([#4386](https://github.com/UMAprotocol/protocol/issues/4386)) ([cdb0679](https://github.com/UMAprotocol/protocol/commit/cdb0679347d752e8c200ee30310b589da21ed240))
- add post update functions ([#4383](https://github.com/UMAprotocol/protocol/issues/4383)) ([861dc62](https://github.com/UMAprotocol/protocol/commit/861dc623f4ba711caf363b457d2915444b1513b6))
- Address unbounded intra round slashing ([#4380](https://github.com/UMAprotocol/protocol/issues/4380)) ([324f309](https://github.com/UMAprotocol/protocol/commit/324f309364c27896e950f23f8325ce8f636abcd3))
- small commenting change to be as consistant as posible ([#4382](https://github.com/UMAprotocol/protocol/issues/4382)) ([9c55f01](https://github.com/UMAprotocol/protocol/commit/9c55f013d23dc04780c0222788b2fa347ec29a17))
- voting v2 minor refactoring ([#4385](https://github.com/UMAprotocol/protocol/issues/4385)) ([824615e](https://github.com/UMAprotocol/protocol/commit/824615e15a588628e822f5985432a481fede14da))

# [2.47.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.46.0...@uma/core@2.47.0) (2023-01-11)

### Features

- voting v2 monitoring scripts ([#4312](https://github.com/UMAprotocol/protocol/issues/4312)) ([1582a8a](https://github.com/UMAprotocol/protocol/commit/1582a8a5623e1e76f026ff7ff487792a5cae5fe6))

# [2.46.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.45.0...@uma/core@2.46.0) (2023-01-09)

### Bug Fixes

- [DVM2.0-audit-code-clean]: Address additional formatting and syling issues from code reading session ([#4360](https://github.com/UMAprotocol/protocol/issues/4360)) ([ae4b3aa](https://github.com/UMAprotocol/protocol/commit/ae4b3aab01cf653b13785aa80b72acd30bd32a69))
- [DVM2.0-audit-incentive-fix] add participation activation threshold ([#4364](https://github.com/UMAprotocol/protocol/issues/4364)) ([50a520d](https://github.com/UMAprotocol/protocol/commit/50a520ded47745328a387c97aec00ba1975119c2))
- [DVM2.0-audit-small-refinement] slashing library price request id reference ([#4363](https://github.com/UMAprotocol/protocol/issues/4363)) ([5726cd1](https://github.com/UMAprotocol/protocol/commit/5726cd16cd74b96aab82d6f99c9683e3d72b6723))
- [DVM2.0-gas-golf]: Decrease gas cost through small optimisations ([#4359](https://github.com/UMAprotocol/protocol/issues/4359)) ([6cf4909](https://github.com/UMAprotocol/protocol/commit/6cf49091cec0295d8beee013f3ebaa72107e23db))
- Fix MerkleDistributor unit tests ([#4328](https://github.com/UMAprotocol/protocol/issues/4328)) ([6300730](https://github.com/UMAprotocol/protocol/commit/63007309ee3d484ffa610ea2270ff0daac9ea72f))

### Features

- add partial voter slashed event ([#4367](https://github.com/UMAprotocol/protocol/issues/4367)) ([20794ec](https://github.com/UMAprotocol/protocol/commit/20794eca565906ca4c2c89c5a7b1c1683d86aa65))
- Change PAT -> SPAT ([#4366](https://github.com/UMAprotocol/protocol/issues/4366)) ([3306b5d](https://github.com/UMAprotocol/protocol/commit/3306b5d402a69b02b41e30bd70dec8d323511685))
- deploy new votingv2 and slashing library goerli ([#4368](https://github.com/UMAprotocol/protocol/issues/4368)) ([b5c9412](https://github.com/UMAprotocol/protocol/commit/b5c9412bfe019fd93cb8d78704d7b053fd0c32b5))

# [2.45.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.44.0...@uma/core@2.45.0) (2022-12-28)

### Bug Fixes

- dont use named return variables ([#4341](https://github.com/UMAprotocol/protocol/issues/4341)) ([59364ce](https://github.com/UMAprotocol/protocol/commit/59364cedf50403d3764771d8dd818cc1f9a0cdef))
- remove unused import ([#4338](https://github.com/UMAprotocol/protocol/issues/4338)) ([e4f47ee](https://github.com/UMAprotocol/protocol/commit/e4f47eeee8c981334bf55041ee9659d609887994))
- use external functions in oa ([#4337](https://github.com/UMAprotocol/protocol/issues/4337)) ([bbe05e1](https://github.com/UMAprotocol/protocol/commit/bbe05e12a3aa3abe1bdcb5cbe55a14ba4ba21d0f))

### Features

- Add mainnet forking test case ([#4306](https://github.com/UMAprotocol/protocol/issues/4306)) ([48127c6](https://github.com/UMAprotocol/protocol/commit/48127c6e45ad8acd2914657f0a630946e18a66fe))

# [2.44.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.43.2...@uma/core@2.44.0) (2022-12-20)

### Bug Fixes

- address issue in CI ([#4315](https://github.com/UMAprotocol/protocol/issues/4315)) ([dc247f4](https://github.com/UMAprotocol/protocol/commit/dc247f4bfb0afaec7394825c4ac69bd9fed06c97))
- data asserter test ([#4268](https://github.com/UMAprotocol/protocol/issues/4268)) ([99e3d57](https://github.com/UMAprotocol/protocol/commit/99e3d5762906052a1356fd88797916a6679503ed))

### Features

- add additional code reading todos ([#4279](https://github.com/UMAprotocol/protocol/issues/4279)) ([5afd4aa](https://github.com/UMAprotocol/protocol/commit/5afd4aa2b5508f7ea3da9ff495f493a37672272c))
- add additional props to assertionId ([#4290](https://github.com/UMAprotocol/protocol/issues/4290)) ([de9964c](https://github.com/UMAprotocol/protocol/commit/de9964c85a7611d0725ed0d3ba66d2b6599ec6b2))
- add asserter argument to assertTruthWithDefaults ([#4298](https://github.com/UMAprotocol/protocol/issues/4298)) ([7e52808](https://github.com/UMAprotocol/protocol/commit/7e5280894f8620306ab1336c43d08abcc9da9dc3))
- add foundry to CI ([#4247](https://github.com/UMAprotocol/protocol/issues/4247)) ([b7c338d](https://github.com/UMAprotocol/protocol/commit/b7c338d144c93e976b0fd9cec3d9d61e4e44cac7))
- add full policy escalation manager ([#4293](https://github.com/UMAprotocol/protocol/issues/4293)) ([f20f8b7](https://github.com/UMAprotocol/protocol/commit/f20f8b7c962e5a231e6b0d9ab6251e6203d4e074))
- add new health check runner package ([#4311](https://github.com/UMAprotocol/protocol/issues/4311)) ([1fe7bba](https://github.com/UMAprotocol/protocol/commit/1fe7bbae5eadb28fce6ed24bc87dce9fae4635d7))
- add setter for burned bond percentage ([#4275](https://github.com/UMAprotocol/protocol/issues/4275)) ([476bd98](https://github.com/UMAprotocol/protocol/commit/476bd98ab3b7d8b76aa4ca8bcace81b06b88a4a4))
- add todos optimistic assertor and ssm ([#4266](https://github.com/UMAprotocol/protocol/issues/4266)) ([6ac7317](https://github.com/UMAprotocol/protocol/commit/6ac7317f9fef1f75fe784e16cf089a758c31de68))
- continue adding small OA refinements ([#4273](https://github.com/UMAprotocol/protocol/issues/4273)) ([39a13eb](https://github.com/UMAprotocol/protocol/commit/39a13eb21509a496d79f7f6caba709b9a9534a4d))
- data asserter contract ([#4261](https://github.com/UMAprotocol/protocol/issues/4261)) ([1a97672](https://github.com/UMAprotocol/protocol/commit/1a9767236565249d4971ede0723c4b0136c638eb))
- further cleanup ([#4299](https://github.com/UMAprotocol/protocol/issues/4299)) ([fed1c56](https://github.com/UMAprotocol/protocol/commit/fed1c5677b5e764eb0b3e59817941c129e6c26f7))
- Further refine how assertFor address prop works ([#4281](https://github.com/UMAprotocol/protocol/issues/4281)) ([170ef23](https://github.com/UMAprotocol/protocol/commit/170ef230b5cd86cb4e2bfe82290c504f2ff1fc67))
- refine structure and commenting ([#4292](https://github.com/UMAprotocol/protocol/issues/4292)) ([f904369](https://github.com/UMAprotocol/protocol/commit/f904369ff154828b33062ee4d746df334bf8992f))
- **core:** add domain id property to oa ([#4291](https://github.com/UMAprotocol/protocol/issues/4291)) ([bc6d59d](https://github.com/UMAprotocol/protocol/commit/bc6d59d01e8259bc60b98602b7592bbd102ae6d0))
- further refine OA bonds under disputes ([#4274](https://github.com/UMAprotocol/protocol/issues/4274)) ([afb196e](https://github.com/UMAprotocol/protocol/commit/afb196ea62733738216d2d2296f380d6a93c8947))
- improved variable packing ([#4295](https://github.com/UMAprotocol/protocol/issues/4295)) ([96f7b83](https://github.com/UMAprotocol/protocol/commit/96f7b83d5c3a99e68af1918f19f34d804fd3fff4))
- merge owner controlled properties in one call ([#4284](https://github.com/UMAprotocol/protocol/issues/4284)) ([520e868](https://github.com/UMAprotocol/protocol/commit/520e868720aa450ed7ad77305e9200f01175a038))
- minor oa gas improvement ([#4296](https://github.com/UMAprotocol/protocol/issues/4296)) ([ce79399](https://github.com/UMAprotocol/protocol/commit/ce79399eae7f99b976c7393393212eac445115e4))
- optimistic assertor gas optimisations ([#4282](https://github.com/UMAprotocol/protocol/issues/4282)) ([cf53d5c](https://github.com/UMAprotocol/protocol/commit/cf53d5c62cc0c03cc5c27807eb1a838e9a864d90))
- optimistic assertor refactor ([#4270](https://github.com/UMAprotocol/protocol/issues/4270)) ([8ab97f5](https://github.com/UMAprotocol/protocol/commit/8ab97f594475fe1c67b93af060778b598c53cfa1))
- rename and re-work variables ([#4280](https://github.com/UMAprotocol/protocol/issues/4280)) ([0369768](https://github.com/UMAprotocol/protocol/commit/036976835e1b5a75e30b893077aa242d870f13e1))
- restructure core contracts directory ([#4207](https://github.com/UMAprotocol/protocol/issues/4207)) ([40b5b2c](https://github.com/UMAprotocol/protocol/commit/40b5b2cbc1591201d99f2545a2b22b744b01e663))
- review oa todos ([#4294](https://github.com/UMAprotocol/protocol/issues/4294)) ([76771bb](https://github.com/UMAprotocol/protocol/commit/76771bb342106f60bcdf3918c7b90b55507c8b99))
- superbond escalation manager ([#4287](https://github.com/UMAprotocol/protocol/issues/4287)) ([21b88e5](https://github.com/UMAprotocol/protocol/commit/21b88e59df198e3266ec9b34c7c1f0a571381e3c))
- use renamed claimdata library ([#4289](https://github.com/UMAprotocol/protocol/issues/4289)) ([2bc5e6d](https://github.com/UMAprotocol/protocol/commit/2bc5e6db391cec0a3d56987c8f1cb83b7c426d47))
- **core:** add oa callbacks to ss ([#4276](https://github.com/UMAprotocol/protocol/issues/4276)) ([a2ec177](https://github.com/UMAprotocol/protocol/commit/a2ec1770826e88fd98cc0fdbc9ddf5b8b4d135cc))
- **core:** add oa reentrancy guard ([#4271](https://github.com/UMAprotocol/protocol/issues/4271)) ([45b0e16](https://github.com/UMAprotocol/protocol/commit/45b0e16247978e44c68f67428e79c571242b2915))
- **core:** default false ss policy properties ([#4277](https://github.com/UMAprotocol/protocol/issues/4277)) ([0d7fe64](https://github.com/UMAprotocol/protocol/commit/0d7fe64fa45463724c6f2a718840076da5d2ae72))
- **core:** example prediction markets using oa ([#4257](https://github.com/UMAprotocol/protocol/issues/4257)) ([cab4673](https://github.com/UMAprotocol/protocol/commit/cab46735a9e4a01c81a51a2ed911e9343f0bece6))
- **core:** implement dispute limiting escalation manager ([#4286](https://github.com/UMAprotocol/protocol/issues/4286)) ([8afd0a1](https://github.com/UMAprotocol/protocol/commit/8afd0a13afeccf50424c78bb8b594b3b830849ae))
- **core:** implement oa disputer whitelist in ssm ([#4252](https://github.com/UMAprotocol/protocol/issues/4252)) ([78254e0](https://github.com/UMAprotocol/protocol/commit/78254e0476eec135f1bbd70bf4485599c4853068))
- **core:** oa cached uma params ([#4278](https://github.com/UMAprotocol/protocol/issues/4278)) ([6475790](https://github.com/UMAprotocol/protocol/commit/6475790ff92ee604e110e83b5d977ff79d12d3fc))
- **core:** store claimId in oa ([#4267](https://github.com/UMAprotocol/protocol/issues/4267)) ([dc0ed4e](https://github.com/UMAprotocol/protocol/commit/dc0ed4e315c69240638b34668dcad4bb9898f692))

## [2.43.2](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.43.1...@uma/core@2.43.2) (2022-11-23)

**Note:** Version bump only for package @uma/core

## [2.43.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.43.0...@uma/core@2.43.1) (2022-11-23)

**Note:** Version bump only for package @uma/core

# [2.43.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.41.0...@uma/core@2.43.0) (2022-11-23)

### Bug Fixes

- **core:** avoid duplicate oa disputes ([#4240](https://github.com/UMAprotocol/protocol/issues/4240)) ([9a76db8](https://github.com/UMAprotocol/protocol/commit/9a76db88bb071a471e51d66044b14c623018dbd2))
- **core:** send oa callbacks only if recipient set ([#4225](https://github.com/UMAprotocol/protocol/issues/4225)) ([6b336fc](https://github.com/UMAprotocol/protocol/commit/6b336fca0072a6419c67072fffdb3fc745652968))

### Features

- add new voting v2 goerli address ([#4260](https://github.com/UMAprotocol/protocol/issues/4260)) ([a6634de](https://github.com/UMAprotocol/protocol/commit/a6634de825dd52b2263c7add4b06ec8d42c353d6))
- **core:** add custom price identifier to oa (master) ([#4256](https://github.com/UMAprotocol/protocol/issues/4256)) ([32e4823](https://github.com/UMAprotocol/protocol/commit/32e48236bbea1ea100d6b0e4fc279adaf22da62c)), closes [#4254](https://github.com/UMAprotocol/protocol/issues/4254)
- **core:** implement ssm able to discard disputed assertions ([#4253](https://github.com/UMAprotocol/protocol/issues/4253)) ([9f2a474](https://github.com/UMAprotocol/protocol/commit/9f2a474fc8f3a436c4b365c93499fe0c4d73222e))
- add assertion dispute test and fix issues ([#4236](https://github.com/UMAprotocol/protocol/issues/4236)) ([b1aa698](https://github.com/UMAprotocol/protocol/commit/b1aa69881ffaeb45c84876c43028368e8c05d33b))
- add dispute callbacks ([#4245](https://github.com/UMAprotocol/protocol/issues/4245)) ([50a7851](https://github.com/UMAprotocol/protocol/commit/50a7851a659b4333abcb3fe379da2d793f62db9b))
- insurance implementation with optimistic assertor ([#4249](https://github.com/UMAprotocol/protocol/issues/4249)) ([c5b8ab9](https://github.com/UMAprotocol/protocol/commit/c5b8ab9590542f7273dd2147db4f9dd66f4b1dec))
- **core:** add whitelist proposer ssm ([#4251](https://github.com/UMAprotocol/protocol/issues/4251)) ([dcb38dd](https://github.com/UMAprotocol/protocol/commit/dcb38ddc79b7307ed0a9f80d72a1aa2532f795a1))
- **core:** further improve optimistic assertor tests ([#4248](https://github.com/UMAprotocol/protocol/issues/4248)) ([d39a9c6](https://github.com/UMAprotocol/protocol/commit/d39a9c611b9f180bf679cfd6f11a46b3727e7d16))
- add optimistic assertor events ([#4228](https://github.com/UMAprotocol/protocol/issues/4228)) ([74d55c0](https://github.com/UMAprotocol/protocol/commit/74d55c023e8818f72586b5cf5f8989dd96344512))
- Add OptimisticAssertor Sovereign security manager ([#4222](https://github.com/UMAprotocol/protocol/issues/4222)) ([1433376](https://github.com/UMAprotocol/protocol/commit/1433376751715769a53268f57daa157163dce800))
- oa sovereign security policies ([#4230](https://github.com/UMAprotocol/protocol/issues/4230)) ([4de231e](https://github.com/UMAprotocol/protocol/commit/4de231e853fd93c60f54f475d5783fbea158c7b6))
- optimsitic assertor happy path test and timer integration ([#4234](https://github.com/UMAprotocol/protocol/issues/4234)) ([5a6463b](https://github.com/UMAprotocol/protocol/commit/5a6463b9a9b0adc1f46d8527e4d24c70fdd65b1c))
- refactor tests to use common implementation and general clean ([#4246](https://github.com/UMAprotocol/protocol/issues/4246)) ([1004001](https://github.com/UMAprotocol/protocol/commit/10040018e0384ecc11e463d0b266ee8781da5395))
- sovereign security manager unit tests ([#4243](https://github.com/UMAprotocol/protocol/issues/4243)) ([3fd6818](https://github.com/UMAprotocol/protocol/commit/3fd68184d3c14b65011a4e6078356725a4d07cc3))
- **core:** oa check dvm as oracle at assertion ([#4227](https://github.com/UMAprotocol/protocol/issues/4227)) ([9694252](https://github.com/UMAprotocol/protocol/commit/96942524a21a72a945428b4bbd9a1c516fd8e63f))
- **core:** oa return false when ignoring oracle ([#4231](https://github.com/UMAprotocol/protocol/issues/4231)) ([ae24d0b](https://github.com/UMAprotocol/protocol/commit/ae24d0bbb9f56c2c4f4efe5bb7bfe7eaf6dea8fe))
- **core:** whitelist assertors by msg.sender ([#4233](https://github.com/UMAprotocol/protocol/issues/4233)) ([6dcbe7a](https://github.com/UMAprotocol/protocol/commit/6dcbe7a4f5e8facdcedcd03368de1eff2df5659e))
- Add UMA foundry fixtures ([#4224](https://github.com/UMAprotocol/protocol/issues/4224)) ([17e5cb9](https://github.com/UMAprotocol/protocol/commit/17e5cb905daf9ce613ff517927ef97bd37588c51))
- minimal viable foundry ([#4212](https://github.com/UMAprotocol/protocol/issues/4212)) ([82b2f0c](https://github.com/UMAprotocol/protocol/commit/82b2f0c28287853df3a224c0f9c491709acbfb1b))
- rename oa sovereign security variables ([#4226](https://github.com/UMAprotocol/protocol/issues/4226)) ([d8b618d](https://github.com/UMAprotocol/protocol/commit/d8b618dc19b34ba9989b97f10c02b3b0c1f60f7a))

# [2.42.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.41.0...@uma/core@2.42.0) (2022-11-23)

### Bug Fixes

- **core:** avoid duplicate oa disputes ([#4240](https://github.com/UMAprotocol/protocol/issues/4240)) ([9a76db8](https://github.com/UMAprotocol/protocol/commit/9a76db88bb071a471e51d66044b14c623018dbd2))
- **core:** send oa callbacks only if recipient set ([#4225](https://github.com/UMAprotocol/protocol/issues/4225)) ([6b336fc](https://github.com/UMAprotocol/protocol/commit/6b336fca0072a6419c67072fffdb3fc745652968))

### Features

- add new voting v2 goerli address ([#4260](https://github.com/UMAprotocol/protocol/issues/4260)) ([a6634de](https://github.com/UMAprotocol/protocol/commit/a6634de825dd52b2263c7add4b06ec8d42c353d6))
- **core:** add custom price identifier to oa (master) ([#4256](https://github.com/UMAprotocol/protocol/issues/4256)) ([32e4823](https://github.com/UMAprotocol/protocol/commit/32e48236bbea1ea100d6b0e4fc279adaf22da62c)), closes [#4254](https://github.com/UMAprotocol/protocol/issues/4254)
- **core:** implement ssm able to discard disputed assertions ([#4253](https://github.com/UMAprotocol/protocol/issues/4253)) ([9f2a474](https://github.com/UMAprotocol/protocol/commit/9f2a474fc8f3a436c4b365c93499fe0c4d73222e))
- add assertion dispute test and fix issues ([#4236](https://github.com/UMAprotocol/protocol/issues/4236)) ([b1aa698](https://github.com/UMAprotocol/protocol/commit/b1aa69881ffaeb45c84876c43028368e8c05d33b))
- add dispute callbacks ([#4245](https://github.com/UMAprotocol/protocol/issues/4245)) ([50a7851](https://github.com/UMAprotocol/protocol/commit/50a7851a659b4333abcb3fe379da2d793f62db9b))
- insurance implementation with optimistic assertor ([#4249](https://github.com/UMAprotocol/protocol/issues/4249)) ([c5b8ab9](https://github.com/UMAprotocol/protocol/commit/c5b8ab9590542f7273dd2147db4f9dd66f4b1dec))
- **core:** add whitelist proposer ssm ([#4251](https://github.com/UMAprotocol/protocol/issues/4251)) ([dcb38dd](https://github.com/UMAprotocol/protocol/commit/dcb38ddc79b7307ed0a9f80d72a1aa2532f795a1))
- **core:** further improve optimistic assertor tests ([#4248](https://github.com/UMAprotocol/protocol/issues/4248)) ([d39a9c6](https://github.com/UMAprotocol/protocol/commit/d39a9c611b9f180bf679cfd6f11a46b3727e7d16))
- add optimistic assertor events ([#4228](https://github.com/UMAprotocol/protocol/issues/4228)) ([74d55c0](https://github.com/UMAprotocol/protocol/commit/74d55c023e8818f72586b5cf5f8989dd96344512))
- Add OptimisticAssertor Sovereign security manager ([#4222](https://github.com/UMAprotocol/protocol/issues/4222)) ([1433376](https://github.com/UMAprotocol/protocol/commit/1433376751715769a53268f57daa157163dce800))
- oa sovereign security policies ([#4230](https://github.com/UMAprotocol/protocol/issues/4230)) ([4de231e](https://github.com/UMAprotocol/protocol/commit/4de231e853fd93c60f54f475d5783fbea158c7b6))
- optimsitic assertor happy path test and timer integration ([#4234](https://github.com/UMAprotocol/protocol/issues/4234)) ([5a6463b](https://github.com/UMAprotocol/protocol/commit/5a6463b9a9b0adc1f46d8527e4d24c70fdd65b1c))
- refactor tests to use common implementation and general clean ([#4246](https://github.com/UMAprotocol/protocol/issues/4246)) ([1004001](https://github.com/UMAprotocol/protocol/commit/10040018e0384ecc11e463d0b266ee8781da5395))
- sovereign security manager unit tests ([#4243](https://github.com/UMAprotocol/protocol/issues/4243)) ([3fd6818](https://github.com/UMAprotocol/protocol/commit/3fd68184d3c14b65011a4e6078356725a4d07cc3))
- **core:** oa check dvm as oracle at assertion ([#4227](https://github.com/UMAprotocol/protocol/issues/4227)) ([9694252](https://github.com/UMAprotocol/protocol/commit/96942524a21a72a945428b4bbd9a1c516fd8e63f))
- **core:** oa return false when ignoring oracle ([#4231](https://github.com/UMAprotocol/protocol/issues/4231)) ([ae24d0b](https://github.com/UMAprotocol/protocol/commit/ae24d0bbb9f56c2c4f4efe5bb7bfe7eaf6dea8fe))
- **core:** whitelist assertors by msg.sender ([#4233](https://github.com/UMAprotocol/protocol/issues/4233)) ([6dcbe7a](https://github.com/UMAprotocol/protocol/commit/6dcbe7a4f5e8facdcedcd03368de1eff2df5659e))
- Add UMA foundry fixtures ([#4224](https://github.com/UMAprotocol/protocol/issues/4224)) ([17e5cb9](https://github.com/UMAprotocol/protocol/commit/17e5cb905daf9ce613ff517927ef97bd37588c51))
- minimal viable foundry ([#4212](https://github.com/UMAprotocol/protocol/issues/4212)) ([82b2f0c](https://github.com/UMAprotocol/protocol/commit/82b2f0c28287853df3a224c0f9c491709acbfb1b))
- rename oa sovereign security variables ([#4226](https://github.com/UMAprotocol/protocol/issues/4226)) ([d8b618d](https://github.com/UMAprotocol/protocol/commit/d8b618dc19b34ba9989b97f10c02b3b0c1f60f7a))

# [2.41.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.40.0...@uma/core@2.41.0) (2022-11-02)

### Features

- **merkle-distributor:** Make \_verifyAndMarkClaimed internal ([#4220](https://github.com/UMAprotocol/protocol/issues/4220)) ([b1a4301](https://github.com/UMAprotocol/protocol/commit/b1a43018f3fe15d7c3b378095b01ce722a1d8e18))
- second optimistic assertor implementation ([#4215](https://github.com/UMAprotocol/protocol/issues/4215)) ([d15eb3b](https://github.com/UMAprotocol/protocol/commit/d15eb3b9ab28b3b95cdf50b4e46779c1b4dfb2e4))

# [2.40.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.39.0...@uma/core@2.40.0) (2022-11-01)

### Features

- **merkle-distributor:** Make overridable functions public ([#4217](https://github.com/UMAprotocol/protocol/issues/4217)) ([3addc8c](https://github.com/UMAprotocol/protocol/commit/3addc8c650658833af97f1d24b1b1413ceb94fd7))

# [2.39.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.38.0...@uma/core@2.39.0) (2022-11-01)

### Features

- add oov2 to mumbai ([#4208](https://github.com/UMAprotocol/protocol/issues/4208)) ([38c481d](https://github.com/UMAprotocol/protocol/commit/38c481da4602da3e1bf94c53c02cbeaf21d741de))
- first oa implementation ([#4211](https://github.com/UMAprotocol/protocol/issues/4211)) ([ac893cc](https://github.com/UMAprotocol/protocol/commit/ac893cc2d06e79795a7b83f888df9651c40f54b9))

# [2.38.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.37.1...@uma/core@2.38.0) (2022-10-06)

### Features

- dvm 2.0 upgrade improvement ([#4190](https://github.com/UMAprotocol/protocol/issues/4190)) ([e65ca52](https://github.com/UMAprotocol/protocol/commit/e65ca524cc67583e30763f823f5fed4a78be2866))

## [2.37.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.37.0...@uma/core@2.37.1) (2022-10-05)

### Bug Fixes

- [contracts] improve DVM 2.0 comments ([#4182](https://github.com/UMAprotocol/protocol/issues/4182)) ([5114f45](https://github.com/UMAprotocol/protocol/commit/5114f45bb4f2c59dc18edb50e7c69e2e94bf853c))
- residual active stake naming ([#4186](https://github.com/UMAprotocol/protocol/issues/4186)) ([4564549](https://github.com/UMAprotocol/protocol/commit/45645492ea5b8320679866fa306d4f9a2c98d2de))

# [2.37.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.36.0...@uma/core@2.37.0) (2022-09-22)

### Bug Fixes

- \_getPriceFromPreviousVotingContract function visibility ([#4154](https://github.com/UMAprotocol/protocol/issues/4154)) ([d9eb75b](https://github.com/UMAprotocol/protocol/commit/d9eb75b8a7c1a4b1a46d719a783d9b2e6010f2e9))
- [L01]: Prevent the governor from proposing emergency actions ([#4151](https://github.com/UMAprotocol/protocol/issues/4151)) ([9828588](https://github.com/UMAprotocol/protocol/commit/9828588899e2df3b3093f6ce19aa5db71e0282c2))
- [L04]: add missing docstrings ([#4155](https://github.com/UMAprotocol/protocol/issues/4155)) ([421ca85](https://github.com/UMAprotocol/protocol/commit/421ca85cf05dba24b42537acd07ed22ae1930bf6))
- [L08]: improve executeEmergencyProposal docstring ([#4158](https://github.com/UMAprotocol/protocol/issues/4158)) ([ff500a7](https://github.com/UMAprotocol/protocol/commit/ff500a750cafc9a9dc28b68031c7bd80a1a99f0a))
- [N02]: Misleading documentation ([#4152](https://github.com/UMAprotocol/protocol/issues/4152)) ([4dcae7e](https://github.com/UMAprotocol/protocol/commit/4dcae7ef72441b54b34f3f459f8443f9ac9dffe1))
- [N04]: Unnecessary modifier in setDelegate and setDelegator ([#4156](https://github.com/UMAprotocol/protocol/issues/4156)) ([1ff3b68](https://github.com/UMAprotocol/protocol/commit/1ff3b68cbbce61e1fbb7b8bf55479b27a192ee0b))
- [N06]: Redundant event parameters ([#4161](https://github.com/UMAprotocol/protocol/issues/4161)) ([d71523b](https://github.com/UMAprotocol/protocol/commit/d71523b540864be4d23065016454e792749b280f))
- [N08]: Typographical errors fix ([#4165](https://github.com/UMAprotocol/protocol/issues/4165)) ([202a6d2](https://github.com/UMAprotocol/protocol/commit/202a6d21d4d354dabc375a2fc5ba400fc36db92b))
- [N10]: Unnecessary public visability in executeEmergencyProposal ([#4166](https://github.com/UMAprotocol/protocol/issues/4166)) ([1d915db](https://github.com/UMAprotocol/protocol/commit/1d915dba48fe08d6b554819b537d2e4cfa9911ae))
- [N12]: Remove Unused variables ([#4167](https://github.com/UMAprotocol/protocol/issues/4167)) ([53d3502](https://github.com/UMAprotocol/protocol/commit/53d3502256393a7b1fbd06d6094325f771746bb7))
- [post-audit-feedback]: Address typos and small issues identified before getting full audit feedback ([#4178](https://github.com/UMAprotocol/protocol/issues/4178)) ([408ec25](https://github.com/UMAprotocol/protocol/commit/408ec2526d9bfb1b375e75e6ffa10f111740fa6f))
- add missing onlyIfNotMigrated modifiers ([#4157](https://github.com/UMAprotocol/protocol/issues/4157)) ([ac86f25](https://github.com/UMAprotocol/protocol/commit/ac86f25440b0c6dce1b8173705ba11a95f5ea969))
- add new voting v2 address goerli ([#4180](https://github.com/UMAprotocol/protocol/issues/4180)) ([5e87d65](https://github.com/UMAprotocol/protocol/commit/5e87d654aac5468d5b070a8d9061a0617d71a6e1))
- DVM2.0 Address bug in rolling votes + having no active stakers participate ([#4139](https://github.com/UMAprotocol/protocol/issues/4139)) ([1169f78](https://github.com/UMAprotocol/protocol/commit/1169f78ec8dd58968b8e301b26cc39f00cadd316))
- remove non-empty return value ([#4163](https://github.com/UMAprotocol/protocol/issues/4163)) ([5cd9ef1](https://github.com/UMAprotocol/protocol/commit/5cd9ef1514ccd5c0735be8e4b857eafd7bf62764))
- remove redundant code ([#4162](https://github.com/UMAprotocol/protocol/issues/4162)) ([f3f91fb](https://github.com/UMAprotocol/protocol/commit/f3f91fbfacd2715a009a0133923b0e52e09b4afb))
- remove unused imports ([#4164](https://github.com/UMAprotocol/protocol/issues/4164)) ([5a56f2b](https://github.com/UMAprotocol/protocol/commit/5a56f2b5f6e11be4d8e85061e4bd704cafe7b9f2))
- staking parasitic usage ([#4168](https://github.com/UMAprotocol/protocol/issues/4168)) ([f61eed4](https://github.com/UMAprotocol/protocol/commit/f61eed4a6de71c03b6a5a6b913f21efcc78b1392)), closes [#4146](https://github.com/UMAprotocol/protocol/issues/4146) [#4173](https://github.com/UMAprotocol/protocol/issues/4173)
- votingv2 contract size ([#4175](https://github.com/UMAprotocol/protocol/issues/4175)) ([ff903a4](https://github.com/UMAprotocol/protocol/commit/ff903a4d71975acd4c953795668b943b5fd6fec2))

### Features

- add quorum and wait time validation in setters ([#4153](https://github.com/UMAprotocol/protocol/issues/4153)) ([7d51046](https://github.com/UMAprotocol/protocol/commit/7d510462ed365ffc7e9283f67ce3675cf737caec))
- deploy votingv2 in goerli after fixes ([#4176](https://github.com/UMAprotocol/protocol/issues/4176)) ([fa250ea](https://github.com/UMAprotocol/protocol/commit/fa250ea34d144128d7550bef39fe853cd151ce3d))
- immutable variables in voting upgrader v2 ([#4160](https://github.com/UMAprotocol/protocol/issues/4160)) ([74c23b2](https://github.com/UMAprotocol/protocol/commit/74c23b2e64cea570fb8ec2cc150ed3a61aeda033))
- pragma update ([#4159](https://github.com/UMAprotocol/protocol/issues/4159)) ([7c049a1](https://github.com/UMAprotocol/protocol/commit/7c049a108793e200665fa3650c245efd424353da))

# [2.36.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.35.0...@uma/core@2.36.0) (2022-09-12)

### Features

- **core:** implement floored linear fpl ([#4119](https://github.com/UMAprotocol/protocol/issues/4119)) ([e4eb721](https://github.com/UMAprotocol/protocol/commit/e4eb7213f1954afb2fc4d8d4e498562efedfcc1e))
- add hardhat tracer ([#4140](https://github.com/UMAprotocol/protocol/issues/4140)) ([42b79ae](https://github.com/UMAprotocol/protocol/commit/42b79ae06f3913bfbc4cfe1c3ac980e84dadedc4))

# [2.35.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.34.0...@uma/core@2.35.0) (2022-08-24)

### Features

- add claim and stake for delegates ([#4110](https://github.com/UMAprotocol/protocol/issues/4110)) ([ddbca75](https://github.com/UMAprotocol/protocol/commit/ddbca75932f5e9f2dd73462f30ed163be7862b11))
- add emergency proposer ([#4128](https://github.com/UMAprotocol/protocol/issues/4128)) ([8c47a3b](https://github.com/UMAprotocol/protocol/commit/8c47a3bccb302d46ad22ee31ccc93090dcc79164))
- add migration scripts to voting v2 ([#4121](https://github.com/UMAprotocol/protocol/issues/4121)) ([3075a63](https://github.com/UMAprotocol/protocol/commit/3075a6323da94f8f47c20b4a57c01bd25b8300a6)), closes [#4132](https://github.com/UMAprotocol/protocol/issues/4132)
- modify DesignatedVotingV2 to delegate to the voter directly ([#4129](https://github.com/UMAprotocol/protocol/issues/4129)) ([0afae60](https://github.com/UMAprotocol/protocol/commit/0afae60aca04b3c110627ec4ee74ae219704af60))
- **core:** copy linear fpl ([#4130](https://github.com/UMAprotocol/protocol/issues/4130)) ([0870423](https://github.com/UMAprotocol/protocol/commit/08704232a4bf744042b2b98c024f2f5f79857976))

# [2.34.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.33.0...@uma/core@2.34.0) (2022-08-16)

### Bug Fixes

- [C01] Address issue with intra voting round slashing tracker updates ([#4067](https://github.com/UMAprotocol/protocol/issues/4067)) ([855e3c7](https://github.com/UMAprotocol/protocol/commit/855e3c740938f8c6a5675387225d3e059b6c1d70))
- [L07] Missing error messages in require statements ([#4074](https://github.com/UMAprotocol/protocol/issues/4074)) ([71f45af](https://github.com/UMAprotocol/protocol/commit/71f45af1ed4684983022bd0cd94471ba7061368c))
- [N01]: Inconsistent usage of reentrancy protection ([#4080](https://github.com/UMAprotocol/protocol/issues/4080)) ([ba64095](https://github.com/UMAprotocol/protocol/commit/ba64095d6a0dde093097df7fbd50e478c0f6cd60))
- [N08]: Address inconsistent function naming ([#4087](https://github.com/UMAprotocol/protocol/issues/4087)) ([6ed0488](https://github.com/UMAprotocol/protocol/commit/6ed04885e8d4294497fc76ce67f79a29ba10e625))
- DVM2.0 address issue with merging without CI and fix staker tests ([#4109](https://github.com/UMAprotocol/protocol/issues/4109)) ([8ca1cfc](https://github.com/UMAprotocol/protocol/commit/8ca1cfc4a8d797ed667785ad0c71ccd4019b71cf))

### Features

- bump solidity to 0.8.16 ([#4108](https://github.com/UMAprotocol/protocol/issues/4108)) ([efdf885](https://github.com/UMAprotocol/protocol/commit/efdf885512fb2eead3d51492efaa93912420791a))
- dvm2.0 imports optimisations ([#4107](https://github.com/UMAprotocol/protocol/issues/4107)) ([dbdbe2f](https://github.com/UMAprotocol/protocol/commit/dbdbe2f5ed6c5452ae4298b1b58f6d6498d40840))

# [2.33.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.32.0...@uma/core@2.33.0) (2022-08-09)

### Bug Fixes

- [H01] fixes duplicate request rewards ([#4064](https://github.com/UMAprotocol/protocol/issues/4064)) ([566a82c](https://github.com/UMAprotocol/protocol/commit/566a82cd0cd830ed70e2b2218c3457f9340c7681))
- [L03]: Imprecise function name ([#4071](https://github.com/UMAprotocol/protocol/issues/4071)) ([f9448bd](https://github.com/UMAprotocol/protocol/commit/f9448bd12c30e03a31fd40cbf1069aff671eff5f))
- [L04]: Incorrect documentation for voting commit hash ([#4072](https://github.com/UMAprotocol/protocol/issues/4072)) ([52b5e39](https://github.com/UMAprotocol/protocol/commit/52b5e3977f75416433041d51ce23ce19f4398652))
- [L05] Lack of input verification in library functions ([#4073](https://github.com/UMAprotocol/protocol/issues/4073)) ([a237529](https://github.com/UMAprotocol/protocol/commit/a23752936a6f3f23a4bc744d718a931ea2c8d404))
- [L08] Testcode in production ([#4095](https://github.com/UMAprotocol/protocol/issues/4095)) ([7d0a254](https://github.com/UMAprotocol/protocol/commit/7d0a254cc3fb24e8b3efd88bc7e4f4329c91646d))
- [L10]: Withdraw role is not configured ([#4078](https://github.com/UMAprotocol/protocol/issues/4078)) ([ed23ad5](https://github.com/UMAprotocol/protocol/commit/ed23ad583fa7a390f1e9e85d4f376012fe33cda1))
- [M01] Incorrect refund of spamDeletionProposalBond ([#4065](https://github.com/UMAprotocol/protocol/issues/4065)) ([f2a802f](https://github.com/UMAprotocol/protocol/commit/f2a802f815b9d6b54b14f48bee93b2a1ca4051fc))
- [M02] incorrect math in slashing library comments ([#4066](https://github.com/UMAprotocol/protocol/issues/4066)) ([4842431](https://github.com/UMAprotocol/protocol/commit/4842431b11484f0b88a8cd87ff87c574c574f6c0))
- [M04] improve migration process ([#4105](https://github.com/UMAprotocol/protocol/issues/4105)) ([88ca7f4](https://github.com/UMAprotocol/protocol/commit/88ca7f40cf07be9090e7fea1f1db59e3837f66b9))
- [N02]: Removal of redundant code ([#4081](https://github.com/UMAprotocol/protocol/issues/4081)) ([5301d92](https://github.com/UMAprotocol/protocol/commit/5301d92e2ff391b273617cc9464e16fb30fb1ce0))
- [N04]: Correction of Erroneous imports ([#4083](https://github.com/UMAprotocol/protocol/issues/4083)) ([6c339c0](https://github.com/UMAprotocol/protocol/commit/6c339c0f82f3cb2b1f2e16869ef1da77dafd87ca))
- [N05]: Remove redundant WithdrawnRewards event emission ([#4084](https://github.com/UMAprotocol/protocol/issues/4084)) ([7bdb045](https://github.com/UMAprotocol/protocol/commit/7bdb045c5bff081573051e2cfeb307bb92298ba6))
- [N06]: Make additional contracts immutable ([#4085](https://github.com/UMAprotocol/protocol/issues/4085)) ([914069d](https://github.com/UMAprotocol/protocol/commit/914069ddc8a72be5059b2888556bb4c58a98b77a))
- [N07]: Address inconsistent declarations for finder variable ([#4086](https://github.com/UMAprotocol/protocol/issues/4086)) ([acadd6a](https://github.com/UMAprotocol/protocol/commit/acadd6a2dfdd3addad6bac0ef18a343eb8b7b81b))
- [N09]: Address inconsistent Events ([#4088](https://github.com/UMAprotocol/protocol/issues/4088)) ([ea466a0](https://github.com/UMAprotocol/protocol/commit/ea466a044976120777b2bf203a97cd6f6ab6259b))
- [N11]: Remove magic numbers ([#4089](https://github.com/UMAprotocol/protocol/issues/4089)) ([9692e20](https://github.com/UMAprotocol/protocol/commit/9692e20261a80718d1b19fe0db37b63156f090c7))
- [N12]: Address Misleading documentation ([#4090](https://github.com/UMAprotocol/protocol/issues/4090)) ([4875c67](https://github.com/UMAprotocol/protocol/commit/4875c67990ac7902174a437be0bfe700dab9ac9b))
- [N13]: Address licencing issues ([#4091](https://github.com/UMAprotocol/protocol/issues/4091)) ([af9aba2](https://github.com/UMAprotocol/protocol/commit/af9aba20592a048174de6b9d25662730ba586da7))
- [N17]: Address Naming issues ([#4094](https://github.com/UMAprotocol/protocol/issues/4094)) ([a832f9d](https://github.com/UMAprotocol/protocol/commit/a832f9d837395e31dd2cf5e755f0a6cf3aa64870))
- [N21]: Too many digits in numeric literals ([#4097](https://github.com/UMAprotocol/protocol/issues/4097)) ([d88e986](https://github.com/UMAprotocol/protocol/commit/d88e98686d1439aaceb98b84d6c57abd4a32b234))
- [N23]: Remove Unnecessary use of SafeMath library ([#4099](https://github.com/UMAprotocol/protocol/issues/4099)) ([b26648a](https://github.com/UMAprotocol/protocol/commit/b26648a29ddbb73b1bf82936defda45ce65ec2d1))
- [N25]: Remove Unnecessary imports ([#4100](https://github.com/UMAprotocol/protocol/issues/4100)) ([c70e08b](https://github.com/UMAprotocol/protocol/commit/c70e08b97520db6180fbe8a023e441e4b4a4464a))
- [N26]: State variable visibility not explicitly declared ([#4101](https://github.com/UMAprotocol/protocol/issues/4101)) ([f194833](https://github.com/UMAprotocol/protocol/commit/f194833874165f1b1e376727f93e8b633cd2a449))
- public functions can be marked as external ([#4102](https://github.com/UMAprotocol/protocol/issues/4102)) ([65d225f](https://github.com/UMAprotocol/protocol/commit/65d225f0a1d0d7ce5315b2e160f73ea6ec3130d8))
- Upgrade all dependent contracts to use the OOv2 and show they work in unit tests ([#4061](https://github.com/UMAprotocol/protocol/issues/4061)) ([63f1891](https://github.com/UMAprotocol/protocol/commit/63f18912921af3f35c3e92edfc5696318f9fbd74))

### Features

- [L09] Unlocked Solidity version pragma ([#4075](https://github.com/UMAprotocol/protocol/issues/4075)) ([ea641e0](https://github.com/UMAprotocol/protocol/commit/ea641e0cc2f5b6e1bd65df104467a5e66f7b6c65))

# [2.32.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.31.0...@uma/core@2.32.0) (2022-08-02)

### Bug Fixes

- DVM2.0 additional clean up and commenting ([#4051](https://github.com/UMAprotocol/protocol/issues/4051)) ([7938617](https://github.com/UMAprotocol/protocol/commit/7938617bf79854811959eb605237edf6bdccbc90))
- remove duplicate contract listing ([#4024](https://github.com/UMAprotocol/protocol/issues/4024)) ([e43dba9](https://github.com/UMAprotocol/protocol/commit/e43dba9eef70a2b6ac4ba6ed46d13fbeb5b4c155))

### Features

- add new goerli addresses ([#4058](https://github.com/UMAprotocol/protocol/issues/4058)) ([f65eb4a](https://github.com/UMAprotocol/protocol/commit/f65eb4a256cc36c170af940cafa6ac7d6cae8fb1))
- deploy lsp contracts in avalanche ([#4057](https://github.com/UMAprotocol/protocol/issues/4057)) ([d9b5cef](https://github.com/UMAprotocol/protocol/commit/d9b5cef95a0e1e7675f7084e12782c3a8332d63b))
- **voting-v2:** add method to withdraw and restake ([#4049](https://github.com/UMAprotocol/protocol/issues/4049)) ([b13c113](https://github.com/UMAprotocol/protocol/commit/b13c113f6c4e3d1c743808005d9e35a9d4b0825c))
- **voting-v2:** add some variable packing to save gas ([#4046](https://github.com/UMAprotocol/protocol/issues/4046)) ([232bc20](https://github.com/UMAprotocol/protocol/commit/232bc2034d8a343fb66b4573298da2dd4cf381d2))
- **voting-v2:** make GAT a number of tokens rather than a percentage ([#4048](https://github.com/UMAprotocol/protocol/issues/4048)) ([3834dbe](https://github.com/UMAprotocol/protocol/commit/3834dbe9b4a2e69fa20f1ab8168619f2eb51a7e7))
- **voting-v2:** remove testable from production voting contract ([#4047](https://github.com/UMAprotocol/protocol/issues/4047)) ([d0d173f](https://github.com/UMAprotocol/protocol/commit/d0d173fcbd5813b06a569236a4d3d57ba65f80ec))
- add events to voting v2 ([#4030](https://github.com/UMAprotocol/protocol/issues/4030)) ([db077e3](https://github.com/UMAprotocol/protocol/commit/db077e35181009335ba46207bdaf506887861bdc))
- add missing natspecs ([#4041](https://github.com/UMAprotocol/protocol/issues/4041)) ([7e919c7](https://github.com/UMAprotocol/protocol/commit/7e919c7a81af3ffd9b52de8a36ed89bdf576f8bb))
- batch transactions in gas scripts ([#4034](https://github.com/UMAprotocol/protocol/issues/4034)) ([de5cbcc](https://github.com/UMAprotocol/protocol/commit/de5cbcc29df145a1d04ca6b704a3188f844c7553))
- DVM v2 remove fixedpoint ([#4036](https://github.com/UMAprotocol/protocol/issues/4036)) ([13b3a7d](https://github.com/UMAprotocol/protocol/commit/13b3a7d866c8273850c441b51f4982af372f2b66))
- DVM2.0 add additional todo logic and update `_resolvePriceRequest`, offset the `nextRequestIndexToConsider` for a voter and remove `fromIndex` when evaluating slashing ([#4040](https://github.com/UMAprotocol/protocol/issues/4040)) ([aa4ebfb](https://github.com/UMAprotocol/protocol/commit/aa4ebfb8ac33cae17fa123fdbc9e185b4e5ae989))
- DVM2.0 Add sync method for internal account slashing trackers ([#4038](https://github.com/UMAprotocol/protocol/issues/4038)) ([8ffa174](https://github.com/UMAprotocol/protocol/commit/8ffa174f35b1be4caa2ba68d08ec0ce0f8ba5a34))
- DVM2.0 Collapse methods and optimize state ([#4037](https://github.com/UMAprotocol/protocol/issues/4037)) ([d4db627](https://github.com/UMAprotocol/protocol/commit/d4db6279c63f8d7e6e31f828beba6a1a9b55a9b7))
- DVM2.0 simplified delegation system ([#4033](https://github.com/UMAprotocol/protocol/issues/4033)) ([023835d](https://github.com/UMAprotocol/protocol/commit/023835d0f737dbae819d85f3976622211c0d9bce))
- DVM2.0 todo 2.0: Add additional last minute changes ([#4042](https://github.com/UMAprotocol/protocol/issues/4042)) ([48b8e84](https://github.com/UMAprotocol/protocol/commit/48b8e8488e50b495654daea3dab717cbadfb306b))
- UMA2.0: deal will rolled votes ([#4026](https://github.com/UMAprotocol/protocol/issues/4026)) ([91da58e](https://github.com/UMAprotocol/protocol/commit/91da58ea8d31f512aeee96534ecd5235be5b65ad))

# [2.31.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.30.0...@uma/core@2.31.0) (2022-07-13)

### Features

- add ancillary data to governance proposals ([#4027](https://github.com/UMAprotocol/protocol/issues/4027)) ([f427ff7](https://github.com/UMAprotocol/protocol/commit/f427ff7428926a05ba295868c0cbf71e4db6f6b1))
- add evmos hardhat config and deployment addresses ([#3977](https://github.com/UMAprotocol/protocol/issues/3977)) ([28b17f5](https://github.com/UMAprotocol/protocol/commit/28b17f5d844c3ee8ca7f59a6e613ffc7101105db))
- add gas tests for voting v1 and voting v2 ([#4029](https://github.com/UMAprotocol/protocol/issues/4029)) ([20fe41e](https://github.com/UMAprotocol/protocol/commit/20fe41e390bf94a2adb100a69427a7a3e236433c))
- add meter network ([#4012](https://github.com/UMAprotocol/protocol/issues/4012)) ([cac209d](https://github.com/UMAprotocol/protocol/commit/cac209d288db5b852fb3e5148b200872471aaac0))
- add missing ancilliary data to price events ([#3992](https://github.com/UMAprotocol/protocol/issues/3992)) ([650658d](https://github.com/UMAprotocol/protocol/commit/650658d8772b8e3e468392049e59e74358c3c52d))
- add oov2 deployments in avalanche and sx ([#4011](https://github.com/UMAprotocol/protocol/issues/4011)) ([119d6ec](https://github.com/UMAprotocol/protocol/commit/119d6ec2ed8df311ea83a829ae31ae1696bbc065))
- add slashing library ([#3993](https://github.com/UMAprotocol/protocol/issues/3993)) ([8c82e49](https://github.com/UMAprotocol/protocol/commit/8c82e49082e110843015093be997209eac745869))
- DVM2.0 Add ability to delete spam requests from the DVM. ([#4010](https://github.com/UMAprotocol/protocol/issues/4010)) ([5703c4a](https://github.com/UMAprotocol/protocol/commit/5703c4abeb0093169bbcd047f9ef477e7063afb3))
- DVM2.0 add special governance price request tx flow ([#4000](https://github.com/UMAprotocol/protocol/issues/4000)) ([99b0e66](https://github.com/UMAprotocol/protocol/commit/99b0e66418e405241adf9f59e752399c3712e951))
- dvm2.0 votingv2 gas optimisations ([#4018](https://github.com/UMAprotocol/protocol/issues/4018)) ([fc48966](https://github.com/UMAprotocol/protocol/commit/fc4896675273763c435551db5d08c6d18e9b6b97))
- replace batchCommit and batchReveal with multicall ([#4028](https://github.com/UMAprotocol/protocol/issues/4028)) ([d317ecc](https://github.com/UMAprotocol/protocol/commit/d317eccf6e5008f4b7cab65d7a5fd3b3ee07bce8))
- simplify slash calculation ([#4006](https://github.com/UMAprotocol/protocol/issues/4006)) ([7958153](https://github.com/UMAprotocol/protocol/commit/79581535b75f89f30847de995d17a64d7acc98f0))
- UMA2.0 Vote delegation mechanism ([#4019](https://github.com/UMAprotocol/protocol/issues/4019)) ([d5068ad](https://github.com/UMAprotocol/protocol/commit/d5068ad08a3c94620986ca6c1e68a5b0ebfb94f4))
- UMA2.0: Add simple Designated votingV2 to support two key contracts for new DVM design. ([#3997](https://github.com/UMAprotocol/protocol/issues/3997)) ([440a1e8](https://github.com/UMAprotocol/protocol/commit/440a1e83ecacc3c3dec41782e08e26e26e3d717e))
- **oo:** add optimistic oracle v2 deployments addresses ([#3965](https://github.com/UMAprotocol/protocol/issues/3965)) ([7365da4](https://github.com/UMAprotocol/protocol/commit/7365da41f9282cfa8deac1586ac0648fde27f0f8))

# [2.30.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.28.2...@uma/core@2.30.0) (2022-06-27)

### Bug Fixes

- **merkle-distributor:** reduce remainingAmount by batchedAmount in claimMulti ([#3973](https://github.com/UMAprotocol/protocol/issues/3973)) ([ea52fb0](https://github.com/UMAprotocol/protocol/commit/ea52fb022fb8e8b345a8e965a406bd3461cd5e8f))
- get older optimistic governor tests working ([#3968](https://github.com/UMAprotocol/protocol/issues/3968)) ([321b00f](https://github.com/UMAprotocol/protocol/commit/321b00f5de813c3e82931c983c2322fe4903315e))
- **optimistic-distributor:** handle optimistic oracle upgrades ([#3960](https://github.com/UMAprotocol/protocol/issues/3960)) ([288157f](https://github.com/UMAprotocol/protocol/commit/288157fc113a704d8e894c96723cc0f3db0b9740))
- consistent comments ([#3963](https://github.com/UMAprotocol/protocol/issues/3963)) ([db89c4e](https://github.com/UMAprotocol/protocol/commit/db89c4ec763afc63d0bee268f515a41ab8e3220f))
- correct comment on max liveness ([#3962](https://github.com/UMAprotocol/protocol/issues/3962)) ([20611e6](https://github.com/UMAprotocol/protocol/commit/20611e61cc3860d337f301e6fcb254327a8282ea))
- **merkle-distributor:** [H12] track claimed rewards per window ([#3933](https://github.com/UMAprotocol/protocol/issues/3933)) ([273e5ab](https://github.com/UMAprotocol/protocol/commit/273e5ab6f630d1113f287e8493b6ea413ba109d1))
- **merkle-distributor:** [N16] add gas optimizations ([#3944](https://github.com/UMAprotocol/protocol/issues/3944)) ([31fafb1](https://github.com/UMAprotocol/protocol/commit/31fafb1acd047f1990efd7dbabad31b36a7acf0b))
- **merkle-distributor:** [N17] remove SafeMath import ([#3942](https://github.com/UMAprotocol/protocol/issues/3942)) ([4274b40](https://github.com/UMAprotocol/protocol/commit/4274b40ad3480e75d84dc71b771c2408dd49daef))
- **merkle-distributor:** [N18] fix typographical errors ([#3943](https://github.com/UMAprotocol/protocol/issues/3943)) ([c06a7e7](https://github.com/UMAprotocol/protocol/commit/c06a7e73599b266aee754eb81e0a441b29de9d19))
- **optimistic-distributor:** [M03] do not use priceDisputed callback ([#3935](https://github.com/UMAprotocol/protocol/issues/3935)) ([dc5b886](https://github.com/UMAprotocol/protocol/commit/dc5b886a5de98896237060cf2d9187937bb0ebe1))
- **optimistic-distributor:** [N06] remove unused import ([#3939](https://github.com/UMAprotocol/protocol/issues/3939)) ([ca64303](https://github.com/UMAprotocol/protocol/commit/ca64303cccd6094509ef79994d74eaaf02ce6a94))
- **optimistic-distributor:** [N07] bondToken made immutable ([#3938](https://github.com/UMAprotocol/protocol/issues/3938)) ([40a351c](https://github.com/UMAprotocol/protocol/commit/40a351c60cb2bdef0795fa6c20b7cee93e112db6))
- **optimistic-distributor:** [N08] validate input parameters in createReward ([#3940](https://github.com/UMAprotocol/protocol/issues/3940)) ([befa400](https://github.com/UMAprotocol/protocol/commit/befa4006c418c44301f142fb8cb223adf08abd62))
- **optimistic-distributor:** [N09] deploy merkle distributor in constructor ([#3946](https://github.com/UMAprotocol/protocol/issues/3946)) ([a94c204](https://github.com/UMAprotocol/protocol/commit/a94c204100d1f44323e35d98092ea403a22c0ca0))
- **optimistic-distributor:** [N11] use checks-effects-interactions pattern ([#3941](https://github.com/UMAprotocol/protocol/issues/3941)) ([1f4bfc4](https://github.com/UMAprotocol/protocol/commit/1f4bfc4de0b61daeefb96cf6594ec31d8c9c48c1))
- [N09] Unexplained and unused constants ([#3909](https://github.com/UMAprotocol/protocol/issues/3909)) ([dae2e7f](https://github.com/UMAprotocol/protocol/commit/dae2e7f320048f93f201a0e546525bc27baf5766))
- [N12] Unused "using for" directive ([#3910](https://github.com/UMAprotocol/protocol/issues/3910)) ([6650588](https://github.com/UMAprotocol/protocol/commit/66505888e5f913c0048edff05d22bb7b9683656a))
- add ability to delete disputed proposals ([#3911](https://github.com/UMAprotocol/protocol/issues/3911)) ([8ceab93](https://github.com/UMAprotocol/protocol/commit/8ceab93ddde85ef0ce60e93b711985805c0e8302))
- L-01, Events lacking information ([#3916](https://github.com/UMAprotocol/protocol/issues/3916)) ([9d6551c](https://github.com/UMAprotocol/protocol/commit/9d6551cd796373bcc14c6de3da35603dfaece55d))
- L-02, Duplicated code ([#3914](https://github.com/UMAprotocol/protocol/issues/3914)) ([bd86f7b](https://github.com/UMAprotocol/protocol/commit/bd86f7b6221b76f6f656e7a9b6bdbfe695009bf6))
- L-03, Misleading inline documentation ([#3917](https://github.com/UMAprotocol/protocol/issues/3917)) ([ebb4cab](https://github.com/UMAprotocol/protocol/commit/ebb4cab2347e1ff3d64b9c973aeeda6fc6e8f96e))
- L-04, Proposals can be deleted repeatedly ([#3918](https://github.com/UMAprotocol/protocol/issues/3918)) ([e7ec38c](https://github.com/UMAprotocol/protocol/commit/e7ec38c27f9e597e7e03c6db2714f68a1cd336d1))
- M-01 Change of collateral could result in unintended bond value ([#3912](https://github.com/UMAprotocol/protocol/issues/3912)) ([cbb5648](https://github.com/UMAprotocol/protocol/commit/cbb56486bb56fd1493e51849ba7fb934a927518d))
- M-02, lack of event emission after sensitive actions ([#3913](https://github.com/UMAprotocol/protocol/issues/3913)) ([8ab340d](https://github.com/UMAprotocol/protocol/commit/8ab340d1557852e218567c548ca0f17234b98caa))
- M-03, Lack of input validation ([#3915](https://github.com/UMAprotocol/protocol/issues/3915)) ([632859c](https://github.com/UMAprotocol/protocol/commit/632859c95c83adf72408c8b51042f3a03b2cbd72))
- N-01, Commented out code ([#3919](https://github.com/UMAprotocol/protocol/issues/3919)) ([91941de](https://github.com/UMAprotocol/protocol/commit/91941dea4d18e8b8d9ce87d937fc5ce19480987c))
- N-02, Coding style deviates from Solidity Style Guide ([#3920](https://github.com/UMAprotocol/protocol/issues/3920)) ([dfe0238](https://github.com/UMAprotocol/protocol/commit/dfe0238ab3c703b77326dbf1c8d2e1810ac3d5b7))
- N-04, immutable value could be used ([#3921](https://github.com/UMAprotocol/protocol/issues/3921)) ([34343ca](https://github.com/UMAprotocol/protocol/commit/34343ca0bb425ce14ed62236c13eae1894644b14))
- N-05, Some public functions could be external ([#3922](https://github.com/UMAprotocol/protocol/issues/3922)) ([73bc88a](https://github.com/UMAprotocol/protocol/commit/73bc88a8cfb86cd642673f02ab7f019ccc7146c2))
- N-06, Suboptimal struct packing ([#3923](https://github.com/UMAprotocol/protocol/issues/3923)) ([527ebfb](https://github.com/UMAprotocol/protocol/commit/527ebfb4ce6e629291cdec40504c3a0879e90b11))
- N-07, Typographical errors ([#3924](https://github.com/UMAprotocol/protocol/issues/3924)) ([5b21392](https://github.com/UMAprotocol/protocol/commit/5b213920835e850c3185d2537d66c190bd4f500d))
- N-08, Undocumented implicit approval requirements ([#3925](https://github.com/UMAprotocol/protocol/issues/3925)) ([7250172](https://github.com/UMAprotocol/protocol/commit/7250172a3730b23fc80d418af53e6aa46e354305))
- N-10, Unnecessary cast ([#3928](https://github.com/UMAprotocol/protocol/issues/3928)) ([b32bb25](https://github.com/UMAprotocol/protocol/commit/b32bb25699c5ebfb5ea3b7e1f1933af077e9566d))
- N-11, Unnecessary imports ([#3927](https://github.com/UMAprotocol/protocol/issues/3927)) ([1782ecc](https://github.com/UMAprotocol/protocol/commit/1782ecc972ae7d177e1359e9e1f951c04b137504))
- set max liveness to 5200 weeks ([#3950](https://github.com/UMAprotocol/protocol/issues/3950)) ([3cc673b](https://github.com/UMAprotocol/protocol/commit/3cc673bc891372b7cadad950ee1d26d09cbc9c47))

### Features

- UMA2.0 Slashing mechanism ([#3981](https://github.com/UMAprotocol/protocol/issues/3981)) ([f415d66](https://github.com/UMAprotocol/protocol/commit/f415d6646ab68e132dbe6e7d208b90f77679b050))
- **core:** add optional callbacks to skinny OO ([#3974](https://github.com/UMAprotocol/protocol/issues/3974)) ([9fabd6c](https://github.com/UMAprotocol/protocol/commit/9fabd6cd7d2f1d0508199f779f64957f950c5f42))
- rename new OO contracts ([#3959](https://github.com/UMAprotocol/protocol/issues/3959)) ([f011a65](https://github.com/UMAprotocol/protocol/commit/f011a6531fbd7c09d22aa46ef04828cf98f7f854))
- **core:** control oo callbacks from request ([#3936](https://github.com/UMAprotocol/protocol/issues/3936)) ([1373a90](https://github.com/UMAprotocol/protocol/commit/1373a90a48ec0b3235b2ae9932b40f05df8e111c))
- add avalanche and sx to networks ([#3945](https://github.com/UMAprotocol/protocol/issues/3945)) ([9e8e00e](https://github.com/UMAprotocol/protocol/commit/9e8e00e09520949bfe88a16315451c67f9343164))

# [2.29.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.28.3...@uma/core@2.29.0) (2022-06-23)

### Bug Fixes

- **merkle-distributor:** reduce remainingAmount by batchedAmount in claimMulti ([#3973](https://github.com/UMAprotocol/protocol/issues/3973)) ([ea52fb0](https://github.com/UMAprotocol/protocol/commit/ea52fb022fb8e8b345a8e965a406bd3461cd5e8f))
- get older optimistic governor tests working ([#3968](https://github.com/UMAprotocol/protocol/issues/3968)) ([321b00f](https://github.com/UMAprotocol/protocol/commit/321b00f5de813c3e82931c983c2322fe4903315e))
- **optimistic-distributor:** handle optimistic oracle upgrades ([#3960](https://github.com/UMAprotocol/protocol/issues/3960)) ([288157f](https://github.com/UMAprotocol/protocol/commit/288157fc113a704d8e894c96723cc0f3db0b9740))
- consistent comments ([#3963](https://github.com/UMAprotocol/protocol/issues/3963)) ([db89c4e](https://github.com/UMAprotocol/protocol/commit/db89c4ec763afc63d0bee268f515a41ab8e3220f))
- correct comment on max liveness ([#3962](https://github.com/UMAprotocol/protocol/issues/3962)) ([20611e6](https://github.com/UMAprotocol/protocol/commit/20611e61cc3860d337f301e6fcb254327a8282ea))
- **merkle-distributor:** [H12] track claimed rewards per window ([#3933](https://github.com/UMAprotocol/protocol/issues/3933)) ([273e5ab](https://github.com/UMAprotocol/protocol/commit/273e5ab6f630d1113f287e8493b6ea413ba109d1))
- **merkle-distributor:** [N16] add gas optimizations ([#3944](https://github.com/UMAprotocol/protocol/issues/3944)) ([31fafb1](https://github.com/UMAprotocol/protocol/commit/31fafb1acd047f1990efd7dbabad31b36a7acf0b))
- **merkle-distributor:** [N17] remove SafeMath import ([#3942](https://github.com/UMAprotocol/protocol/issues/3942)) ([4274b40](https://github.com/UMAprotocol/protocol/commit/4274b40ad3480e75d84dc71b771c2408dd49daef))
- **merkle-distributor:** [N18] fix typographical errors ([#3943](https://github.com/UMAprotocol/protocol/issues/3943)) ([c06a7e7](https://github.com/UMAprotocol/protocol/commit/c06a7e73599b266aee754eb81e0a441b29de9d19))
- **optimistic-distributor:** [M03] do not use priceDisputed callback ([#3935](https://github.com/UMAprotocol/protocol/issues/3935)) ([dc5b886](https://github.com/UMAprotocol/protocol/commit/dc5b886a5de98896237060cf2d9187937bb0ebe1))
- **optimistic-distributor:** [N06] remove unused import ([#3939](https://github.com/UMAprotocol/protocol/issues/3939)) ([ca64303](https://github.com/UMAprotocol/protocol/commit/ca64303cccd6094509ef79994d74eaaf02ce6a94))
- **optimistic-distributor:** [N07] bondToken made immutable ([#3938](https://github.com/UMAprotocol/protocol/issues/3938)) ([40a351c](https://github.com/UMAprotocol/protocol/commit/40a351c60cb2bdef0795fa6c20b7cee93e112db6))
- **optimistic-distributor:** [N08] validate input parameters in createReward ([#3940](https://github.com/UMAprotocol/protocol/issues/3940)) ([befa400](https://github.com/UMAprotocol/protocol/commit/befa4006c418c44301f142fb8cb223adf08abd62))
- **optimistic-distributor:** [N09] deploy merkle distributor in constructor ([#3946](https://github.com/UMAprotocol/protocol/issues/3946)) ([a94c204](https://github.com/UMAprotocol/protocol/commit/a94c204100d1f44323e35d98092ea403a22c0ca0))
- **optimistic-distributor:** [N11] use checks-effects-interactions pattern ([#3941](https://github.com/UMAprotocol/protocol/issues/3941)) ([1f4bfc4](https://github.com/UMAprotocol/protocol/commit/1f4bfc4de0b61daeefb96cf6594ec31d8c9c48c1))
- set max liveness to 5200 weeks ([#3950](https://github.com/UMAprotocol/protocol/issues/3950)) ([3cc673b](https://github.com/UMAprotocol/protocol/commit/3cc673bc891372b7cadad950ee1d26d09cbc9c47))

### Features

- **core:** add optional callbacks to skinny OO ([#3974](https://github.com/UMAprotocol/protocol/issues/3974)) ([9fabd6c](https://github.com/UMAprotocol/protocol/commit/9fabd6cd7d2f1d0508199f779f64957f950c5f42))
- rename new OO contracts ([#3959](https://github.com/UMAprotocol/protocol/issues/3959)) ([f011a65](https://github.com/UMAprotocol/protocol/commit/f011a6531fbd7c09d22aa46ef04828cf98f7f854))
- **core:** control oo callbacks from request ([#3936](https://github.com/UMAprotocol/protocol/issues/3936)) ([1373a90](https://github.com/UMAprotocol/protocol/commit/1373a90a48ec0b3235b2ae9932b40f05df8e111c))
- add avalanche and sx to networks ([#3945](https://github.com/UMAprotocol/protocol/issues/3945)) ([9e8e00e](https://github.com/UMAprotocol/protocol/commit/9e8e00e09520949bfe88a16315451c67f9343164))

## [2.28.3](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.28.2...@uma/core@2.28.3) (2022-05-27)

### Bug Fixes

- [N09] Unexplained and unused constants ([#3909](https://github.com/UMAprotocol/protocol/issues/3909)) ([dae2e7f](https://github.com/UMAprotocol/protocol/commit/dae2e7f320048f93f201a0e546525bc27baf5766))
- [N12] Unused "using for" directive ([#3910](https://github.com/UMAprotocol/protocol/issues/3910)) ([6650588](https://github.com/UMAprotocol/protocol/commit/66505888e5f913c0048edff05d22bb7b9683656a))
- add ability to delete disputed proposals ([#3911](https://github.com/UMAprotocol/protocol/issues/3911)) ([8ceab93](https://github.com/UMAprotocol/protocol/commit/8ceab93ddde85ef0ce60e93b711985805c0e8302))
- L-01, Events lacking information ([#3916](https://github.com/UMAprotocol/protocol/issues/3916)) ([9d6551c](https://github.com/UMAprotocol/protocol/commit/9d6551cd796373bcc14c6de3da35603dfaece55d))
- L-02, Duplicated code ([#3914](https://github.com/UMAprotocol/protocol/issues/3914)) ([bd86f7b](https://github.com/UMAprotocol/protocol/commit/bd86f7b6221b76f6f656e7a9b6bdbfe695009bf6))
- L-03, Misleading inline documentation ([#3917](https://github.com/UMAprotocol/protocol/issues/3917)) ([ebb4cab](https://github.com/UMAprotocol/protocol/commit/ebb4cab2347e1ff3d64b9c973aeeda6fc6e8f96e))
- L-04, Proposals can be deleted repeatedly ([#3918](https://github.com/UMAprotocol/protocol/issues/3918)) ([e7ec38c](https://github.com/UMAprotocol/protocol/commit/e7ec38c27f9e597e7e03c6db2714f68a1cd336d1))
- M-01 Change of collateral could result in unintended bond value ([#3912](https://github.com/UMAprotocol/protocol/issues/3912)) ([cbb5648](https://github.com/UMAprotocol/protocol/commit/cbb56486bb56fd1493e51849ba7fb934a927518d))
- M-02, lack of event emission after sensitive actions ([#3913](https://github.com/UMAprotocol/protocol/issues/3913)) ([8ab340d](https://github.com/UMAprotocol/protocol/commit/8ab340d1557852e218567c548ca0f17234b98caa))
- M-03, Lack of input validation ([#3915](https://github.com/UMAprotocol/protocol/issues/3915)) ([632859c](https://github.com/UMAprotocol/protocol/commit/632859c95c83adf72408c8b51042f3a03b2cbd72))
- N-01, Commented out code ([#3919](https://github.com/UMAprotocol/protocol/issues/3919)) ([91941de](https://github.com/UMAprotocol/protocol/commit/91941dea4d18e8b8d9ce87d937fc5ce19480987c))
- N-02, Coding style deviates from Solidity Style Guide ([#3920](https://github.com/UMAprotocol/protocol/issues/3920)) ([dfe0238](https://github.com/UMAprotocol/protocol/commit/dfe0238ab3c703b77326dbf1c8d2e1810ac3d5b7))
- N-04, immutable value could be used ([#3921](https://github.com/UMAprotocol/protocol/issues/3921)) ([34343ca](https://github.com/UMAprotocol/protocol/commit/34343ca0bb425ce14ed62236c13eae1894644b14))
- N-05, Some public functions could be external ([#3922](https://github.com/UMAprotocol/protocol/issues/3922)) ([73bc88a](https://github.com/UMAprotocol/protocol/commit/73bc88a8cfb86cd642673f02ab7f019ccc7146c2))
- N-06, Suboptimal struct packing ([#3923](https://github.com/UMAprotocol/protocol/issues/3923)) ([527ebfb](https://github.com/UMAprotocol/protocol/commit/527ebfb4ce6e629291cdec40504c3a0879e90b11))
- N-07, Typographical errors ([#3924](https://github.com/UMAprotocol/protocol/issues/3924)) ([5b21392](https://github.com/UMAprotocol/protocol/commit/5b213920835e850c3185d2537d66c190bd4f500d))
- N-08, Undocumented implicit approval requirements ([#3925](https://github.com/UMAprotocol/protocol/issues/3925)) ([7250172](https://github.com/UMAprotocol/protocol/commit/7250172a3730b23fc80d418af53e6aa46e354305))
- N-10, Unnecessary cast ([#3928](https://github.com/UMAprotocol/protocol/issues/3928)) ([b32bb25](https://github.com/UMAprotocol/protocol/commit/b32bb25699c5ebfb5ea3b7e1f1933af077e9566d))
- N-11, Unnecessary imports ([#3927](https://github.com/UMAprotocol/protocol/issues/3927)) ([1782ecc](https://github.com/UMAprotocol/protocol/commit/1782ecc972ae7d177e1359e9e1f951c04b137504))

## [2.28.2](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.28.1...@uma/core@2.28.2) (2022-05-13)

### Bug Fixes

- **core:** update MockOracle deployment address ([#3905](https://github.com/UMAprotocol/protocol/issues/3905)) ([80fc102](https://github.com/UMAprotocol/protocol/commit/80fc10212e518d42abe391dbc96fd72f270c32b5))
- add tests for v1 OptimisticOracle bot interactions ([#3897](https://github.com/UMAprotocol/protocol/issues/3897)) ([3aef7dd](https://github.com/UMAprotocol/protocol/commit/3aef7dd159138805e83c02e275999a95a416de8a))

## [2.28.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.28.0...@uma/core@2.28.1) (2022-05-05)

### Bug Fixes

- add v1 OO interface for backcompat for downstream users ([#3890](https://github.com/UMAprotocol/protocol/issues/3890)) ([f258069](https://github.com/UMAprotocol/protocol/commit/f258069fff4080a1b1ad26b3efcb1fe628e3f1a7))
- use v1 OO abi ([#3891](https://github.com/UMAprotocol/protocol/issues/3891)) ([92dfa43](https://github.com/UMAprotocol/protocol/commit/92dfa438d0cb7100393f7ea36fb32b9d3ccbac4c))

# [2.28.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.27.0...@uma/core@2.28.0) (2022-04-27)

### Bug Fixes

- fix minor issues with OG and OD ([#3885](https://github.com/UMAprotocol/protocol/issues/3885)) ([fca8e24](https://github.com/UMAprotocol/protocol/commit/fca8e24275e928f7ddf660b5651eb93b87f70afb))

### Features

- add event based request path for OO ([#3880](https://github.com/UMAprotocol/protocol/issues/3880)) ([f49b880](https://github.com/UMAprotocol/protocol/commit/f49b880a92c0047e07a07091a7608ab1c83f4ce8))
- use regular oo instead of skinny oo ([#3881](https://github.com/UMAprotocol/protocol/issues/3881)) ([1aea5ac](https://github.com/UMAprotocol/protocol/commit/1aea5ac1901051ff43b4a577562cae0c6e666790))

# [2.27.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.26.0...@uma/core@2.27.0) (2022-04-22)

### Features

- add OptimisticDistributor ([#3861](https://github.com/UMAprotocol/protocol/issues/3861)) ([bb8cc01](https://github.com/UMAprotocol/protocol/commit/bb8cc019cd0061324000479bf2b7fec2e1eb87bd))
- Add Polygon tunnel addresses ([#3867](https://github.com/UMAprotocol/protocol/issues/3867)) ([88e1ee1](https://github.com/UMAprotocol/protocol/commit/88e1ee14c79997850e5cc183d36d9565308fde93))
- add zodiac module ([#3843](https://github.com/UMAprotocol/protocol/issues/3843)) ([6368e90](https://github.com/UMAprotocol/protocol/commit/6368e90125c3b1ae445ff0ae3c3b38b63efaa72a))

# [2.26.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.25.1...@uma/core@2.26.0) (2022-04-01)

### Bug Fixes

- clean up a few missing and lingering dependencies in the common package ([#3841](https://github.com/UMAprotocol/protocol/issues/3841)) ([e16ab00](https://github.com/UMAprotocol/protocol/commit/e16ab00bcb18fbadc08805c4793215539a741c67))
- fix voter dapp scripts ([#3853](https://github.com/UMAprotocol/protocol/issues/3853)) ([c9af0d1](https://github.com/UMAprotocol/protocol/commit/c9af0d18aa2e314cfff3eb99cc8ff4273052d91e))

### Features

- **core:** Upgrade FxBaseRootTunnel contracts to be compatible with Polygon events emitted by EIP-1559 transactions ([#3863](https://github.com/UMAprotocol/protocol/issues/3863)) ([7b70d39](https://github.com/UMAprotocol/protocol/commit/7b70d39638e158a7c87babdb25e5d8bc42dec718))
- **hardhat-deploy-scripts:** add missing FPL deploy scripts ([#3722](https://github.com/UMAprotocol/protocol/issues/3722)) ([88b02ad](https://github.com/UMAprotocol/protocol/commit/88b02ad23f531937779ef5847ef6bd69ba5787b3))

## [2.25.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.25.0...@uma/core@2.25.1) (2022-02-28)

**Note:** Version bump only for package @uma/core

# [2.25.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.24.1...@uma/core@2.25.0) (2022-02-10)

### Features

- remove across contracts ([#3775](https://github.com/UMAprotocol/protocol/issues/3775)) ([84c053b](https://github.com/UMAprotocol/protocol/commit/84c053b4d9e758f0f5c21886cafa063427843f2b))

## [2.24.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.24.0...@uma/core@2.24.1) (2022-01-25)

**Note:** Version bump only for package @uma/core

# [2.24.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.23.0...@uma/core@2.24.0) (2022-01-20)

### Features

- Deploy Boba LSP ([#3773](https://github.com/UMAprotocol/protocol/issues/3773)) ([f8398b3](https://github.com/UMAprotocol/protocol/commit/f8398b34f97745a9973ddd8a8566eb1892291d20))
- **deployments:** Add xDai deploys ([#3766](https://github.com/UMAprotocol/protocol/issues/3766)) ([f23f081](https://github.com/UMAprotocol/protocol/commit/f23f081f6d2600c086bbac85c25f5e7de03bc2f6))
- add proposer address and deployment script ([#3771](https://github.com/UMAprotocol/protocol/issues/3771)) ([09a3852](https://github.com/UMAprotocol/protocol/commit/09a38527e439be2072561a17400006d14dda19ca))
- **cross-chain-oracle:** Add verification script to cross chain oracle setup ([#3758](https://github.com/UMAprotocol/protocol/issues/3758)) ([8ad8291](https://github.com/UMAprotocol/protocol/commit/8ad82915d534d062c90f6f2b89ab4b4798b83a2b))

# [2.23.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.22.0...@uma/core@2.23.0) (2022-01-11)

### Features

- **core:** Add cross-chain-oracle deployment scripts for Arbitrum ([#3733](https://github.com/UMAprotocol/protocol/issues/3733)) ([e8d8b9f](https://github.com/UMAprotocol/protocol/commit/e8d8b9fdd9dba86b3e05111cd9d37e3b46150d16))
- **core:** Add OO deployment instructions ([#3735](https://github.com/UMAprotocol/protocol/issues/3735)) ([0560290](https://github.com/UMAprotocol/protocol/commit/056029005f880b9fdaf72694fa289deb14af6aa7))
- **core:** Deploy + Setup Boba OptimisticOracle and Bridge contracts ([#3750](https://github.com/UMAprotocol/protocol/issues/3750)) ([496037f](https://github.com/UMAprotocol/protocol/commit/496037f15b521cc61cdd30a6793ea1888ff8e5f1))
- **scripts:** add script to seed new address whitelist ([#3753](https://github.com/UMAprotocol/protocol/issues/3753)) ([ec3058b](https://github.com/UMAprotocol/protocol/commit/ec3058b492a5fb9ec56ca8916bbad015ad72c073))
- add manual relay script ([#3731](https://github.com/UMAprotocol/protocol/issues/3731)) ([ade5ad6](https://github.com/UMAprotocol/protocol/commit/ade5ad63718e15e83d4789ffe7b7814e31c6f07d))
- add transaction bundler to relayer for better batching ([#3723](https://github.com/UMAprotocol/protocol/issues/3723)) ([51902a8](https://github.com/UMAprotocol/protocol/commit/51902a8cfbbb60dc30b868c5fd3e9fd0f31d48b4))
- update mumbai lsp creator and add rinkeby fpl addresses ([#3721](https://github.com/UMAprotocol/protocol/issues/3721)) ([391214b](https://github.com/UMAprotocol/protocol/commit/391214b05a85b2d47ebc4b252bf88f6084b8ff22))

# [2.22.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.21.0...@uma/core@2.22.0) (2021-12-17)

### Bug Fixes

- [across] add optimism L2->L1 finalizer ([#3709](https://github.com/UMAprotocol/protocol/issues/3709)) ([f32dc4c](https://github.com/UMAprotocol/protocol/commit/f32dc4c342145ac7b64f36eddc2d7c83a06e0aba))
- [C01] fixes issue where disputes are impossible in the OptimisticRewarder ([#3690](https://github.com/UMAprotocol/protocol/issues/3690)) ([6f12f32](https://github.com/UMAprotocol/protocol/commit/6f12f325275f918e6da432d537df5a1d70a8ed16))
- [C02] Proposer cannot pay rewards out multiple times for the same proposal ([#3689](https://github.com/UMAprotocol/protocol/issues/3689)) ([f701df5](https://github.com/UMAprotocol/protocol/commit/f701df51365a0e1bc1cde4b52e97df3fed247342))
- [L01] uses the declared Disputed event ([#3695](https://github.com/UMAprotocol/protocol/issues/3695)) ([a197f0e](https://github.com/UMAprotocol/protocol/commit/a197f0e183e92a78ac0965c7893600fb5ea3ae68))
- [L06] fix Residual allowance ([#3698](https://github.com/UMAprotocol/protocol/issues/3698)) ([4329fea](https://github.com/UMAprotocol/protocol/commit/4329fea74e1d7bcfa45301309dd27f0508035821))
- [M01] fixes incorrect event parameters ([#3694](https://github.com/UMAprotocol/protocol/issues/3694)) ([33cb2b3](https://github.com/UMAprotocol/protocol/commit/33cb2b3b1d93b669c2f07e4e45ea0092624d5bb0))
- deployment scripts don't skip when already deployed ([#3696](https://github.com/UMAprotocol/protocol/issues/3696)) ([54f463a](https://github.com/UMAprotocol/protocol/commit/54f463a47c33ae38aa10a6f3dae463d5e3d7b179))
- fix ci breakage from failed merge ([#3702](https://github.com/UMAprotocol/protocol/issues/3702)) ([09ab737](https://github.com/UMAprotocol/protocol/commit/09ab7373ec835084729369f6298d7ed55c60009f))

### Features

- add new LSPCreator deployment ([#3710](https://github.com/UMAprotocol/protocol/issues/3710)) ([3820a70](https://github.com/UMAprotocol/protocol/commit/3820a7032fcaf1b22532a4ac4ca19596c3c75977))
- governor spoke is able to execute multiple transactions atomically ([#3703](https://github.com/UMAprotocol/protocol/issues/3703)) ([0d3cf20](https://github.com/UMAprotocol/protocol/commit/0d3cf208eaf390198400f6d69193885f45c1e90c))
- **across-bots:** add profitability module to only relay profitable relays ([#3656](https://github.com/UMAprotocol/protocol/issues/3656)) ([f9fb117](https://github.com/UMAprotocol/protocol/commit/f9fb1178894bb1b39b2969bd26ba435979059a19))
- **cross-chain-oracle:** Enable GovernorHub to change child messenger on child network ([#3688](https://github.com/UMAprotocol/protocol/issues/3688)) ([7af4247](https://github.com/UMAprotocol/protocol/commit/7af4247f03102af6ab51dcbe51cccb13ccb1fd53))
- rinkeby deployments ([#3697](https://github.com/UMAprotocol/protocol/issues/3697)) ([d2086e7](https://github.com/UMAprotocol/protocol/commit/d2086e74ac3fe3c385c79fbfcc802cbf471e85a0))

# [2.21.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.20.0...@uma/core@2.21.0) (2021-12-13)

### Bug Fixes

- **core-contracts:** [N06] fix some typographical errors ([#3681](https://github.com/UMAprotocol/protocol/issues/3681)) ([0593039](https://github.com/UMAprotocol/protocol/commit/05930397cd67e018bc09d6c5d8169514b365a4ee))
- **cross-chain-oracle:** [L02] add more nonReentrant() modifiers ([#3677](https://github.com/UMAprotocol/protocol/issues/3677)) ([d452e5f](https://github.com/UMAprotocol/protocol/commit/d452e5f44cc7e59dc96a7e685d6b1dc9f82630b8))
- **cross-chain-oracle:** [N03] address incorrect interface ([#3680](https://github.com/UMAprotocol/protocol/issues/3680)) ([88bd694](https://github.com/UMAprotocol/protocol/commit/88bd694ad916cb3ee5e97102e27d073b1b9fdf67))
- **cross-chain-oracle:** fixed wrong commenting ([#3678](https://github.com/UMAprotocol/protocol/issues/3678)) ([dd8ea29](https://github.com/UMAprotocol/protocol/commit/dd8ea2982fc01fe523dfe7b0b77ff1350e304a23))
- **cross-domain-oracle:** [N05] fixed outstanding todos ([#3684](https://github.com/UMAprotocol/protocol/issues/3684)) ([e683be2](https://github.com/UMAprotocol/protocol/commit/e683be255ed61f7e582b88a64d7d0fe6b596287a))
- **optimistic-rewarder:** [L05] improved natspec commenting ([#3679](https://github.com/UMAprotocol/protocol/issues/3679)) ([1306aaa](https://github.com/UMAprotocol/protocol/commit/1306aaaaed7d6846cc9670ad673899fcceb610cd))
- **optimistic-rewarder:** [N07] addressed unused imports ([#3682](https://github.com/UMAprotocol/protocol/issues/3682)) ([29dcb76](https://github.com/UMAprotocol/protocol/commit/29dcb76798755928ea3e192c101823262a0f824e))

### Features

- **across:** Add RateModelStore contract ([#3658](https://github.com/UMAprotocol/protocol/issues/3658)) ([42567bd](https://github.com/UMAprotocol/protocol/commit/42567bd1f4f2d9db8418872d773e352c66120675))
- **core:** Deploy new RateModel ([#3671](https://github.com/UMAprotocol/protocol/issues/3671)) ([9528747](https://github.com/UMAprotocol/protocol/commit/952874792bf5d12bbfc12470997a0569aa4edcd8))

# [2.20.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.18.0...@uma/core@2.20.0) (2021-12-07)

### Features

- add new LSPCreator deployment ([#3666](https://github.com/UMAprotocol/protocol/issues/3666)) ([39d434c](https://github.com/UMAprotocol/protocol/commit/39d434cda46d3ded9e2aaade2d4f2c2817804bd5))
- **sdk:** ability to send funds from Ethereum to Boba ([#3646](https://github.com/UMAprotocol/protocol/issues/3646)) ([543cf74](https://github.com/UMAprotocol/protocol/commit/543cf745858b8b75f7034ca91d701c2f7c5045b7))

# [2.19.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.18.0...@uma/core@2.19.0) (2021-12-07)

### Features

- **sdk:** ability to send funds from Ethereum to Boba ([#3646](https://github.com/UMAprotocol/protocol/issues/3646)) ([543cf74](https://github.com/UMAprotocol/protocol/commit/543cf745858b8b75f7034ca91d701c2f7c5045b7))

# [2.18.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.17.0...@uma/core@2.18.0) (2021-12-06)

### Bug Fixes

- **across:** address possible underflow in bridge pool ([#3624](https://github.com/UMAprotocol/protocol/issues/3624)) ([a01005c](https://github.com/UMAprotocol/protocol/commit/a01005cf08dad4f84039d6f8eeb7d14c7b730fa3))
- **cross-chain-oracle:** add additional cross-chain admin logic ([#3617](https://github.com/UMAprotocol/protocol/issues/3617)) ([a4f3f50](https://github.com/UMAprotocol/protocol/commit/a4f3f506e3b49eb1788638c438ac24f25f40957a))
- **cross-chain-oracle:** Fix unit tests ([#3633](https://github.com/UMAprotocol/protocol/issues/3633)) ([0b6ec4b](https://github.com/UMAprotocol/protocol/commit/0b6ec4b28067f698158d14f7151f4cf377b4cc9b))

### Features

- **across:** Add Setter for LP Fee %/second in BridgePool ([#3622](https://github.com/UMAprotocol/protocol/issues/3622)) ([76be217](https://github.com/UMAprotocol/protocol/commit/76be217e16bebae1d409fb116db10a7a6c2b09ae))
- **across:** bridge admin to enable/disable pool relays ([#3629](https://github.com/UMAprotocol/protocol/issues/3629)) ([a548875](https://github.com/UMAprotocol/protocol/commit/a548875c69e98ffb24c637699cae06ac4bfbb541))
- **across:** show that even when internal account mismatches state, can still call removeLiquidity if enough implied liquidity ([#3660](https://github.com/UMAprotocol/protocol/issues/3660)) ([3afcee1](https://github.com/UMAprotocol/protocol/commit/3afcee1183602a789b5e6be4316b75ebc98aadd8))
- **across-contracts:** added WETH<->ETH wrappers for optimism ([#3611](https://github.com/UMAprotocol/protocol/issues/3611)) ([a0c1e3f](https://github.com/UMAprotocol/protocol/commit/a0c1e3f0af6dba02034eb9262c0d65d1e88d0c4f))
- **cross-chain-oracle:** Add Arbitrum adapters ([#3628](https://github.com/UMAprotocol/protocol/issues/3628)) ([3d0a471](https://github.com/UMAprotocol/protocol/commit/3d0a471e7af88a3a626eb9d457dd9a93a3ad835b))
- **cross-chain-oracle:** Add multicaller to oracleHub and spoke ([#3634](https://github.com/UMAprotocol/protocol/issues/3634)) ([ac2dc0c](https://github.com/UMAprotocol/protocol/commit/ac2dc0c7b6b3f62434fcef9c7c740e1576ab18b5))
- **sdk:** add L1 -> L2 Optimism Bridge Client ([#3623](https://github.com/UMAprotocol/protocol/issues/3623)) ([732ff78](https://github.com/UMAprotocol/protocol/commit/732ff78ad38e2b17affb51195602b61864b87d40))
- **transaction-manager:** enable early return from runTransaction method ([#3609](https://github.com/UMAprotocol/protocol/issues/3609)) ([fcfe27a](https://github.com/UMAprotocol/protocol/commit/fcfe27a21c1b34ae6683534e6059e186684b1819))
- add Admin_ChildMessenger ([#3631](https://github.com/UMAprotocol/protocol/issues/3631)) ([0c4cea3](https://github.com/UMAprotocol/protocol/commit/0c4cea3c3d5e48da6f8984b8ba3afdfea4ce47cc))
- add OptimisticRewarder ([#3594](https://github.com/UMAprotocol/protocol/issues/3594)) ([eeba703](https://github.com/UMAprotocol/protocol/commit/eeba70300441a474bd613ba3104a0322a8ce09c4))
- **cross-chain-oracle:** Add Polygon adapters ([#3620](https://github.com/UMAprotocol/protocol/issues/3620)) ([e5c8ff9](https://github.com/UMAprotocol/protocol/commit/e5c8ff9b7bd30b480f24c55a29f45280646a8c5a))

# [2.17.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.16.0...@uma/core@2.17.0) (2021-11-18)

### Bug Fixes

- **common/core:** small changes post optimsim deployment ([#3592](https://github.com/UMAprotocol/protocol/issues/3592)) ([b940fb7](https://github.com/UMAprotocol/protocol/commit/b940fb77b26c5973b98aa6b191fb1b663df18eae))

### Features

- **cross-chain-oracle:** add optimism chain adapters ([#3595](https://github.com/UMAprotocol/protocol/issues/3595)) ([0c14d8f](https://github.com/UMAprotocol/protocol/commit/0c14d8fa6634da8e4fedd9a4e3caba591d2fca07))
- convert voter dapp test scripts to hardhat ([#3604](https://github.com/UMAprotocol/protocol/issues/3604)) ([1a8ce57](https://github.com/UMAprotocol/protocol/commit/1a8ce57ce56a8e21988f4838f934bb2b7d38239a))

# [2.16.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.15.1...@uma/core@2.16.0) (2021-11-11)

### Features

- **across-relayer:** Add ability to finalize L2->L1 transfer actions ([#3585](https://github.com/UMAprotocol/protocol/issues/3585)) ([e41ab0d](https://github.com/UMAprotocol/protocol/commit/e41ab0d60d5598a6af71405db94f4d2e8479a004))
- **cross-chain-oracle:** Generalized cross-chain oracle and governance contracts ([#3586](https://github.com/UMAprotocol/protocol/issues/3586)) ([f865eb6](https://github.com/UMAprotocol/protocol/commit/f865eb6abf762e43aef9e6dcee1c75873dd5016e))
- decentralized proposal system ([#3490](https://github.com/UMAprotocol/protocol/issues/3490)) ([2fc8fe4](https://github.com/UMAprotocol/protocol/commit/2fc8fe4237156e68a02bf15ff9f981eed0598137))

## [2.15.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.15.0...@uma/core@2.15.1) (2021-11-09)

**Note:** Version bump only for package @uma/core

# [2.15.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.14.1...@uma/core@2.15.0) (2021-11-05)

### Features

- **across-contracts:** add back safe multicaller ([#3553](https://github.com/UMAprotocol/protocol/issues/3553)) ([b8f660e](https://github.com/UMAprotocol/protocol/commit/b8f660e98a84349ccb5cc5d19416ea2668256036))
- **core:** add new deployment addresses for across and update script ([#3556](https://github.com/UMAprotocol/protocol/issues/3556)) ([2348eaf](https://github.com/UMAprotocol/protocol/commit/2348eaf669054f722b0d6909569ffa3db88d5155))
- **optimistic-oracle-proposer:** Can propose, dispute, and settle SkinnyOptimisticOracle price requests ([#3558](https://github.com/UMAprotocol/protocol/issues/3558)) ([c58a19b](https://github.com/UMAprotocol/protocol/commit/c58a19b316001ea59dc21b7932c7f4e66cdba413))

### Reverts

- Revert "Revert "improve(insured-bridge): Reduce verbosity of \_getDepositHash() (#3538)" (#3545)" (#3547) ([2d489f7](https://github.com/UMAprotocol/protocol/commit/2d489f7bc145d305a593fbd98a2d6aea5ebd5f59)), closes [#3538](https://github.com/UMAprotocol/protocol/issues/3538) [#3545](https://github.com/UMAprotocol/protocol/issues/3545) [#3547](https://github.com/UMAprotocol/protocol/issues/3547)

## [2.14.1](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.14.0...@uma/core@2.14.1) (2021-11-02)

### Bug Fixes

- **ancillary-data-lib:** Fix faulty append function ([#3532](https://github.com/UMAprotocol/protocol/issues/3532)) ([26a95fc](https://github.com/UMAprotocol/protocol/commit/26a95fc39d69a20211c18429d790ba9c5f620445))
- **BridgeAdmin:** Fix typographical in contracts ([#3540](https://github.com/UMAprotocol/protocol/issues/3540)) ([e70a342](https://github.com/UMAprotocol/protocol/commit/e70a34282a0a6a3f92ffe1e88d4ea96fa4f3f54c))
- **BridgeAdmin:** validated amount sent is correct when making admin calls ([#3537](https://github.com/UMAprotocol/protocol/issues/3537)) ([3bfd30d](https://github.com/UMAprotocol/protocol/commit/3bfd30dfbc8ea10d1b7bdeecb697a6df78581b99))
- **BridgePool:** add more indexed params ([#3535](https://github.com/UMAprotocol/protocol/issues/3535)) ([0e12eb6](https://github.com/UMAprotocol/protocol/commit/0e12eb6ef1d3ad381290a4e4d5f0490855d3d0f3))
- **BridgePool:** address missing nat-spec ([#3533](https://github.com/UMAprotocol/protocol/issues/3533)) ([ef39e73](https://github.com/UMAprotocol/protocol/commit/ef39e733308268c08caef3b464005ab84ea3d7aa))
- **BridgePool:** remove redundant ExpandedERC20 import ([#3530](https://github.com/UMAprotocol/protocol/issues/3530)) ([a9e50e2](https://github.com/UMAprotocol/protocol/commit/a9e50e20989f549396880d369a38c5350a4078a9))
- **insured-bridge:** Remove unused modifier ([#3542](https://github.com/UMAprotocol/protocol/issues/3542)) ([19c9f9a](https://github.com/UMAprotocol/protocol/commit/19c9f9a5e254fe9eb6a1ca2db1fc964c8c3c377b))
- **lsp:** fix ancillary data length check in constructor for early expiration ([#3524](https://github.com/UMAprotocol/protocol/issues/3524)) ([041ac34](https://github.com/UMAprotocol/protocol/commit/041ac3414deca70a8f5a2f62f65d5488a31ddff2))
- **lsp:** Fix inconsistent type casting for expiration timestamp ([#3528](https://github.com/UMAprotocol/protocol/issues/3528)) ([08456fa](https://github.com/UMAprotocol/protocol/commit/08456fab9bab474487d66533ae73e8e9282f7f4f))
- **lsp:** Fix incorrect inequality for expiration timestamp in settle method ([#3527](https://github.com/UMAprotocol/protocol/issues/3527)) ([ad4c56e](https://github.com/UMAprotocol/protocol/commit/ad4c56ee35eac24bc0b5e717f29f55b409aa8129))
- **lsp:** Fix request early expiration with timestamp of 0 ([#3526](https://github.com/UMAprotocol/protocol/issues/3526)) ([e2e088b](https://github.com/UMAprotocol/protocol/commit/e2e088b547a7652fe11b223860e42172b4a88a4f))
- **lsp:** Fix requestEarlyExpiration and expire natspec comments ([#3529](https://github.com/UMAprotocol/protocol/issues/3529)) ([78b371c](https://github.com/UMAprotocol/protocol/commit/78b371ca70fe855239bd95ba1662475c4550f94b))
- **lsp:** remove duplicate transfer in factory ([#3523](https://github.com/UMAprotocol/protocol/issues/3523)) ([faf58ea](https://github.com/UMAprotocol/protocol/commit/faf58ea5116e105bf0ef7ecc094e96eea9878cfb))
- **skinny-optimistic-oracle:** Default proposer bond to final fee in requestAndProposePriceFor ([#3534](https://github.com/UMAprotocol/protocol/issues/3534)) ([7fb2918](https://github.com/UMAprotocol/protocol/commit/7fb291856faa5ebd18cae3e50bd5d380e48dc8d9))
- **skinny-optimistic-oracle:** proposePrice callback should be to requester not msg.sender ([#3531](https://github.com/UMAprotocol/protocol/issues/3531)) ([4dd9c4a](https://github.com/UMAprotocol/protocol/commit/4dd9c4a5a3cd041897b71547d27ecfbc230a29e8))
- **skinny-optimistic-oracle:** Reentrancy guard requestAndProposePriceFor ([#3539](https://github.com/UMAprotocol/protocol/issues/3539)) ([a9e3fc7](https://github.com/UMAprotocol/protocol/commit/a9e3fc7ef6aa00cc1f093d89305a351a0af09407))

### Reverts

- Revert "improve(insured-bridge): Reduce verbosity of \_getDepositHash() (#3538)" (#3545) ([d1a07f0](https://github.com/UMAprotocol/protocol/commit/d1a07f0c4e244acaf58f51a20c9a8d6e539f1bdd)), closes [#3538](https://github.com/UMAprotocol/protocol/issues/3538) [#3545](https://github.com/UMAprotocol/protocol/issues/3545)

# [2.14.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.13.0...@uma/core@2.14.0) (2021-10-29)

### Bug Fixes

- **GasEstimator:** protocol upgrade for EIP1559 ([#3306](https://github.com/UMAprotocol/protocol/issues/3306)) ([8245391](https://github.com/UMAprotocol/protocol/commit/8245391ee07dca37be3c52a9a9ba47ed4d63f6f7))
- **insured-bridge-relayer:** Handle case where computing realized LP fee % fails ([#3504](https://github.com/UMAprotocol/protocol/issues/3504)) ([9c69a9d](https://github.com/UMAprotocol/protocol/commit/9c69a9d3f545741820fbf73d5436b7f9f30aa8e0))

### Features

- **create-price-feed:** Add InsuredBridge ([#3388](https://github.com/UMAprotocol/protocol/issues/3388)) ([4dd8116](https://github.com/UMAprotocol/protocol/commit/4dd811635fd5647bf5916eb366daf5d613f3856c))

# [2.13.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.12.0...@uma/core@2.13.0) (2021-10-27)

### Bug Fixes

- **across:** address issue in liquidity utilization calculation ([#3499](https://github.com/UMAprotocol/protocol/issues/3499)) ([35e279a](https://github.com/UMAprotocol/protocol/commit/35e279a9f681082bb7ccb49748566d2600bf483f))
- fix liquid reserves check ([#3501](https://github.com/UMAprotocol/protocol/issues/3501)) ([e8a582b](https://github.com/UMAprotocol/protocol/commit/e8a582b36114dcf92a8887c33d520f0b889ea35e))
- **bridge-pool:** BridgePool should set same fee % bounds as BridgeDepositBox ([#3494](https://github.com/UMAprotocol/protocol/issues/3494)) ([819730d](https://github.com/UMAprotocol/protocol/commit/819730d2edadee4d2df60c558d02535dac801a19))
- **insured-bridge:** Add reentrancy guards to all public functions and enforce Check-Effects-Interaction ([#3497](https://github.com/UMAprotocol/protocol/issues/3497)) ([fe5f448](https://github.com/UMAprotocol/protocol/commit/fe5f448ccf7cb91594921daae49cb1f7d9ecac67))
- **insured-bridge:** Call exchangeRateCurrent before external call ([#3498](https://github.com/UMAprotocol/protocol/issues/3498)) ([4a90b20](https://github.com/UMAprotocol/protocol/commit/4a90b20d20c9152c65a4424d1cffea39375e8035))
- **insured-bridge:** Prevent deployer from owning ERC20 LP token ([#3492](https://github.com/UMAprotocol/protocol/issues/3492)) ([e25ac97](https://github.com/UMAprotocol/protocol/commit/e25ac9773c0f6c3a69ca9361b195059945d71571))
- **insured-bridge:** remove reserves on dispute ([#3473](https://github.com/UMAprotocol/protocol/issues/3473)) ([5a68148](https://github.com/UMAprotocol/protocol/commit/5a68148204bdcadc81f38f4fa3a4f3a74655fd85))

### Features

- **across:** refactor address initialization ([#3478](https://github.com/UMAprotocol/protocol/issues/3478)) ([d22e3bd](https://github.com/UMAprotocol/protocol/commit/d22e3bdf6247b2e570de480f437df0121a55b771))
- **core:** Update missing fpl addresses ([#3472](https://github.com/UMAprotocol/protocol/issues/3472)) ([d598e7c](https://github.com/UMAprotocol/protocol/commit/d598e7cce1c466c6acf0769d25465cef21431b22))
- **insured-bridge:** Move contracts-ovm files to contracts/ and bump to ^0.8.0 ([#3454](https://github.com/UMAprotocol/protocol/issues/3454)) ([7189b0c](https://github.com/UMAprotocol/protocol/commit/7189b0c6ecea568a0c6a1f4bb5907a3d50d86186))
- **scripts:** Add option to set contract in Finder when registering contract ([#3481](https://github.com/UMAprotocol/protocol/issues/3481)) ([43ede96](https://github.com/UMAprotocol/protocol/commit/43ede968ec5bd8268179c0a69ce730a07b65f1da))

# [2.12.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.11.0...@uma/core@2.12.0) (2021-10-19)

### Bug Fixes

- **across:** fix broken didContractThrow syntax ([#3469](https://github.com/UMAprotocol/protocol/issues/3469)) ([42e5e10](https://github.com/UMAprotocol/protocol/commit/42e5e10573bdc55350876cec0b3ae58cf0113c43))
- **bridge-pool:** remove outdated check ([#3456](https://github.com/UMAprotocol/protocol/issues/3456)) ([4cbb098](https://github.com/UMAprotocol/protocol/commit/4cbb0986d80dfbb351caaadf203d74f0c50b4db8))
- **spelling:** address handel->handle typo ([#3465](https://github.com/UMAprotocol/protocol/issues/3465)) ([b0faad5](https://github.com/UMAprotocol/protocol/commit/b0faad57bb4f6549a1f90443780fc2932069a52b))

### Features

- **across:** allow relay and speed up to be called simultaneously ([#3449](https://github.com/UMAprotocol/protocol/issues/3449)) ([76b8964](https://github.com/UMAprotocol/protocol/commit/76b8964f8a6230993c53a0e731d0b368b0093746))
- **across:** Enable LP deposit/withdraw in ETH ([#3468](https://github.com/UMAprotocol/protocol/issues/3468)) ([ad06324](https://github.com/UMAprotocol/protocol/commit/ad06324bf75d42fc70ef911f341ce3a27e1f6da1))
- **across:** enable weth transfers to smart contracts ([#3467](https://github.com/UMAprotocol/protocol/issues/3467)) ([3c0c92d](https://github.com/UMAprotocol/protocol/commit/3c0c92d0925975c0e4da5e5751fe81ab6d97dc24))
- **across:** slow relayer forfeits their reward after 15 minutes of no settlement ([#3450](https://github.com/UMAprotocol/protocol/issues/3450)) ([718adce](https://github.com/UMAprotocol/protocol/commit/718adcea4baad2b61b8539013680f2adbbd94e1c))
- **across:** war games 2 ([#3460](https://github.com/UMAprotocol/protocol/issues/3460)) ([c2c849a](https://github.com/UMAprotocol/protocol/commit/c2c849ad046905b61f23f59ef32476a8eb8b04b1))
- **insured-bridge:** Block instant relays post-expiry and change relayDeposit interface to match relayAndSpeedUp ([#3458](https://github.com/UMAprotocol/protocol/issues/3458)) ([25ac3c0](https://github.com/UMAprotocol/protocol/commit/25ac3c00be8afb33a6c6e134509f068699591025))
- **insured-bridge:** Update Arbitrum messenger contracts after e2e tests ([#3448](https://github.com/UMAprotocol/protocol/issues/3448)) ([fd2f9c5](https://github.com/UMAprotocol/protocol/commit/fd2f9c5976300cd3c82801884ef14abf890e1461))
- **LSP:** Enable LSP to support early expiration ([#3445](https://github.com/UMAprotocol/protocol/issues/3445)) ([d4e7ea2](https://github.com/UMAprotocol/protocol/commit/d4e7ea22159b2eed8e39d5b86ce0026ea3b8b995))

# [2.11.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.10.0...@uma/core@2.11.0) (2021-10-08)

### Bug Fixes

- **across:** small commenting and styling nits ([#3451](https://github.com/UMAprotocol/protocol/issues/3451)) ([9635357](https://github.com/UMAprotocol/protocol/commit/9635357a89a5c60aa95be4bbf7fc77e1a253abde))
- **core:** remove migrations contract ([#3441](https://github.com/UMAprotocol/protocol/issues/3441)) ([dc3afa5](https://github.com/UMAprotocol/protocol/commit/dc3afa5f2f0e1084b15e536b89af153bea201050))
- **hardhat:** update HRE syntax ([#3418](https://github.com/UMAprotocol/protocol/issues/3418)) ([359849a](https://github.com/UMAprotocol/protocol/commit/359849a814505d456f8109039747b7106786142c))
- **insured-bridge:** fix whitelist to work with multiple L2 chains ([#3436](https://github.com/UMAprotocol/protocol/issues/3436)) ([58f727e](https://github.com/UMAprotocol/protocol/commit/58f727e2cb96fa828385835e562f691d7c4fd6e3))
- **insured-bridge:** Instant relayer should only receive refund iff they sped up valid relay ([#3425](https://github.com/UMAprotocol/protocol/issues/3425)) ([27d3634](https://github.com/UMAprotocol/protocol/commit/27d3634c6fbe9cf1eb8419641d0dbddf9cb56569))
- **insured-bridge:** remove fixedpoint from InsuredBridge math to save gas ([#3433](https://github.com/UMAprotocol/protocol/issues/3433)) ([34f9cc9](https://github.com/UMAprotocol/protocol/commit/34f9cc9993c7ed102a04aed5025af146e454ba2c))
- **insured-bridge:** standardize variable styling with the rest of the repo ([#3427](https://github.com/UMAprotocol/protocol/issues/3427)) ([8b030a5](https://github.com/UMAprotocol/protocol/commit/8b030a5117af2bd8840618f36dd8ebb615f3cd33))

### Features

- **across:** Update the bridge pool to deal with the scenario where tokens are not relayed before they come through the canonical bridge ([#3412](https://github.com/UMAprotocol/protocol/issues/3412)) ([66d1391](https://github.com/UMAprotocol/protocol/commit/66d13914ea68fb60b56c2c2196976a6da391dbb1))
- **contracts:** optimize address -> utf8 conversion ([#3439](https://github.com/UMAprotocol/protocol/issues/3439)) ([610df3e](https://github.com/UMAprotocol/protocol/commit/610df3e8de408aeb824d044fc45c52b21582decf))
- **insured-bridge:** Add additional ChainId props ([#3400](https://github.com/UMAprotocol/protocol/issues/3400)) ([95cf12e](https://github.com/UMAprotocol/protocol/commit/95cf12e30d82ec5b2876fc6188a37210ca287733))
- **insured-bridge:** add caching of addresses and common params to save gas in relaying ([#3432](https://github.com/UMAprotocol/protocol/issues/3432)) ([61e8cc5](https://github.com/UMAprotocol/protocol/commit/61e8cc5357e975362fb259ca9b490455c6b30033))
- **insured-bridge:** add Eth->Weth support on deposits and withdraws ([#3440](https://github.com/UMAprotocol/protocol/issues/3440)) ([33d01d4](https://github.com/UMAprotocol/protocol/commit/33d01d471437e1ab6861e4545ea4bb3895fd4d74))
- **insured-bridge:** Add the ability to transfer bridgeAdmin in the bridgePool to enable upgradability ([#3426](https://github.com/UMAprotocol/protocol/issues/3426)) ([9a4dd75](https://github.com/UMAprotocol/protocol/commit/9a4dd75bd00b4e58da553e8b386c54cb227b740f))
- **insured-bridge:** gas optimizations in bridge pool ([#3406](https://github.com/UMAprotocol/protocol/issues/3406)) ([c8cf31a](https://github.com/UMAprotocol/protocol/commit/c8cf31a7729b1791f70a92ec29238d18f757100f))
- **insured-bridge:** Integrate SkinnyOptimisticOracle with BridgePool ([#3430](https://github.com/UMAprotocol/protocol/issues/3430)) ([554641c](https://github.com/UMAprotocol/protocol/commit/554641c25d79c4331e08a757f000621d55fe2675))
- **insured-bridge:** optimize bytes32 encode function ([#3431](https://github.com/UMAprotocol/protocol/issues/3431)) ([9967e70](https://github.com/UMAprotocol/protocol/commit/9967e70e7db3f262fde0dc9d89ea04d4cd11ed97))
- **insured-bridge:** Reduce function gas costs by storing hash of Relay params instead of full struct ([#3438](https://github.com/UMAprotocol/protocol/issues/3438)) ([ff231b4](https://github.com/UMAprotocol/protocol/commit/ff231b4df83ede216c0cb431d32e6920b36aec7d))
- **optimistic-oracle:** Introduce gas-lite version of OptimisticOracle ([#3409](https://github.com/UMAprotocol/protocol/issues/3409)) ([42f26de](https://github.com/UMAprotocol/protocol/commit/42f26deb8af3fed37272130b20418d9f93f12339))

# [2.10.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.9.0...@uma/core@2.10.0) (2021-10-01)

### Features

- **insured-bridge:** War games 1 ([#3399](https://github.com/UMAprotocol/protocol/issues/3399)) ([8773494](https://github.com/UMAprotocol/protocol/commit/8773494d29cf0428ca6d65f0272b135ba3dafcbf))

# [2.9.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.8.0...@uma/core@2.9.0) (2021-10-01)

### Features

- **core:** move all active scripts out of core and deprecate rest ([#3397](https://github.com/UMAprotocol/protocol/issues/3397)) ([f96b8c9](https://github.com/UMAprotocol/protocol/commit/f96b8c90b01002594bf44ac44f03f6d021bee460))
- **insured-bridge:** Remove deposit contract from relay params ([#3401](https://github.com/UMAprotocol/protocol/issues/3401)) ([c607211](https://github.com/UMAprotocol/protocol/commit/c607211b0cf0653ad5bb128042515b27efa492a3))

# [2.8.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.7.0...@uma/core@2.8.0) (2021-09-28)

### Bug Fixes

- **cross-package:** Fixed typo of "ballance"->"balance" in a few packages ([#3265](https://github.com/UMAprotocol/protocol/issues/3265)) ([f48cd48](https://github.com/UMAprotocol/protocol/commit/f48cd48f74aefec1b348f2d8ea1cf4e787810809))
- **e2e:** fix broken test ([#3318](https://github.com/UMAprotocol/protocol/issues/3318)) ([6a4f19b](https://github.com/UMAprotocol/protocol/commit/6a4f19ba948e66fc379ab0fa97ddb83e622e6580))
- **insured-bridge:** clean unit tests and simplify param injection ([#3335](https://github.com/UMAprotocol/protocol/issues/3335)) ([564f2a8](https://github.com/UMAprotocol/protocol/commit/564f2a8d7f170bd472f2e11bf69df9102c82eec7))
- make unused variables an error in the typescript linter ([#3279](https://github.com/UMAprotocol/protocol/issues/3279)) ([1d26dfc](https://github.com/UMAprotocol/protocol/commit/1d26dfcd500cc4f84dc5672de0c8f9a7c5592e43))
- **scripts:** Fixes made after running scripts in prod ([#3254](https://github.com/UMAprotocol/protocol/issues/3254)) ([0f4dcbf](https://github.com/UMAprotocol/protocol/commit/0f4dcbfc56a4669e9571c6d007436c7928f51735))

### Features

- **common:** Initial PR adding Optimism plugin to Hardhat config ([#3154](https://github.com/UMAprotocol/protocol/issues/3154)) ([9e6eb07](https://github.com/UMAprotocol/protocol/commit/9e6eb078096c2c986ecfc3d014b7e45ee5e4be54))
- **contract commenting:** Change commenting style to better generate docs ([#3270](https://github.com/UMAprotocol/protocol/issues/3270)) ([d84db68](https://github.com/UMAprotocol/protocol/commit/d84db6844b4a78303b0e17eb0856177420ecce6c))
- **core:** Add register-contract and add-contract-creator admin proposal scripts ([#3243](https://github.com/UMAprotocol/protocol/issues/3243)) ([0e9de7a](https://github.com/UMAprotocol/protocol/commit/0e9de7af57e793a668e2c64f07645d7184a20313))
- **core:** add tasks to manage artifacts and deployments ([#3229](https://github.com/UMAprotocol/protocol/issues/3229)) ([15a8f31](https://github.com/UMAprotocol/protocol/commit/15a8f31e3d3ce0df9b68b03ae56f8df789ae481a))
- **core:** Update Mumbai addresses with verified ones ([#3250](https://github.com/UMAprotocol/protocol/issues/3250)) ([7c17dcd](https://github.com/UMAprotocol/protocol/commit/7c17dcda115210b6771b25f78651581816568056))
- **financial-templates-lib:** Stub for InsuredBridgePriceFeed ([#3356](https://github.com/UMAprotocol/protocol/issues/3356)) ([8abd36f](https://github.com/UMAprotocol/protocol/commit/8abd36f0c938d85985661245f2fd51f465601df4))
- **fpl:** add generalized success token FPL with parameterized base percentage ([#3263](https://github.com/UMAprotocol/protocol/issues/3263)) ([35c528e](https://github.com/UMAprotocol/protocol/commit/35c528e54f4ba51271fbdff7ce939030e3666166))
- **fx-tunnel-relayer:** Implement bot that can relay messages from Polygon ChildTunnel to Ethereum RootTunnel ([#3314](https://github.com/UMAprotocol/protocol/issues/3314)) ([dc1a6b0](https://github.com/UMAprotocol/protocol/commit/dc1a6b08202444e0c97ff84dc7b3cd3d66e2de48))
- **insured-bridge:** Add "ownable" bridge deposit box to simplify testing ([#3389](https://github.com/UMAprotocol/protocol/issues/3389)) ([359bb68](https://github.com/UMAprotocol/protocol/commit/359bb68b62e800f9b42182a78fdc518f9751696a))
- **insured-bridge:** add arbitrum contract support to deposit box inheritance path ([#3385](https://github.com/UMAprotocol/protocol/issues/3385)) ([c77cce7](https://github.com/UMAprotocol/protocol/commit/c77cce7e5a0c37b9880cad045403f7b79dabc626))
- **insured-bridge:** Add ArbitrumMessenger ([#3392](https://github.com/UMAprotocol/protocol/issues/3392)) ([fa56d3c](https://github.com/UMAprotocol/protocol/commit/fa56d3c02c40fc72fe2288a286ea7849f14754f2))
- **insured-bridge:** Add realized LP fee pct computation ([#3373](https://github.com/UMAprotocol/protocol/issues/3373)) ([95abd8d](https://github.com/UMAprotocol/protocol/commit/95abd8d2d6e481a54e234bda6c7f8585babaa5eb))
- **insured-bridge:** Add reentrancy guards ([#3386](https://github.com/UMAprotocol/protocol/issues/3386)) ([88df33c](https://github.com/UMAprotocol/protocol/commit/88df33c743c51f0a6145e8cd188c3afc1eb45fe6))
- **insured-bridge:** Additional admin e2e unit tests for remaining cross-domain admin logic ([#3280](https://github.com/UMAprotocol/protocol/issues/3280)) ([a4d3015](https://github.com/UMAprotocol/protocol/commit/a4d3015bf253dc047d76348697ac6af8e61822e6))
- **insured-bridge:** AVM bridge deposit box ([#3391](https://github.com/UMAprotocol/protocol/issues/3391)) ([7d73fde](https://github.com/UMAprotocol/protocol/commit/7d73fde9cf062c50a599166a0fe52f3f2a817ddb))
- **insured-bridge:** BridgeAdmin supports multiple L2s ([#3390](https://github.com/UMAprotocol/protocol/issues/3390)) ([96cb0a4](https://github.com/UMAprotocol/protocol/commit/96cb0a4afd9b2f78a44d2cb481ec25c6e069cf58))
- **insured-bridge:** Change internal relay data structures ([#3276](https://github.com/UMAprotocol/protocol/issues/3276)) ([07d083e](https://github.com/UMAprotocol/protocol/commit/07d083e1da49e94e5886c2ab1496a5b3bef3b1e0))
- **insured-bridge:** clean comments, address some todos and general code hygiene ([#3323](https://github.com/UMAprotocol/protocol/issues/3323)) ([6b9b4ef](https://github.com/UMAprotocol/protocol/commit/6b9b4efc66e3cc9b9a362e94ca9d206558ff2c21))
- **insured-bridge:** end to end testing stub ([#3255](https://github.com/UMAprotocol/protocol/issues/3255)) ([dda6f10](https://github.com/UMAprotocol/protocol/commit/dda6f108e6e5c023c0324988d79fc7eabef97039))
- **insured-bridge:** Exponential fee calculation ([#3302](https://github.com/UMAprotocol/protocol/issues/3302)) ([bca414a](https://github.com/UMAprotocol/protocol/commit/bca414a5a2cfd989bba98e76c47f536758d75c64))
- **insured-bridge:** Implement remaining crossdomain admin functions in BridgeAdmin ([#3275](https://github.com/UMAprotocol/protocol/issues/3275)) ([169b2cf](https://github.com/UMAprotocol/protocol/commit/169b2cf7b7c54b4665b217d7898648481703881d))
- **insured-bridge:** Implement settleRelay ([#3286](https://github.com/UMAprotocol/protocol/issues/3286)) ([7027f30](https://github.com/UMAprotocol/protocol/commit/7027f304bb4d3077c6421f391f2cae613cadd56e))
- **insured-bridge:** Implement speedUpRelay and settleRelay ([#3285](https://github.com/UMAprotocol/protocol/issues/3285)) ([53d6b53](https://github.com/UMAprotocol/protocol/commit/53d6b53d05709e01f725dc26689799a6ead232cb))
- **insured-bridge:** Implement xchain messaging in BridgeRouter ([#3259](https://github.com/UMAprotocol/protocol/issues/3259)) ([cde2ab9](https://github.com/UMAprotocol/protocol/commit/cde2ab975cecdfc5169f489db1b7f9730466a62b))
- **insured-bridge:** initial LP functionality ([#3287](https://github.com/UMAprotocol/protocol/issues/3287)) ([5a72e02](https://github.com/UMAprotocol/protocol/commit/5a72e0249476a4736772dd227a3f13f448727620))
- **insured-bridge:** Make XMessenger contracts Ownable ([#3395](https://github.com/UMAprotocol/protocol/issues/3395)) ([49f22ee](https://github.com/UMAprotocol/protocol/commit/49f22ee2cbb647be700ad3ab81abac9581c94fb4))
- **insured-bridge:** Modify relay ancillary data to enhance off-chain bots ([#3363](https://github.com/UMAprotocol/protocol/issues/3363)) ([1c2ea19](https://github.com/UMAprotocol/protocol/commit/1c2ea19af1d586c79ba0fe51a7be6cdbd25bea7c))
- **insured-bridge:** Refactoring for gas savings ([#3369](https://github.com/UMAprotocol/protocol/issues/3369)) ([1568cd9](https://github.com/UMAprotocol/protocol/commit/1568cd91406f38f8b69ba48753f1a7d094b8ea18))
- **insured-bridge:** whitelist collateral cross-chain end to end tests ([#3269](https://github.com/UMAprotocol/protocol/issues/3269)) ([3780fb7](https://github.com/UMAprotocol/protocol/commit/3780fb7c00993dabde2b70b12dcc4033c024f446))
- **Insured-Bridge:** initial contract interfaces & smocking ([#3249](https://github.com/UMAprotocol/protocol/issues/3249)) ([aeea8ae](https://github.com/UMAprotocol/protocol/commit/aeea8ae30c6f7d5065e3857d25c75b8d69005d81))
- **insured-bridge-bot:** instant relay logic ([#3364](https://github.com/UMAprotocol/protocol/issues/3364)) ([65600ae](https://github.com/UMAprotocol/protocol/commit/65600aec5f53ae17792b4191a8dd03a03deceba7))
- **insured-bridge-e2e:** add full lifecycle end to end tests ([#3321](https://github.com/UMAprotocol/protocol/issues/3321)) ([4c4434a](https://github.com/UMAprotocol/protocol/commit/4c4434a0c169119a6aff97a34ed8d59059c1c580))
- **insured-bridge-relayer:** Add additional relay logic, should relay and slow relay implementation ([#3359](https://github.com/UMAprotocol/protocol/issues/3359)) ([2a81888](https://github.com/UMAprotocol/protocol/commit/2a81888934594815a5d85a7358c357397083ea23))
- **insured-bridge-relayer:** add speed up bridging and additional standardization ([#3362](https://github.com/UMAprotocol/protocol/issues/3362)) ([dfb578a](https://github.com/UMAprotocol/protocol/commit/dfb578a1008a4954534fa87b3f7752ef3c8fa9b1))
- **insured-bridge-relayer:** initial relayer logic implementation ([#3351](https://github.com/UMAprotocol/protocol/issues/3351)) ([a350bd9](https://github.com/UMAprotocol/protocol/commit/a350bd9d1fc9a8c58b4a57f58fee62e7cfd75141))
- **insured-brige:** update depositor fee information to give more control to different fee types ([#3298](https://github.com/UMAprotocol/protocol/issues/3298)) ([8f786d2](https://github.com/UMAprotocol/protocol/commit/8f786d2811e37de4c27f3f2453b1f2f13efa2652))
- **insured-oracle:** Added initial client implementation and tests ([#3324](https://github.com/UMAprotocol/protocol/issues/3324)) ([877e204](https://github.com/UMAprotocol/protocol/commit/877e2042cd317fe1a1e8d1a1be036b2a738daaf9))
- **lib:** add SimpleSuccessToken and CappedYieldDollar FPLs ([#3237](https://github.com/UMAprotocol/protocol/issues/3237)) ([7242ad2](https://github.com/UMAprotocol/protocol/commit/7242ad25171cab229e0a63c84590ac56992b3cd3))
- **liquidator,disputer,monitor:** remove unnecessary unit conversion helpers in tests ([#3215](https://github.com/UMAprotocol/protocol/issues/3215)) ([77993f4](https://github.com/UMAprotocol/protocol/commit/77993f4d8ffa5ba821f66d5ff5d7c0cac7813009))
- **monitors:** remove all truffle dependencies ([#3361](https://github.com/UMAprotocol/protocol/issues/3361)) ([a4fd298](https://github.com/UMAprotocol/protocol/commit/a4fd29856b7e6bb4ee4a87313de29aba3b344c95))
- **periphery:** Create new package for scripts that interact with core contracts ([#3247](https://github.com/UMAprotocol/protocol/issues/3247)) ([091fd33](https://github.com/UMAprotocol/protocol/commit/091fd3379e3f007adedf4db91ec4e83268ba3110))
- **upp:** add scripts for removing collateral types ([#3232](https://github.com/UMAprotocol/protocol/issues/3232)) ([5dbb842](https://github.com/UMAprotocol/protocol/commit/5dbb8420602aa06b63d9309873699bf2e34f8bcb))
- Add cross-chain governance to UMIP collateral and identifier scripts ([#3234](https://github.com/UMAprotocol/protocol/issues/3234)) ([247a367](https://github.com/UMAprotocol/protocol/commit/247a367d7967a8673b05d2f4fb3e2bb4c35a2b02))
- Upgrade hardhat to 2.5 to be compatible with London hardfork ([#3248](https://github.com/UMAprotocol/protocol/issues/3248)) ([b1524ce](https://github.com/UMAprotocol/protocol/commit/b1524ce868fc17c7486872a8ef632497f757288d))

# [2.7.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.6.0...@uma/core@2.7.0) (2021-07-19)

### Features

- Update OptimisticOracle and Polygon Tunnel Addresses ([#3209](https://github.com/UMAprotocol/protocol/issues/3209)) ([6593fe5](https://github.com/UMAprotocol/protocol/commit/6593fe5aa1980c45ab570da049a9373e8f172c11))

# [2.6.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.5.0...@uma/core@2.6.0) (2021-07-15)

### Bug Fixes

- **polygon:** Update typo in README ([#3216](https://github.com/UMAprotocol/protocol/issues/3216)) ([2c3d172](https://github.com/UMAprotocol/protocol/commit/2c3d172d4f3787ef6914788e2c0c8c7d3b1ff7fd))
- Response to audit of [#3188](https://github.com/UMAprotocol/protocol/issues/3188) and [#3089](https://github.com/UMAprotocol/protocol/issues/3089) ([#3208](https://github.com/UMAprotocol/protocol/issues/3208)) ([b9039d8](https://github.com/UMAprotocol/protocol/commit/b9039d8d2938525decf463392221a09e4f49a919))
- **LSP:** Address audit commenting issues ([#3185](https://github.com/UMAprotocol/protocol/issues/3185)) ([f5d6bd4](https://github.com/UMAprotocol/protocol/commit/f5d6bd45f4bdb7b67b16daae81065ed3876a35c2))
- **LSP:** Continuous audit commenting and require modifications ([#3207](https://github.com/UMAprotocol/protocol/issues/3207)) ([54c7442](https://github.com/UMAprotocol/protocol/commit/54c7442b0035119392db9636acd6f03fbcc7c8ab))

### Features

- Add helper scripts to propose Admin transaction to register new contract ([#3219](https://github.com/UMAprotocol/protocol/issues/3219)) ([538612b](https://github.com/UMAprotocol/protocol/commit/538612bdd5a02ae7147888bb4cc13b686b0e1bd5))
- **core:** refactor core tests to no longer use truffle ([#3202](https://github.com/UMAprotocol/protocol/issues/3202)) ([349401a](https://github.com/UMAprotocol/protocol/commit/349401a869e89f9b5583d34c1f282407dca021ac))
- **linter:** proposal to minimize object sizing ([#3222](https://github.com/UMAprotocol/protocol/issues/3222)) ([c925524](https://github.com/UMAprotocol/protocol/commit/c925524e888f73e1f694c4f9bf4ad1fb31e456bc))
- **liquidator,disputer,monitor:** deprecate legacy tests ([#3212](https://github.com/UMAprotocol/protocol/issues/3212)) ([498ecfc](https://github.com/UMAprotocol/protocol/commit/498ecfcfd3d767ceeb28e37f42ee5a1b7d4f0c83))
- **LSP:** Add rounding protection and additional unit tests ([#3211](https://github.com/UMAprotocol/protocol/issues/3211)) ([a059ead](https://github.com/UMAprotocol/protocol/commit/a059eadf4e1fa8d6f8d02c74491b68cfc7f6ab7c))
- **LSP:** Update deployment addresses across all networks ([#3210](https://github.com/UMAprotocol/protocol/issues/3210)) ([026b204](https://github.com/UMAprotocol/protocol/commit/026b20431bfc61399741f7d4e4076eb6c39740b4))

# [2.5.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.4.0...@uma/core@2.5.0) (2021-07-07)

### Bug Fixes

- **comment:** correct comment about token approvals for lsp minting ([#3178](https://github.com/UMAprotocol/protocol/issues/3178)) ([c27f7ff](https://github.com/UMAprotocol/protocol/commit/c27f7ff2f530fec4dc18a09f7eca3f26579ea292))
- **lsp:** Require collateralPerPair > 0 ([#3132](https://github.com/UMAprotocol/protocol/issues/3132)) ([fb91fcd](https://github.com/UMAprotocol/protocol/commit/fb91fcdcc417b168b1a6bb52cf89352307970771))
- **LSP:** Add missing rentrancy modifiers ([#3131](https://github.com/UMAprotocol/protocol/issues/3131)) ([0efe56d](https://github.com/UMAprotocol/protocol/commit/0efe56d78aacf9165e130621f661e4318a04687a))
- **LSP:** Audit nits and cleanup ([#3152](https://github.com/UMAprotocol/protocol/issues/3152)) ([b2de56c](https://github.com/UMAprotocol/protocol/commit/b2de56cdeddcd085711f13e77f49e312b000dca2))
- **LSP:** Prevent parameter override on Range Bond Lib ([#3130](https://github.com/UMAprotocol/protocol/issues/3130)) ([e2284a5](https://github.com/UMAprotocol/protocol/commit/e2284a55f8ce35775ecb8361b06834609eb60a26))
- **LSP-creator:** Add new factory addresses ([#3175](https://github.com/UMAprotocol/protocol/issues/3175)) ([1f8728a](https://github.com/UMAprotocol/protocol/commit/1f8728a62f4b5a9e450d981d51d71411bbdd7452))
- **LSP-creator:** address incorrect comment in creator ([#3157](https://github.com/UMAprotocol/protocol/issues/3157)) ([03925a3](https://github.com/UMAprotocol/protocol/commit/03925a3b91466b468a36ee001be0e803289ba3a0))
- **LSP-creator:** update create params to add more deployment options ([#3167](https://github.com/UMAprotocol/protocol/issues/3167)) ([d6dab2a](https://github.com/UMAprotocol/protocol/commit/d6dab2afb69e5df13583e2183000801e68ba4ac5))
- **networks:** deploy and verify new LSP creator on testnets ([#3179](https://github.com/UMAprotocol/protocol/issues/3179)) ([908aabd](https://github.com/UMAprotocol/protocol/commit/908aabdc714e80f2bbd39dedc30270f6db3fc36e))
- **polygon-tunnel:** Response to audit ([#3188](https://github.com/UMAprotocol/protocol/issues/3188)) ([dd211c4](https://github.com/UMAprotocol/protocol/commit/dd211c4e3825fe007d1161025a34e9901b26031a)), addresses comments to [#3061](https://github.com/UMAprotocol/protocol/issues/3061) [#3054](https://github.com/UMAprotocol/protocol/issues/3054) [#3082](https://github.com/UMAprotocol/protocol/issues/3082) [#3092](https://github.com/UMAprotocol/protocol/issues/3092)
- **chainbridge:** Response to audit ([#3189](https://github.com/UMAprotocol/protocol/issues/3189)) ([97e91cc](https://github.com/UMAprotocol/protocol/commit/97e91cc50a3095fe52bd2bac4d2900ba60235d6a)), addresses comments to [#2969](https://github.com/UMAprotocol/protocol/issues/2969)
- fix polygon deployment scripts for test/local environments ([#3136](https://github.com/UMAprotocol/protocol/issues/3136)) ([d11bb4f](https://github.com/UMAprotocol/protocol/commit/d11bb4ffd7faa19d16938ff702847d1b4fed6c0b))
- **networks file:** fix broken LSP creator address ([#3201](https://github.com/UMAprotocol/protocol/issues/3201)) ([3acbbaa](https://github.com/UMAprotocol/protocol/commit/3acbbaad38f35e332e05d34effa695d4f37d6c3c))

### Features

- **common:** add hardhat plugin to enhance web3 ease of use ([#3180](https://github.com/UMAprotocol/protocol/issues/3180)) ([5aa0335](https://github.com/UMAprotocol/protocol/commit/5aa0335aa8fd4d9ca31b7835a3ada1030e3fb0c3))
- **deployed-addresses:** add ethereum mainnet and polygon mainnet addresses ([#3156](https://github.com/UMAprotocol/protocol/issues/3156)) ([4cfc1ad](https://github.com/UMAprotocol/protocol/commit/4cfc1ad61f683f27d105c79f050938256a16b4ee))
- **hardhat-deploy-scripts:** add hardhat deploy scripts for LSP on test nets ([#3120](https://github.com/UMAprotocol/protocol/issues/3120)) ([804925b](https://github.com/UMAprotocol/protocol/commit/804925b9057fa48cda69901a5c8e174d21b95404))
- **lps-libs:** Update comment in range bond lib ([#3177](https://github.com/UMAprotocol/protocol/issues/3177)) ([5bb9da5](https://github.com/UMAprotocol/protocol/commit/5bb9da5b794c90e858cfd8d8219622ef5f375f81))
- **LSP:** Add LSP pair name, OO liveness and OO bond settings ([#3184](https://github.com/UMAprotocol/protocol/issues/3184)) ([4eaa2e1](https://github.com/UMAprotocol/protocol/commit/4eaa2e1c23065503336e61bf16916cefbab046bc))
- **LSP:** single tx mint-sell & single tx mint-lp ([#3125](https://github.com/UMAprotocol/protocol/issues/3125)) ([3607078](https://github.com/UMAprotocol/protocol/commit/36070783efed583a0db285406efd655c725baacc))
- **LSP:** Validate all logic works as expected with non-18 decimal collateral ([#3129](https://github.com/UMAprotocol/protocol/issues/3129)) ([0d31c78](https://github.com/UMAprotocol/protocol/commit/0d31c78e924325925e40b12b984c14b3fca8ef13))
- **LSP-Broker:** Add ability to mint and LP in one transaction ([#3141](https://github.com/UMAprotocol/protocol/issues/3141)) ([f44b0b8](https://github.com/UMAprotocol/protocol/commit/f44b0b89e1952ceb4a8fd37116f873c42ce5896b))

# [2.4.0](https://github.com/UMAprotocol/protocol/compare/@uma/core@2.3.0...@uma/core@2.4.0) (2021-06-21)

### Bug Fixes

- **common-ContractUtils:** Add web3 param injection to createContractObjectFromJson ([#3060](https://github.com/UMAprotocol/protocol/issues/3060)) ([805003a](https://github.com/UMAprotocol/protocol/commit/805003a94c01f2d8fb4556701382b0f4bbf26cd8))
- **ContractForDiffrence:** general commenting and cleanup ([#3083](https://github.com/UMAprotocol/protocol/issues/3083)) ([422aac5](https://github.com/UMAprotocol/protocol/commit/422aac5832cd6a8518d622f9355bc69a848c1003))
- **disputer:** address wrong comments ([#3025](https://github.com/UMAprotocol/protocol/issues/3025)) ([4c5b70b](https://github.com/UMAprotocol/protocol/commit/4c5b70bf1b3df5c041fe107f200cfeedd08de7ce))

### Features

- **core:** add custom fee set by deployer for LSP ([#3118](https://github.com/UMAprotocol/protocol/issues/3118)) ([b508f53](https://github.com/UMAprotocol/protocol/commit/b508f536ddfd94a79f93f633142bdc868b73461c))
- **LSP:** rename all instances and variants of "contract for difference" to "long short pair" ([#3116](https://github.com/UMAprotocol/protocol/issues/3116)) ([8a68b0f](https://github.com/UMAprotocol/protocol/commit/8a68b0f9919e3ef28f0d031d1ffcc467f6bee860))
- New Deployments ([#3102](https://github.com/UMAprotocol/protocol/issues/3102)) ([05e03ed](https://github.com/UMAprotocol/protocol/commit/05e03edb7b406b0e01e22775e3b544679b743315))
- **CFD:** Add binary option CFD implementation and tests ([#3093](https://github.com/UMAprotocol/protocol/issues/3093)) ([1389537](https://github.com/UMAprotocol/protocol/commit/1389537ccf3767051e570b855963185c319a7a45))
- Updated mainnet OO deployments ([#3096](https://github.com/UMAprotocol/protocol/issues/3096)) ([3c284ef](https://github.com/UMAprotocol/protocol/commit/3c284eff70682d3bea0104933ccc7f11ed4ec019))
- **cfd:** initial CFD stub and tests ([#3016](https://github.com/UMAprotocol/protocol/issues/3016)) ([4595896](https://github.com/UMAprotocol/protocol/commit/45958964a4a32eb2298954b4d306c9647c21c8fc))
- **cfd:** minor improvements to CFD suite ([#3030](https://github.com/UMAprotocol/protocol/issues/3030)) ([c9a9ef1](https://github.com/UMAprotocol/protocol/commit/c9a9ef15b929f70b83d68ca5916864d2a6d21901))
- **CFD:** Add call options financial template library ([#3040](https://github.com/UMAprotocol/protocol/issues/3040)) ([8b9d9d9](https://github.com/UMAprotocol/protocol/commit/8b9d9d9b57eca2b4d2617006eccfd00918858f3d))
- **CFD:** Add range bond financial template library ([#3053](https://github.com/UMAprotocol/protocol/issues/3053)) ([a819f5e](https://github.com/UMAprotocol/protocol/commit/a819f5e3eaaadf353d174fee4cb0006737938baa))
- **Contract-ForDifference:** Add more unit tests and add LinearCFDLib tests ([#3036](https://github.com/UMAprotocol/protocol/issues/3036)) ([967ab13](https://github.com/UMAprotocol/protocol/commit/967ab13ca5ea15bcd0b78b0dee32f2546114f667))
- **contractForDiffrence:** CFD creator contract and unit tests ([#3075](https://github.com/UMAprotocol/protocol/issues/3075)) ([4078bee](https://github.com/UMAprotocol/protocol/commit/4078bee513dbcbf1d8b952f869cb9f907e27302f))
- **core:** add all truffle migrations to hardhat deploy ([#3068](https://github.com/UMAprotocol/protocol/issues/3068)) ([0004bd7](https://github.com/UMAprotocol/protocol/commit/0004bd7401211f628c80198be6ec99cff3156c36))
- **core:** add custom ancillary data to CFD ([#3057](https://github.com/UMAprotocol/protocol/issues/3057)) ([6c8fd40](https://github.com/UMAprotocol/protocol/commit/6c8fd405bc156a8b8765c71f70092f2d0a9d7b0d))
- **DSProxy:** add DSGuard contracts to enable multi-dsproxy ownership ([#3031](https://github.com/UMAprotocol/protocol/issues/3031)) ([b1e9f76](https://github.com/UMAprotocol/protocol/commit/b1e9f76ccf0c870b60a225c07873360d1a2ea0d8))
- **liquidator:** add maxSlippage parameter to single reserve currency liquidator ([#3012](https://github.com/UMAprotocol/protocol/issues/3012)) ([461def6](https://github.com/UMAprotocol/protocol/commit/461def63ccfeeff691d9a4755b8f6cafaf2c1713))
- **oo:** adds optimistic oracle integration tutorial script ([#3086](https://github.com/UMAprotocol/protocol/issues/3086)) ([a0833c9](https://github.com/UMAprotocol/protocol/commit/a0833c9474fe69f21f8c7a640498c4f97dae9714))
- **polygon-amb:** Add Governor Tunnel contracts and unit tests ([#3089](https://github.com/UMAprotocol/protocol/issues/3089)) ([20a3866](https://github.com/UMAprotocol/protocol/commit/20a386693cc380827b3eedd7ff7382b15d7670f3))
- **polygon-amb:** Add Unit Tests for Oracle Tunnel contracts ([#3082](https://github.com/UMAprotocol/protocol/issues/3082)) ([2f8eaf0](https://github.com/UMAprotocol/protocol/commit/2f8eaf0d4c0e9261424aa415cf675a4011849eb8))
- **polygon-fx-tunnel:** Add Oracle tunnel integrating with Polygon hosted Arbitrary Message Bridge ([#3054](https://github.com/UMAprotocol/protocol/issues/3054)) ([a3bf462](https://github.com/UMAprotocol/protocol/commit/a3bf46270787cbaae4ed2218f064b1217c153a50))
- Add hardhat task to migrate identifier whitelist to new contract ([#3046](https://github.com/UMAprotocol/protocol/issues/3046)) ([4e98402](https://github.com/UMAprotocol/protocol/commit/4e98402896fe50a5013c8decfaa0f261363ae33c))
- **price-feed:** Add iFARM price feed configs and HarvestVault template ([#2996](https://github.com/UMAprotocol/protocol/issues/2996)) ([28613db](https://github.com/UMAprotocol/protocol/commit/28613dbfc9bf48f525abce9a403ee9f4d649b499))
- **voting-script:** Update USDETH rounding specification to 8 decimals ([#3055](https://github.com/UMAprotocol/protocol/issues/3055)) ([43fe50c](https://github.com/UMAprotocol/protocol/commit/43fe50c94e0f032e14dc8d67011fcd168323d977))
- Add new deployed Sink and Source Oracle addresses ([#3032](https://github.com/UMAprotocol/protocol/issues/3032)) ([9ed7843](https://github.com/UMAprotocol/protocol/commit/9ed7843eaa1fcab0a1631444cf8d5271c58fbfe8))

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
