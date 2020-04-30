pragma solidity ^0.6.0;

import "../../common/implementation/Lockable.sol";
import "../interfaces/FinderInterface.sol";
import "./Registry.sol";
import "./Constants.sol";


/**
 * @title Base contract for all financial contract creators
 */
abstract contract ContractCreator is Lockable {
    address internal finderAddress;

    constructor(address _finderAddress) public {
        finderAddress = _finderAddress;
    }

    function _registerContract(address[] memory parties, address contractToRegister) internal nonReentrant() {
        FinderInterface finder = FinderInterface(finderAddress);
        Registry registry = Registry(finder.getImplementationAddress(OracleInterfaces.Registry));
        registry.registerContract(parties, contractToRegister);
    }
}
