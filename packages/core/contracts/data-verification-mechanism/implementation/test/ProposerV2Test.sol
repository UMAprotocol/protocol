// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../ProposerV2.sol";
import "../AdminIdentifierLib.sol";
import "../../../common/implementation/Testable.sol";

contract ProposerV2Test is ProposerV2, Testable {
    constructor(
        IERC20 _token,
        uint256 _bond,
        GovernorV2 _governor,
        Finder _finder,
        address _timerAddress
    ) ProposerV2(_token, _bond, _governor, _finder) Testable(_timerAddress) {}

    function getCurrentTime() public view override(ProposerV2, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}
