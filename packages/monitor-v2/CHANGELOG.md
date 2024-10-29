# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.9.2](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.9.0...@uma/monitor-v2@1.9.2) (2024-10-28)

**Note:** Version bump only for package @uma/monitor-v2

## [1.9.1](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.9.0...@uma/monitor-v2@1.9.1) (2024-10-25)

**Note:** Version bump only for package @uma/monitor-v2

# [1.9.0](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.8.0...@uma/monitor-v2@1.9.0) (2024-07-20)

### Bug Fixes

- osnap bot on disputed proposals ([#4768](https://github.com/UMAprotocol/protocol/issues/4768)) ([30ab4dd](https://github.com/UMAprotocol/protocol/commit/30ab4dd0a6f4465902bf10896c11188e4cafb4b4))

### Features

- **monitor-v2:** add simple retry logic to polymarket graph call ([#4766](https://github.com/UMAprotocol/protocol/issues/4766)) ([de4c47e](https://github.com/UMAprotocol/protocol/commit/de4c47ea21dc797a7bc77565ceb3910e94656168))
- Prevent reproposing disputed proposals in snapshot ([#4765](https://github.com/UMAprotocol/protocol/issues/4765)) ([619910b](https://github.com/UMAprotocol/protocol/commit/619910b144cc27a8d1fe8ae4653a44d321f04993))
- support multiple safes in osnap plugin ([#4759](https://github.com/UMAprotocol/protocol/issues/4759)) ([ff46ab6](https://github.com/UMAprotocol/protocol/commit/ff46ab6e4e4ffa5358cb816e39a5d48c0ae1e1fa))

# [1.8.0](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.7.0...@uma/monitor-v2@1.8.0) (2024-04-30)

### Features

- support blast in dvm price publisher ([#4755](https://github.com/UMAprotocol/protocol/issues/4755)) ([f9f61e9](https://github.com/UMAprotocol/protocol/commit/f9f61e913c30fe1704c078be6acd52994166206b))

# [1.7.0](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.6.0...@uma/monitor-v2@1.7.0) (2024-04-09)

### Features

- support base in dvm price publisher ([#4735](https://github.com/UMAprotocol/protocol/issues/4735)) ([0684a59](https://github.com/UMAprotocol/protocol/commit/0684a59d2abbc5f64d7b1ce475ea2b82c6261e0d))
- update polymarket notifier logic ([#4721](https://github.com/UMAprotocol/protocol/issues/4721)) ([4ca19ec](https://github.com/UMAprotocol/protocol/commit/4ca19ec10e798ac6b205e96304be4d35553ea9dc))

# [1.6.0](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.5.1...@uma/monitor-v2@1.6.0) (2024-03-07)

### Bug Fixes

- oSnap automation polygon gas price estimation ([#4699](https://github.com/UMAprotocol/protocol/issues/4699)) ([0439ac4](https://github.com/UMAprotocol/protocol/commit/0439ac4dfeb26b48b51a48fc5c13ddba38c93f36))
- polymarket api resolvedBy can be null ([#4716](https://github.com/UMAprotocol/protocol/issues/4716)) ([62841b8](https://github.com/UMAprotocol/protocol/commit/62841b8c74e344013ed6a6159bf279d3bae72b35))
- remove vote periods from osnap ipfs verification ([#4704](https://github.com/UMAprotocol/protocol/issues/4704)) ([bc7aef9](https://github.com/UMAprotocol/protocol/commit/bc7aef9dc60190909036e1418647f429f3702096))

### Features

- add new polymarket adapter to notifier ([#4675](https://github.com/UMAprotocol/protocol/issues/4675)) ([fb3e604](https://github.com/UMAprotocol/protocol/commit/fb3e604cae657a9851f33016f90b1e1e8bb56f92))
- add polymarket api key to notifier ([#4690](https://github.com/UMAprotocol/protocol/issues/4690)) ([565f238](https://github.com/UMAprotocol/protocol/commit/565f23855b6af5461611e09a71a7cace02023e66))
- find markets ancillary data by adapter ([#4692](https://github.com/UMAprotocol/protocol/issues/4692)) ([1255d2c](https://github.com/UMAprotocol/protocol/commit/1255d2cd9967588f61ba7b48ef70c8ab5c96a81c))
- fix polymarket notifier ancillary data fetching ([#4693](https://github.com/UMAprotocol/protocol/issues/4693)) ([b7ab330](https://github.com/UMAprotocol/protocol/commit/b7ab330c786521c1569f89ce8f00674f35018f7b))
- generic balance monitor ([#4670](https://github.com/UMAprotocol/protocol/issues/4670)) ([1496075](https://github.com/UMAprotocol/protocol/commit/1496075c840b18690c6c9bd409d168f62ff09a2e))
- impose gas usage limit for automated osnap execution ([#4677](https://github.com/UMAprotocol/protocol/issues/4677)) ([d71f315](https://github.com/UMAprotocol/protocol/commit/d71f315f671fbf9ee0cad1cbad6ce569a29455b6))
- new snapshot proposal notifier ([#4671](https://github.com/UMAprotocol/protocol/issues/4671)) ([96cf5be](https://github.com/UMAprotocol/protocol/commit/96cf5be32a3f57ac761f004890dd3466c63e1fa5))
- polymarket event not found tracking ([#4691](https://github.com/UMAprotocol/protocol/issues/4691)) ([71da258](https://github.com/UMAprotocol/protocol/commit/71da2587b97bb5bf928019ac39a07bd13225fa22))
- skip disputes and execution for blacklisted assertions ([#4666](https://github.com/UMAprotocol/protocol/issues/4666)) ([ae65ded](https://github.com/UMAprotocol/protocol/commit/ae65deda00cbfbe466fe666c93ac236e8a552ee7))

## [1.5.1](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.5.0...@uma/monitor-v2@1.5.1) (2023-11-13)

### Bug Fixes

- allow trailing slash after space in osnap rules ([#4653](https://github.com/UMAprotocol/protocol/issues/4653)) ([c02a772](https://github.com/UMAprotocol/protocol/commit/c02a772a43e7e29c8445ed9ed3f042bc328f017c))
- do not dispute ipfs server errors by default ([#4657](https://github.com/UMAprotocol/protocol/issues/4657)) ([8c997b9](https://github.com/UMAprotocol/protocol/commit/8c997b93123759c5839ecff0403702940124f54d))
- suppress error based on balance ([#4656](https://github.com/UMAprotocol/protocol/issues/4656)) ([e8b3ef6](https://github.com/UMAprotocol/protocol/commit/e8b3ef63bbf59fa1af708686f038303dcf500d75))

# [1.5.0](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.4.0...@uma/monitor-v2@1.5.0) (2023-10-13)

### Features

- osnap plugin support in bots ([#4642](https://github.com/UMAprotocol/protocol/issues/4642)) ([3550aaf](https://github.com/UMAprotocol/protocol/commit/3550aafaec2f51ad86488bd3c59c9c101144ac01))

# [1.4.0](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.3.0...@uma/monitor-v2@1.4.0) (2023-09-28)

### Bug Fixes

- **monitor-v2:** filter blocking osnap proposals ([#4604](https://github.com/UMAprotocol/protocol/issues/4604)) ([d314228](https://github.com/UMAprotocol/protocol/commit/d314228f5bae1e7ba03eca7cc98fe20c6fb7d7d1))
- **monitor-v2:** settle all promises in osnap bot ([#4626](https://github.com/UMAprotocol/protocol/issues/4626)) ([b1ee45e](https://github.com/UMAprotocol/protocol/commit/b1ee45e0b89c46c9ae262284d68276b8c6bcda96))
- **monitor-v2:** wait for logger ([#4611](https://github.com/UMAprotocol/protocol/issues/4611)) ([f009fb5](https://github.com/UMAprotocol/protocol/commit/f009fb5349d5213b65a56c07c66b243ffbafa1fa))

### Features

- add discord ticket channel for oo verification ([#4612](https://github.com/UMAprotocol/protocol/issues/4612)) ([ae09692](https://github.com/UMAprotocol/protocol/commit/ae096928f795765c8f18bab38a305825b4038825))
- add llm filter interface ([#4594](https://github.com/UMAprotocol/protocol/issues/4594)) ([6aaf13b](https://github.com/UMAprotocol/protocol/commit/6aaf13b75396d94288a2856502903a33900f2922))
- add llm oov2 disputable request filter ([#4621](https://github.com/UMAprotocol/protocol/issues/4621)) ([4ccd553](https://github.com/UMAprotocol/protocol/commit/4ccd553e62f7e17a48d8372c8c82fc3b49dca3e4))
- add llm strategy class ([#4597](https://github.com/UMAprotocol/protocol/issues/4597)) ([32a8f57](https://github.com/UMAprotocol/protocol/commit/32a8f57b680b590fec14c38bca51ead5e3ba29d5))
- base oov2 client implementation ([#4606](https://github.com/UMAprotocol/protocol/issues/4606)) ([9a2ce51](https://github.com/UMAprotocol/protocol/commit/9a2ce51d9b35bcc59ef72c9292afd867d9f00009))
- dedicated channel for oo disputes ([#4635](https://github.com/UMAprotocol/protocol/issues/4635)) ([92d726f](https://github.com/UMAprotocol/protocol/commit/92d726fb1bcdb55002d65f3a43f1a9483c4d5c2a))
- **monitor-v2:** add disable tx option on osnap automation ([#4603](https://github.com/UMAprotocol/protocol/issues/4603)) ([bcea0e6](https://github.com/UMAprotocol/protocol/commit/bcea0e61b3ae7fe79db7c5ced851f0d03fa1cf06))
- **monitor-v2:** handle failed verification due to server errors ([#4613](https://github.com/UMAprotocol/protocol/issues/4613)) ([651bee3](https://github.com/UMAprotocol/protocol/commit/651bee3e70c6e0b2222e6e976026bc960e3298ac))
- **monitor-v2:** osnap executor ([#4596](https://github.com/UMAprotocol/protocol/issues/4596)) ([2e53f84](https://github.com/UMAprotocol/protocol/commit/2e53f84cc66f43bf6eda4befd798ca393f782622))
- **monitor-v2:** validate osnap explanation ([#4620](https://github.com/UMAprotocol/protocol/issues/4620)) ([3a20e7c](https://github.com/UMAprotocol/protocol/commit/3a20e7cf2d96663d83ff0bdac7f7092a56aff689))

# [1.3.0](https://github.com/UMAprotocol/protocol/compare/@uma/monitor-v2@1.2.0...@uma/monitor-v2@1.3.0) (2023-07-17)

### Bug Fixes

- **monitor-v2:** check osnap replay attacks ([#4588](https://github.com/UMAprotocol/protocol/issues/4588)) ([29e82c3](https://github.com/UMAprotocol/protocol/commit/29e82c325723c66afc62b7c1bbbdec22c9a67f0b))
- **monitor-v2:** document tenderly env ([#4592](https://github.com/UMAprotocol/protocol/issues/4592)) ([3d0cc9c](https://github.com/UMAprotocol/protocol/commit/3d0cc9c18b57a2634ec4941d0bd745c6bcf1676e))
- **monitor-v2:** log osnap proposal/dispute errors ([#4599](https://github.com/UMAprotocol/protocol/issues/4599)) ([c400044](https://github.com/UMAprotocol/protocol/commit/c4000448003df7b190d45464c55b1251bbc6d72f))
- **monitor-v2:** update pm readme ([#4595](https://github.com/UMAprotocol/protocol/issues/4595)) ([4553385](https://github.com/UMAprotocol/protocol/commit/4553385ab3d2eda9b0656a91f6bb826cf7233eef))
- **monitor-v2:** use sets for osnap bots ([#4598](https://github.com/UMAprotocol/protocol/issues/4598)) ([3a195b4](https://github.com/UMAprotocol/protocol/commit/3a195b42ef2d08b7042c0fe4048e6c43e8fa27e3))
- notified polymarket markets storage ([#4582](https://github.com/UMAprotocol/protocol/issues/4582)) ([e23b975](https://github.com/UMAprotocol/protocol/commit/e23b9754f7dd0a9fca26ce3277e4923119ced4ff))
- polymarket notifier to use latest proposal for market ([#4555](https://github.com/UMAprotocol/protocol/issues/4555)) ([e48b0fb](https://github.com/UMAprotocol/protocol/commit/e48b0fb10f407a5404122ea40c3584a262352b9b))
- polymarket order filled filtering ([#4562](https://github.com/UMAprotocol/protocol/issues/4562)) ([79b7489](https://github.com/UMAprotocol/protocol/commit/79b74898e04077acd23358b4f370df82e69a7885))
- speed up readme ([#4566](https://github.com/UMAprotocol/protocol/issues/4566)) ([dae36c1](https://github.com/UMAprotocol/protocol/commit/dae36c1c692e9767293b811c503ce81251509c27))

### Features

- **monitor-v2:** osnap disputer ([#4591](https://github.com/UMAprotocol/protocol/issues/4591)) ([fc448fd](https://github.com/UMAprotocol/protocol/commit/fc448fd60c988cbf83b91e3d93dde8537e18a4e9))
- **monitor-v2:** osnap proposer ([#4585](https://github.com/UMAprotocol/protocol/issues/4585)) ([f1854ba](https://github.com/UMAprotocol/protocol/commit/f1854bad585fbd58bc079e4bd02aafe845c46e7f))
- add llm bot oo client class ([#4589](https://github.com/UMAprotocol/protocol/issues/4589)) ([49ab479](https://github.com/UMAprotocol/protocol/commit/49ab4794f20ff198756dd297210aed3e2d08f333))
- **monitor-v2:** add retry logic to snapshot verification ([#4578](https://github.com/UMAprotocol/protocol/issues/4578)) ([58c53a2](https://github.com/UMAprotocol/protocol/commit/58c53a255b949b79a4dcbc26495b2491114ca8d3))
- **monitor-v2:** add tenderly simulation to osnap proposals ([#4587](https://github.com/UMAprotocol/protocol/issues/4587)) ([48a4f66](https://github.com/UMAprotocol/protocol/commit/48a4f66f1c7911f77c698693ef187acc20d78483))
- **monitor-v2:** add ui links in og and oov3 monitors ([#4544](https://github.com/UMAprotocol/protocol/issues/4544)) ([acb8551](https://github.com/UMAprotocol/protocol/commit/acb8551576008f4ea7a1142db7f33b016f1d8a34))
- **monitor-v2:** automatic og discovery ([#4560](https://github.com/UMAprotocol/protocol/issues/4560)) ([0fff41e](https://github.com/UMAprotocol/protocol/commit/0fff41ef31dbbc62672c699c82d79a748550e777))
- **monitor-v2:** automatic osnap proposal verification ([#4571](https://github.com/UMAprotocol/protocol/issues/4571)) ([4fa5c04](https://github.com/UMAprotocol/protocol/commit/4fa5c04125da1d77a8779aceac2da97f86607931))
- add price request resolve and speed up scripts ([#4557](https://github.com/UMAprotocol/protocol/issues/4557)) ([a13acea](https://github.com/UMAprotocol/protocol/commit/a13acea9ce8a33056b52969ec9ae65fa3658d65a))
- cross chain publisher bot ([#4527](https://github.com/UMAprotocol/protocol/issues/4527)) ([7e0b8aa](https://github.com/UMAprotocol/protocol/commit/7e0b8aa37b60f80eb785149a8f97d3da09c2d4d3))
- polymarket notifier update ([#4561](https://github.com/UMAprotocol/protocol/issues/4561)) ([3302d50](https://github.com/UMAprotocol/protocol/commit/3302d50ac9268ec1858ad4936972a3100d51ae6d))
- **monitor-v2:** monitor og deployments ([#4558](https://github.com/UMAprotocol/protocol/issues/4558)) ([9a5e5db](https://github.com/UMAprotocol/protocol/commit/9a5e5dba150379c44c1f17c3e5f69f6bfc6069d2))
- turn on errors polymarket notifier ([#4546](https://github.com/UMAprotocol/protocol/issues/4546)) ([7b6ad39](https://github.com/UMAprotocol/protocol/commit/7b6ad391be3d8d956e8d4db344bc7cf2e05a9e1c))

# [1.2.0](https://github.com/UMAprotocol/protocol/compare/monitor-v2@1.1.2...monitor-v2@1.2.0) (2023-04-18)

### Bug Fixes

- **monitor-v2:** og startup and error messages ([#4525](https://github.com/UMAprotocol/protocol/issues/4525)) ([205a329](https://github.com/UMAprotocol/protocol/commit/205a329c059441f3103757083d47274ee251c167))

### Features

- settle assertions bot ([#4501](https://github.com/UMAprotocol/protocol/issues/4501)) ([8e282c9](https://github.com/UMAprotocol/protocol/commit/8e282c9592fa5d9b95cece9dd8992abb03cb005c))

## [1.1.2](https://github.com/UMAprotocol/protocol/compare/monitor-v2@1.1.1...monitor-v2@1.1.2) (2023-03-30)

**Note:** Version bump only for package monitor-v2

## [1.1.1](https://github.com/UMAprotocol/protocol/compare/monitor-v2@1.1.0...monitor-v2@1.1.1) (2023-03-23)

### Bug Fixes

- **og:** L-04 - Rename SetBond event to SetCollateralAndBond ([#4489](https://github.com/UMAprotocol/protocol/issues/4489)) ([cf6b68f](https://github.com/UMAprotocol/protocol/commit/cf6b68fe3d823b5dd8fefc3fff35d33a03a09320))

# [1.1.0](https://github.com/UMAprotocol/protocol/compare/monitor-v2@1.0.1...monitor-v2@1.1.0) (2023-03-16)

### Bug Fixes

- monitor-v2 block range in serverless ([#4476](https://github.com/UMAprotocol/protocol/issues/4476)) ([34c0fc3](https://github.com/UMAprotocol/protocol/commit/34c0fc355b793bf061185e839646cb64d5ef1d5a))
- request timing in dvm2 monitor tests ([#4474](https://github.com/UMAprotocol/protocol/issues/4474)) ([fb23b88](https://github.com/UMAprotocol/protocol/commit/fb23b88d03d66c1077a14f2fe43f87904c18a239))

### Features

- add notification path for oov3 monitor ([#4475](https://github.com/UMAprotocol/protocol/issues/4475)) ([7ea0dda](https://github.com/UMAprotocol/protocol/commit/7ea0dda53baf733299e3b9ecc29cf9d0d702c368))
- add optimistic governor monitoring scripts ([#4483](https://github.com/UMAprotocol/protocol/issues/4483)) ([19ed495](https://github.com/UMAprotocol/protocol/commit/19ed495312d304e6c9a63f9afd1d91b77ccf6df0))

## [1.0.1](https://github.com/UMAprotocol/protocol/compare/monitor-v2@1.0.0...monitor-v2@1.0.1) (2023-02-28)

### Bug Fixes

- addres issues with health-check-runner with slack and pagerduty ([#4455](https://github.com/UMAprotocol/protocol/issues/4455)) ([d8ce989](https://github.com/UMAprotocol/protocol/commit/d8ce989b92dc9afc7a183073d902dfe3f667a709))
- allow monitors to flush log transport ([#4464](https://github.com/UMAprotocol/protocol/issues/4464)) ([d7fd2f8](https://github.com/UMAprotocol/protocol/commit/d7fd2f8651cc9b81a2717500d5b673083952c8a1))
- dvm monitor name ([#4462](https://github.com/UMAprotocol/protocol/issues/4462)) ([dd2f47d](https://github.com/UMAprotocol/protocol/commit/dd2f47d71b502dd768a79ab6e0f18a4592190e26))
- fix an issue in the health check ([#4463](https://github.com/UMAprotocol/protocol/issues/4463)) ([781cd36](https://github.com/UMAprotocol/protocol/commit/781cd36d1c401908947d4721708d5772dbc89a22))
