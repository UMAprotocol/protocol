// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "./interfaces/ChildMessengerInterface.sol";

import "../data-verification-mechanism/implementation/Constants.sol";
import "../common/implementation/HasFinder.sol";

/**
 * @title Cross-chain Oracle L2 Spoke Base.
 * @notice Provides access control to Governance and Oracle spoke L2 contracts.
 */

abstract contract SpokeBase is HasFinder {
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
