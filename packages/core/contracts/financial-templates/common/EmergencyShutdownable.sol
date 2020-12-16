// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../oracle/interfaces/AdministrateeInterface.sol";

/**
 * @title EmergencyShutdownable contract.
 * @notice Provides emergency shutdown timestamp and modifiers for the Perpetual contract.
 */

abstract contract EmergencyShutdownable is AdministrateeInterface {
    using SafeMath for uint256;

    /****************************************
     * EMERGENCY SHUTDOWN DATA STRUCTURES *
     ****************************************/

    // Timestamp used in case of emergency shutdown. 0 if no shutdown has been triggered.
    uint256 public emergencyShutdownTimestamp;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event EmergencyShutdown(address indexed caller, uint256 shutdownTimestamp);

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    modifier notEmergencyShutdown() {
        _notEmergencyShutdown();
        _;
    }

    modifier isEmergencyShutdown() {
        _isEmergencyShutdown();
        _;
    }

    /****************************************
     *          EXTERNAL FUNCTIONS          *
     ****************************************/

    constructor() public {
        emergencyShutdownTimestamp = 0;
    }

    /**
     * @notice Premature contract settlement under emergency circumstances.
     */
    function emergencyShutdown() external virtual override notEmergencyShutdown() {
        emit EmergencyShutdown(msg.sender, emergencyShutdownTimestamp);
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    function _notEmergencyShutdown() internal view {
        // Note: removed require string to save bytecode.
        require(emergencyShutdownTimestamp == 0);
    }

    function _isEmergencyShutdown() internal view {
        // Note: removed require string to save bytecode.
        require(emergencyShutdownTimestamp != 0);
    }
}
