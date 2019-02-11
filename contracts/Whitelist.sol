/*
  Simple Address Whitelist
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


contract AddressWhitelist is Ownable {
    mapping(address => bool) private whitelist;

    // Adds an address to the whitelist
    function addToWhitelist(address newElement) external onlyOwner {
        whitelist[newElement] = true;
    }

    // Removes an address from the whitelist.
    function removeFromWhitelist(address elementToRemove) external onlyOwner {
        whitelist[elementToRemove] = false;
    }

    // Checks whether an address is on the whitelist.
    function isOnWhitelist(address elementToCheck) external view returns (bool) {
        return whitelist[elementToCheck];
    }
}