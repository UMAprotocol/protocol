pragma solidity 0.8.16;

import "../../interfaces/SovereignSecurityManagerInterface.sol";

contract BaseSovereignSecurityManager is SovereignSecurityManagerInterface {
    event PriceRequested(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    function processAssertionPolicies(bytes32 assertionId) public virtual override returns (AssertionPolicies memory) {
        return AssertionPolicies({ allowAssertion: true, useDvmAsOracle: true, useDisputeResolution: true });
    }

    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view virtual override returns (int256) {}

    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public virtual override {
        emit PriceRequested(identifier, time, ancillaryData);
    }
}
