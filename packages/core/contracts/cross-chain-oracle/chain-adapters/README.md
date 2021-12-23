## Configuration Details

Setting up contracts for each type of network are different.

# Nomad setup

- `ChildMessenger`:
  - The `Finder` requires the following contracts to have addresses:
    - `XAppConnectionManager` to send messages cross chain.
    - `OracleSpoke` is the only contract that can send messages.
    - `ParentMessenger` to set as the cross chain message recipient.
- `ParentMessenger`:
  - The `Finder` requires the following contracts to have addresses:
    - `XAppConnectionManager` to send messages cross chain.
