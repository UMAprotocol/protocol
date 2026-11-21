# DisputeRouter Oracle cutover on Polygon

These scripts propose, execute and verify a governance vote that makes the deployed `DisputeRouter` proxy the
`Oracle` on Polygon. The proposal relays the following calls from `GovernorRootTunnel` to Polygon, in order:

1. `Registry.addMember(CONTRACT_CREATOR, GovernorChildTunnel)`
2. `Registry.registerContract([], DisputeRouter)`, so the router can request prices from `OracleChildTunnel` and read
   legacy prices
3. `Registry.removeMember(CONTRACT_CREATOR, GovernorChildTunnel)`
4. `Finder.changeImplementationAddress("Oracle", DisputeRouter)`

Start with building the packages from the root of the repository:

```sh
yarn && yarn build
```

## Testing on forked networks

Spin up forked networks, each in a separate terminal. The repository's hardhat node cannot fork recent mainnet blocks
(they lack `totalDifficulty`), so use anvil:

```sh
anvil --fork-url https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --chain-id 1

anvil --fork-url https://polygon-mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9546 --chain-id 137
```

Ethereum mainnet must use port `9545` as the scripts rely on the hardhat `localhost` network when forking.

Export the required environment:

```sh
export MNEMONIC=<YOUR-MNEMONIC>
export NODE_URL_1=http://localhost:9545
export NODE_URL_137=http://localhost:9546
```

The scripts target the deployed `DisputeRouter` proxy `0x90326E769C9371AFd379eAB03Bbd3c4d4ca4e783` by default; set
`ROUTER_ADDRESS` to override it.

Make sure the wallet corresponding to the `MNEMONIC` is funded on the forked mainnet (use `hardhat_setBalance` if
needed).

Impersonate accounts and seed the proposer wallet on the forked mainnet:

```sh
./packages/scripts/setupFork.sh
```

Propose the governance vote on the forked mainnet:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/dispute-router-cutover/0_Propose.ts --network localhost
```

Simulate the vote on the proposal without executing it yet:

```sh
SKIP_EXECUTE=1 yarn hardhat run packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost
```

Execute the proposal on the forked mainnet and spoof relaying the governance transactions to forked Polygon (as
`FxChild` delivering to `GovernorChildTunnel`):

```sh
yarn hardhat run packages/scripts/src/admin-proposals/dispute-router-cutover/1_Execute.ts --network localhost
```

Verify the proposal execution on forked Polygon:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/dispute-router-cutover/2_Verify.ts --network localhost
```

## Cutover on public networks

Export `NODE_URL_1` and `NODE_URL_137` pointing to public networks.

There is no UMIP for this change. The voter dapp shows the title and description of the `umip` Contentful entry whose
`number` matches the admin proposal number, so publish that entry before the vote starts.

Propose the governance vote on mainnet (authenticate to `gcloud` first):

```sh
GCKMS_WALLET=deployer yarn hardhat run packages/scripts/src/admin-proposals/dispute-router-cutover/0_Propose.ts --network mainnet
```

If the vote is resolved to approve the cutover, execute the proposal on mainnet and wait for it to be relayed to
Polygon:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/dispute-router-cutover/1_Execute.ts --network mainnet
```

Verify the proposal execution on Polygon:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/dispute-router-cutover/2_Verify.ts --network mainnet
```
