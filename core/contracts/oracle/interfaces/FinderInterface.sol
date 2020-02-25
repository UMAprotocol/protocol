pragma solidity ^0.6.0;

/**
 * @title Provides addresses of the live contracts implementing certain interfaces. 
 * @dev Examples are the Oracle or Store interfaces.
 */
interface FinderInterface {
    /**
     * @dev Updates the address of the contract that implements `interfaceName`.
     */
    function changeImplementationAddress(bytes32 interfaceName, address implementationAddress) external;

    /**
     * @dev Gets the address of the contract that implements the given `interfaceName`.
     */
    function getImplementationAddress(bytes32 interfaceName) external view returns (address implementationAddress);
}
