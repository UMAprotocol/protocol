# Admin Proposal Helper Scripts

This folder contains scripts that facilitate the testing of proposing admin price requests to the DVM. Admin proposals are the final step in the [UMIP](https://docs.umaproject.org/uma-tokenholders/umips) process, which is how UMA token holders govern the UMA protocol.

## Mainnet fork

These scripts are expected by default to run against a local (hardhat) [Mainnet fork](https://hardhat.org/guides/mainnet-forking.html) in order to test that the DVM contract state is modified as expected following a [simulated vote](https://docs.umaproject.org/uma-tokenholders/uma-holders#voting-on-price-requests). The local node should be set to run on port `9545`.

## Relaying governance to Polygon

Admin proposals can be relayed from Ethereum to Polygon like in [this example](https://github.com/UMAprotocol/protocol/blob/349401a869e89f9b5583d34c1f282407dca021ac/packages/core/test/polygon/e2e.js#L221). This just requires that the `POLYGON_NODE_URL` is set so that the script can also query network information from Polygon.

## Full example: simulating submitting an Admin proposal to whitelist collateral on Ethereum and Polygon

1. Open a terminal window and start a mainnet fork node locally:

```sh
yarn hardhat node --fork https://mainnet.infura.io/v3/YOUR-INFURA-KEY --no-deploy --port 9545
```

2. Request to impersonate accounts we'll need to propose and vote on admin proposals:

```sh
./packages/scripts/setupFork.sh
```

3. Propose the admin proposal to whitelist 9 new collateral types on Ethereum and 2 on polygon:

```sh
node ./packages/scripts/admin-proposals/collateral.js \
    --collateral 0x3472a5a71965499acd81997a54bba8d852c6e53d,0x383518188c0c6d7730d91b2c03a03c837814a899,0x875773784af8135ea0ef43b5a374aad105c5d39e,0x6810e776880c02933d47db1b9fc05908e5386b96,,0x0cec1a9154ff802e7934fc916ed7ca50bde6844e,0xad32A8e6220741182940c5aBF610bDE99E737b2D,0x956F47F50A910163D8BF957Cf5846D573E7f87CA,0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B,0xc770eefad204b5180df6a14ee197d99d808ee52d \
    --polygon 0x1fcbe5937b0cc2adf69772d228fa4205acf4d9b2,,,,0x580a84c73811e1839f75d86d75d88cca0c241ff4,,,,, \
    --fee 60,0.8,130,3,500,45,1100,400,800,670 \
    --network mainnet-fork
```

4. Simulate voting on the proposal and executing the approved proposal:

```sh
node ./packages/scripts/admin-proposals/simulateVote.js --network mainnet-fork
```

5. Verify that executing the proposal modified DVM state as expected:

```sh
node ./packages/scripts/admin-proposals/collateral.js \
    --collateral 0x3472a5a71965499acd81997a54bba8d852c6e53d,0x383518188c0c6d7730d91b2c03a03c837814a899,0x875773784af8135ea0ef43b5a374aad105c5d39e,0x6810e776880c02933d47db1b9fc05908e5386b96,,0x0cec1a9154ff802e7934fc916ed7ca50bde6844e,0xad32A8e6220741182940c5aBF610bDE99E737b2D,0x956F47F50A910163D8BF957Cf5846D573E7f87CA,0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B,0xc770eefad204b5180df6a14ee197d99d808ee52d \
    --polygon 0x1fcbe5937b0cc2adf69772d228fa4205acf4d9b2,,,,0x580a84c73811e1839f75d86d75d88cca0c241ff4,,,,, \
    --fee 60,0.8,130,3,500,45,1100,400,800,670 \
    --verify \
    --network mainnet-fork
```
