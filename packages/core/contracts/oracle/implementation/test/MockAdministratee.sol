// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../interfaces/AdministrateeInterface.sol";

// A mock implementation of AdministrateeInterface, taking the place of a financial contract.
contract MockAdministratee is AdministrateeInterface {
    uint256 public timesRemargined;
    uint256 public timesEmergencyShutdown;

    function remargin() external override {
        timesRemargined++;
    }

    function emergencyShutdown() external override {
        timesEmergencyShutdown++;
    }

    function pfc() external view override returns (FixedPoint.Unsigned memory) {
        return FixedPoint.fromUnscaledUint(0);
    }
}
