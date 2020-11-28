// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../../common/implementation/Testable.sol";
import "../interfaces/OracleAncillaryInterface.sol";
import "../interfaces/VotingAncillaryInterface.sol";

// A mock oracle used for testing.
abstract contract VotingAncillaryInterfaceTesting is OracleAncillaryInterface, VotingAncillaryInterface, Testable {

}
