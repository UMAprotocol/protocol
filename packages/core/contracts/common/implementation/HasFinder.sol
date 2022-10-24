pragma solidity ^0.8.9;

// SPDX-License-Identifier: UNLICENSED
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";

// Contract stores a reference to the DVM Finder contract which can be used to locate other important DVM contracts.
contract HasFinder {
    FinderInterface public finder;

    constructor(address _finder) {
        finder = FinderInterface(_finder);
    }
}
