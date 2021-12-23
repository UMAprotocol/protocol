# Cross Chain Infrastructure

This folder contains contracts that are built on top of bridge protocols to enable UMA's Optimistic Oracle and
Governance contracts to send messages across EVM networks.

# Hub and Spoke Architecture

*Hub and *Spoke contracts are included that are respectively deployed on "Parent" and "Child" networks. As the Hub
and Spoke names imply, one Hub is designed to service many Spokes. For example, the `OracleHub` can broadcast price
resolutions from the DVM on mainnet to any number of `OracleSpoke` contracts on other EVM networks like Polygon,
Arbitrum, Optimism, and more. Similarly, the `GovernorHub` can be used by the DVM to send governance transactions to
any number of `GovernanceSpoke` contracts on other EVM networks.

Hub and Spoke contract implementations are network agnostic, but Messenger contracts are network-specific because
they are the contracts that actually send intra-network messages.

# Parent and Child Messengers

*Hub and *Spoke contracts communicate via a Parent-Child tunnel: a `ParentMessenger` contract is always deployed
to the network that the *Hub contract is deployed to, and the `ChildMessenger` contract is always deployed to the
*Spoke contract's network.

So, *Hub and *Spoke contracts have a "1-to-N" relationship, and each *Hub and *Spoke pairing has one `ParentMessenger`
and `ChildMessenger` contract deployed to the *Hub and *Spoke networks respectively.

Depending on the specific EVM networks that the *Hub and *Spoke contracts are deployed to, the implementations of the
Messenger contracts will differ. For example, sending messages between Mainnet and Arbitrum requires calling different
system contract interfaces than sending messages between Mainnet and Polygon does. This is why each network has its own
Messenger contract implementation in the `/chain-adapters` folder.

# Post-Deployment and configuration of the Hub and Spoke contracts

- `OracleHub`: Call `setMessenger` to map the `ParentMessenger` contract that should be used to communicate with child
  networks identified by their chain ID.
- `GovernorHub`: Similar to `OracleHub`, call `setMessenger` for each child network.
- The `Finder` contract on the `Spoke` network needs to have an address for the `ChildMessenger` so that the
  `OracleSpoke` contract can send transactions cross-chain.

# Post-Deployment and configuration of the Messenger contracts

See the `/chain-adapters` folder for network-specific setup details since each Messenger implementation is unique.
However, all `ParentMessenger` contracts inherit the `ParentMessengerBase` contract which requires that the caller
calls the following functions:

- `setChildMessenger()`
- `setOracleHub()`
- `setOracleSpoke()`
- `setGovernorHub()`
- `setGovernorSpoke()`
