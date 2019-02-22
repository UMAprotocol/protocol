/*
  Simple Address Whitelist
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


contract AddressWhitelist is Ownable {
    mapping(address => bool) private whitelist;

    uint private count;
    mapping(uint => address) private whitelistIndices;

    // Adds an address to the whitelist
    function addToWhitelist(address newElement) external onlyOwner {
        if (whitelist[newElement]) {
            return;
        }

        whitelistIndices[count] = newElement;
        count++;

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

    function getWhitelist() external view returns (address[] memory activeWhitelist) {
        uint activeCount = 0;
        for (uint i = 0; i < count; i++) {
            if (whitelist[whitelistIndices[i]]) {
                activeCount++;
            }
        }

        activeWhitelist = new address[](activeCount);
        activeCount = 0;
        for (uint i = 0; i < count; i++) {
            address addr = whitelistIndices[i];
            if (whitelist[addr]) {
                activeWhitelist[activeCount] = addr;
                activeCount++;
            }
        }
    }
}
