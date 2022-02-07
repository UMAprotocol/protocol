# Admin Proposal Helper Scripts

This folder contains scripts that facilitate the testing of proposing admin price requests to the DVM. Admin proposals are the final step in the [UMIP](https://docs.umaproject.org/uma-tokenholders/umips) process, which is how UMA token holders govern the UMA protocol.

## Mainnet fork

These scripts can be easily run against a local (hardhat) [Mainnet fork](https://hardhat.org/guides/mainnet-forking.html) in order to test that the DVM contract state is modified as expected following a [simulated vote](https://docs.umaproject.org/uma-tokenholders/uma-holders#voting-on-price-requests). The local node should be set to run on port `9545`.

## Relaying governance to another non-mainnet network

Admin proposals can be relayed from Ethereum to another network like Polygon like in [this example](https://github.com/UMAprotocol/protocol/blob/349401a869e89f9b5583d34c1f282407dca021ac/packages/core/test/polygon/e2e.js#L221). This just requires that the `NODE_URL_[netId]` is set so that the script can also query network information from the other network.

Valid networks that can be administrated this way are those that have governance channels set up to communicate from the network to L1. The following networks are currently supported:

- Arbitrum, net ID 42161
- Optimism, net ID 10
- Boba, net ID 288
- Polygon, net ID 137

## Full example: simulating submitting an Admin proposal to whitelist collateral on Ethereum and Polygon

1. Open a terminal window and start a mainnet fork node locally:

```sh
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/YOUR-INFURA-KEY --no-deploy --port 9545
```

Be sure to set `NODE_URL_1=http://localhost:9545` in your environment if you want to continue running scripts against the forked mainnet network.

2. Request to impersonate accounts we'll need to propose and vote on admin proposals. This script will also mint the
   wallet enough UMA required to submit a new governance proposal.

```sh
./packages/scripts/setupFork.sh
```

3. Propose the admin proposal to whitelist 9 new collateral types on Ethereum and 2 on polygon:

Make sure that `NODE_URL_1` and `NODE_URL_137` are set in the environment.

```sh
node ./packages/scripts/admin-proposals/collateral.js \
    --ethereum 0x3472a5a71965499acd81997a54bba8d852c6e53d,0x383518188c0c6d7730d91b2c03a03c837814a899,0x875773784af8135ea0ef43b5a374aad105c5d39e,0x6810e776880c02933d47db1b9fc05908e5386b96,,0x0cec1a9154ff802e7934fc916ed7ca50bde6844e,0xad32A8e6220741182940c5aBF610bDE99E737b2D,0x956F47F50A910163D8BF957Cf5846D573E7f87CA,0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B,0xc770eefad204b5180df6a14ee197d99d808ee52d \
    --polygon 0x1fcbe5937b0cc2adf69772d228fa4205acf4d9b2,,,,0x580a84c73811e1839f75d86d75d88cca0c241ff4,,,,, \
    --fee 60,0.8,130,3,500,45,1100,400,800,670 \
    --network mainnet-fork
```

4. Simulate voting on the proposal and executing the approved proposal:

```sh
node ./packages/scripts/src/admin-proposals/simulateVote.js --network mainnet-fork
```

5. Verify that executing the proposal modified DVM state as expected:

```sh
node ./packages/scripts/src/admin-proposals/collateral.js \
    --ethereum 0x3472a5a71965499acd81997a54bba8d852c6e53d,0x383518188c0c6d7730d91b2c03a03c837814a899,0x875773784af8135ea0ef43b5a374aad105c5d39e,0x6810e776880c02933d47db1b9fc05908e5386b96,,0x0cec1a9154ff802e7934fc916ed7ca50bde6844e,0xad32A8e6220741182940c5aBF610bDE99E737b2D,0x956F47F50A910163D8BF957Cf5846D573E7f87CA,0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B,0xc770eefad204b5180df6a14ee197d99d808ee52d \
    --polygon 0x1fcbe5937b0cc2adf69772d228fa4205acf4d9b2,,,,0x580a84c73811e1839f75d86d75d88cca0c241ff4,,,,, \
    --fee 60,0.8,130,3,500,45,1100,400,800,670 \
    --verify \
    --network mainnet-fork
```

6. Retrieve bond staked for submitting proposal:

```
node ./packages/scripts/src/admin-proposals/resolveProposal.js \
    --sender 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 \
    --network mainnet-fork
```

## Running on a public network in production mode

For production, simply run the script with a production network passed to the `--network` flag (along with other params like --keys) like so: `node ... --network mainnet_gckms --keys deployer`.
