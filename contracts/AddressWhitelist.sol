/*
  Simple Address Whitelist
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


contract AddressWhitelist is Ownable {
    enum Status { None, In, Out }
    mapping(address => Status) private whitelist;

    uint private count;
    mapping(uint => address) private whitelistIndices;

    // Adds an address to the whitelist
    function addToWhitelist(address newElement) external onlyOwner {
        // Ignore if address is already included
        if (whitelist[newElement] == Status.In) {
            return;
        }

        // Only append new addresses to the array, never a duplicate
        if (whitelist[newElement] == Status.None) {
            whitelistIndices[count] = newElement;
            count++;
        }

        whitelist[newElement] = Status.In;
    }

    // Removes an address from the whitelist.
    function removeFromWhitelist(address elementToRemove) external onlyOwner {
        whitelist[elementToRemove] = Status.Out;
    }

    // Checks whether an address is on the whitelist.
    function isOnWhitelist(address elementToCheck) external view returns (bool) {
        return whitelist[elementToCheck] == Status.In;
    }

    // Gets all addresses that are currently included in the whitelist
    function getWhitelist() external view returns (address[] memory activeWhitelist) {
        // Determine size of whitelist first
        uint activeCount = 0;
        for (uint i = 0; i < count; i++) {
            if (whitelist[whitelistIndices[i]] == Status.In) {
                activeCount++;
            }
        }

        // Populate whitelist
        activeWhitelist = new address[](activeCount);
        activeCount = 0;
        for (uint i = 0; i < count; i++) {
            address addr = whitelistIndices[i];
            if (whitelist[addr] == Status.In) {
                activeWhitelist[activeCount] = addr;
                activeCount++;
            }
        }
    }
}
