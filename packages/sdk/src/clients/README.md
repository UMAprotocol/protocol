# UMA SDK Clients

This folder contains contract interaction clients for the Ethersjs library. This is still in the process of being standardized.

## Clients

- [registry](./registry/README.md): emp registry contract, useful to see all emps registered
- [emps](./emps/README.md): emp contract client, useful for getting emp state and user token/collateral balances

## Creating a Client

Clients should map 1 to 1 to a particular deployed contract.

- create a folder with the name of the contract you want to interact with
- create a README.md to document your interface
- create an index.ts file to expose all functions you want to the sdk
- create an index.test.ts file to run tests

For an example see the [registry client](./registry/README.md)

## Client API

Clients should have a relatively standard and intuitive API. We can leverage typechain and ethers conventions for much of this.

### connect(provider,network):ContractInstance

Connect function connects to a live contract given an address.

### getAddress(network):string

Get deployed address of contract by network if possible

### getEventState(events):State

Get a custom stateful object given a list of events. The context of this state differs based on contract.

### type Networks

Supported network types pulled from the contract artifacts
