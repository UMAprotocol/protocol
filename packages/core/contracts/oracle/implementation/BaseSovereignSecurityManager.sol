pragma solidity 0.8.16;

import "../interfaces/SovereignSecurityManagerInterface.sol";

contract BaseSovereignSecurityManager is SovereignSecurityManagerInterface {
    event PriceRequested(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    function shouldArbitrateViaDvm(bytes32 assertionId) public view virtual override returns (bool) {
        return true;
    }

    // This should revert if asserter not whitelisted.
    function shouldAllowAssertionAndRespectDvmOnArbitrate(bytes32 assertionId)
        public
        view
        virtual
        override
        returns (bool)
    {
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
        emit PriceRequested(identifier, time, ancillaryData);
    }
}
