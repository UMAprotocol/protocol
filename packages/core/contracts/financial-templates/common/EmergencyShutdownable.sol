// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title EmergencyShutdownable contract.
 * @notice Any contract that inherits this contract will have an emergency shutdown timestamp state variable.
 * This contract provides modifiers that can be used by children contracts to determine if the contract is
 * in the shutdown state. The child contract is expected to implement the logic that happens
 * once a shutdown occurs.
 */

abstract contract EmergencyShutdownable {
    using SafeMath for uint256;

    /****************************************
     * EMERGENCY SHUTDOWN DATA STRUCTURES *
     ****************************************/

    // Timestamp used in case of emergency shutdown. 0 if no shutdown has been triggered.
    uint256 public emergencyShutdownTimestamp;

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

    constructor() {
        emergencyShutdownTimestamp = 0;
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
