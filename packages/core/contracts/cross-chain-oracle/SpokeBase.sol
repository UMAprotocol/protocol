// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../oracle/interfaces/FinderInterface.sol";

import "./interfaces/ChildMessengerInterface.sol";

import "../oracle/implementation/Constants.sol";

/**
 * @title Cross-chain Oracle L2 Spoke Base.
 * @notice Provides access control to Governance and Oracle spoke L2 contracts.
 */

contract SpokeBase {
    // Note: This is private because `OracleSpoke` inherits both `OracleBase` and this contract and there cannot be
    // two public `finder` global variables.
    FinderInterface private finder;

    constructor(address _finderAddress) {
        finder = FinderInterface(_finderAddress);
    }

    modifier onlyMessenger() {
        require(msg.sender == address(getChildMessenger()), "Caller must be messenger");
        _;
    }

    /**
     * @notice Returns the child messenger address set in the finder.
     * @return ChildMessengerInterface instance of child messenger deployed on L2.
     */
    function getChildMessenger() public view returns (ChildMessengerInterface) {
        return ChildMessengerInterface(finder.getImplementationAddress(OracleInterfaces.ChildMessenger));
    }
}
