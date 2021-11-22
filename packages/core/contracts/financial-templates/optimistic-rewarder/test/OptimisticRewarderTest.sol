// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../OptimisticRewarder.sol";
import "../../../common/implementation/Testable.sol";

// Test contract to add controllable timing to the OptimisticRewarder.
contract OptimisticRewarderTest is OptimisticRewarder, Testable {
    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseUri,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        bytes memory _customAncillaryData,
        FinderInterface _finder,
        address _timerAddress
    )
        Testable(_timerAddress)
        OptimisticRewarder(
            _name,
            _symbol,
            _baseUri,
            _liveness,
            _bondToken,
            _bond,
            _identifier,
            _customAncillaryData,
            _finder
        )
    {}

    function getCurrentTime() public view override(OptimisticRewarderBase, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}

// Test contract to add controllable timing to the OptimisticRewarderNoToken.
contract OptimisticRewarderNoTokenTest is OptimisticRewarderNoToken, Testable {
    constructor(
        OptimisticRewarderToken _token,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        bytes memory _customAncillaryData,
        FinderInterface _finder,
        address _timerAddress
    )
        Testable(_timerAddress)
        OptimisticRewarderNoToken(_token, _liveness, _bondToken, _bond, _identifier, _customAncillaryData, _finder)
    {}

    function getCurrentTime() public view override(OptimisticRewarderBase, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}
