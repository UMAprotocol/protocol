pragma solidity 0.8.16;

import "../../interfaces/SovereignSecurityInterface.sol";

contract BaseSovereignSecurity is SovereignSecurityInterface {
    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    function getAssertionPolicy(bytes32 assertionId) public view virtual override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: false,
                arbitrateViaSs: false,
                discardOracle: false,
                validateDisputers: false
            });
    }

    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) public view virtual override returns (bool) {
        return true;
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
        emit PriceRequestAdded(identifier, time, ancillaryData);
    }

    function assertionResolved(bytes32 assertionId, bool assertedTruthfully) public {}

    function assertionDisputed(bytes32 assertionId) public {}
}
