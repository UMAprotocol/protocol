// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol"; // show we can import from external packages.
import "../oracle/interfaces/RegistryInterface.sol"; // show we can import from other UMA contracts.

contract TestFoundryContract is Ownable {
    constructor() {}

    function returnString() public pure returns (string memory) {
        return "Hello World";
    }
}
