pragma solidity ^0.5.0;

import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/implementation/Registry.sol";

// TODO(ptare): Make this (and all contracts) Withdrawable.
/**
 * @title Base contract for all financial contract creators
 */
contract ContractCreator {
    address internal finderAddress;

    constructor(address _finderAddress) public {
        finderAddress = _finderAddress;
    }

    function _registerContract(address[] memory parties, address contractToRegister) internal {
        FinderInterface finder = FinderInterface(finderAddress);
        bytes32 registryInterface = "Registry";
        Registry registry = Registry(finder.getImplementationAddress(registryInterface));
        registry.registerDerivative(parties, contractToRegister);
    }
}
