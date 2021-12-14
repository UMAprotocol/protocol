// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../oracle/interfaces/FinderInterface.sol";

import "./interfaces/ChildMessengerInterface.sol";

import "../oracle/implementation/Constants.sol";

contract SpokeBase {
    FinderInterface private finder;

    constructor(address _finderAddress) {
        finder = FinderInterface(_finderAddress);
    }

    modifier onlyMessenger() {
        require(msg.sender == address(getChildMessenger()), "Caller must be messenger");
        _;
    }

    function getChildMessenger() public view returns (ChildMessengerInterface) {
        return ChildMessengerInterface(finder.getImplementationAddress(OracleInterfaces.ChildMessenger));
    }
}
