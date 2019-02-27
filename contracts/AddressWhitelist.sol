/*
  Simple Address Whitelist
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


contract AddressWhitelist is Ownable {
    enum Status { None, In, Out }
    mapping(address => Status) private whitelist;

    address[] private whitelistIndices;

    // Adds an address to the whitelist
    function addToWhitelist(address newElement) external onlyOwner {
        // Ignore if address is already included
        if (whitelist[newElement] == Status.In) {
            return;
        }

        // Only append new addresses to the array, never a duplicate
        if (whitelist[newElement] == Status.None) {
            whitelistIndices.push(newElement);
        }

        whitelist[newElement] = Status.In;

        emit AddToWhitelist(newElement);
    }

    // Removes an address from the whitelist.
    function removeFromWhitelist(address elementToRemove) external onlyOwner {
        if (whitelist[elementToRemove] != Status.Out) {
            whitelist[elementToRemove] = Status.Out;
            emit RemoveFromWhitelist(elementToRemove);
        }
    }

    // Checks whether an address is on the whitelist.
    function isOnWhitelist(address elementToCheck) external view returns (bool) {
        return whitelist[elementToCheck] == Status.In;
    }

    // Gets all addresses that are currently included in the whitelist
    // Note: This method skips over, but still iterates through addresses.
    // It is possible for this call to run out of gas if a large number of
    // addresses have been removed. To prevent this unlikely scenario, we can
    // modify the implementation so that when addresses are removed, the last addresses
    // in the array is moved to the empty index.
    function getWhitelist() external view returns (address[] memory activeWhitelist) {
        // Determine size of whitelist first
        uint activeCount = 0;
        for (uint i = 0; i < whitelistIndices.length; i++) {
            if (whitelist[whitelistIndices[i]] == Status.In) {
                activeCount++;
            }
        }

        // Populate whitelist
        activeWhitelist = new address[](activeCount);
        activeCount = 0;
        for (uint i = 0; i < whitelistIndices.length; i++) {
            address addr = whitelistIndices[i];
            if (whitelist[addr] == Status.In) {
                activeWhitelist[activeCount] = addr;
                activeCount++;
            }
        }
    }

    event AddToWhitelist(address indexed addedAddress);
    event RemoveFromWhitelist(address indexed removedAddress);
}
