// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../ProposerV2.sol";
import "../AdminIdentifierLib.sol";
import "../../../common/implementation/Testable.sol";

contract ProposerV2Test is ProposerV2, Testable {
    constructor(
        uint256 _bond,
        Finder _finder,
        address _timerAddress
    ) ProposerV2(_bond, _finder) Testable(_timerAddress) {}

    function getCurrentTime() public view override(ProposerV2, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}
