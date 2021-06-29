# Optimism Virtual Machine: Compatible Smart Contracts

For the most part, the EVM and the OVM are identical. However the OVM is missing, replaced, or modified certain EVM Opcodes. More details can be found [here](https://community.optimism.io/docs/protocol/evm-comparison.html#frontmatter-title).

The current solution for addressing this transformation problem is using Optimism's [fork](https://github.com/ethereum-optimism/solidity) of the Solidity compiler that applies all of the transformations under the hood. More details about the ever-improving compilation process can be found [here](https://community.optimism.io/docs/developers/integration.html#writing-contracts). This directory contains all of the contracts in this monorepo that can be compiled to the OVM.

# Imported contracts

Importing contracts like those from `@openzeppelin` or `@uniswap` does not work cleanly with the Optimism compiler because `solc` by default tries to compile all contracts in any imported package. Therefore, importing `@openzeppelin/contracts/token/ERC20/IERC20.sol` is not automatically isolated from compiling all contracts in `@openzeppelin/contracts`. So, we copy some of these contracts in the `/external` directory to avoid this issue.

# Whitelisted contracts

The Hardhat compile task is modified in `common/src/hardhat/tasks/compile.js` to allow the user to specify a `compileWhitelist: [...]` array in the hardhat configuration for a specific network. We use this to make sure that `compile --network optimism` only compiles contracts in the `contracts/ovm` directory.
