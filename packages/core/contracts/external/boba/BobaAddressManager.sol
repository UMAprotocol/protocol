// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

abstract contract BobaAddressManager {
    /**
     * Retrieves the address associated with a given name.
     * @param _name Name to retrieve an address for.
     * @return Address associated with the given name.
     */
    function getAddress(string memory _name) external view virtual returns (address);
}
