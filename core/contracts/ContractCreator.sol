pragma solidity ^0.5.0;

import "./Finder.sol";
import "./Registry.sol";


// TODO(ptare): Make this (and all contracts) Withdrawable.
contract ContractCreator {
    address internal finderAddress;
    address internal adminAddress;

    constructor(
        address _finderAddress,
        address _adminAddress
    ) public {
        finderAddress = _finderAddress;
        adminAddress = _adminAddress;
    }

    function _registerContract(address[] memory parties, address contractToRegister) internal {
        Finder finder = Finder(finderAddress);
        bytes32 registryInterface = "Registry";
        Registry registry = Registry(finder.getImplementationAddress(registryInterface));
        registry.registerDerivative(parties, contractToRegister);
    }
}
