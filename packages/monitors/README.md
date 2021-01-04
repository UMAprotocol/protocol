# @uma/monitors

This package contains four UMA monitor bot implementations: `BalanceMonitor`, `ContractMonitor`, `CRMonitor`, and `SyntheticPegMonitor`. The monitor bots are used to monitor the UMA ecosystem for key events. They have a number of monitor modules built into them that enable real time reporting on key events for a given EMP contract.

For more information about running a monitor bot, see the [docs](https://docs.umaproject.org/developers/bots).

## Installing the package

```bash
yarn add @uma/monitors
```

## Running the monitors

The config below will start up a monitor bot that will: (1) send messages when new liquidations, alerts, or disputes occur and (2) fire if there is large volatility in the synthetic or price of the underlying. It won't report on any wallet or CR monitoring as no params have been defined.

```bash
EMP_ADDRESS=0x1234 CUSTOM_NODE_URL=your.node.url MNEMONIC="your mnemonic here" yarn monitors --network mainnet_mnemonic
```

## Monitors

The four monitors available are:

1. The `BalanceMonitor` takes a specified list of addresses to monitor and sends alerts if their collateral, synthetic or Ether balance drops below defined thresholds.

1. The `ContractMonitor` sends alerts when financial contract events occur, such as liquidations and disputes.

1. The `CRMonitor`, or collateralization ratio monitor, monitors a given position's CR and sends alerts if it drops below a given threshold.

1. The `SyntheticPegMonitor` monitors an EMP's synthetic and reports when the synthetic is trading off peg and there is high volatility in the synthetic price or there is high volatility in the reference price.
