# @uma/monitors

This package contains four UMA monitor bot implementations: `BalanceMonitor`, `ContractMonitor`, `CRMonitor`, and `SyntheticPegMonitor`. The monitor bots are used to monitor the UMA ecosystem for key events. They have a number of monitor modules built into them that enable real time reporting on key events for a given Financial Contract.

For more information about running a monitor bot, see the [docs](https://docs.umaproject.org/developers/bots).

## Installing the package

```bash
yarn add @uma/monitors
```

## Running the monitors

The simplest way to run the monitors is:

```bash
EMP_ADDRESS=0x1234 CUSTOM_NODE_URL=https://your.node.url.io MNEMONIC="your mnemonic (12-word seed phrase) here" MONITOR_CONFIG="{optional monitor config object}" monitors --network mainnet_mnemonic
```

## Monitors

The four monitors available are:

1. The `BalanceMonitor` takes a specified list of addresses to monitor and sends alerts if their collateral, synthetic or Ether balance drops below defined thresholds.

1. The `ContractMonitor` sends alerts when financial contract events occur, such as liquidations and disputes.

1. The `CRMonitor`, or collateralization ratio monitor, monitors a given position's CR and sends alerts if it drops below a given threshold.

1. The `SyntheticPegMonitor` monitors a Financial Contract's synthetic and reports when the synthetic is trading off peg and there is high volatility in the synthetic price or there is high volatility in the reference price.
