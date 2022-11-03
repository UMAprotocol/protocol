pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurityManager.sol";

contract OwnerUnplugSovereignSecurityManager is BaseSovereignSecurityManager, Ownable {
    mapping(bytes32 => bool) shouldUnplugOnAssertionIds;

    struct ArbitrationResolution {
        bool valueSet;
        bool resolution;
    }

    mapping(bytes32 => ArbitrationResolution) arbitrationResolutions;

    bool unplugFromDvm;

    function setUnplugOnAssertionId(bytes32 assertionId, bool value) public onlyOwner {
        shouldUnplugOnAssertionIds[assertionId] = value;
    }

    function setArbitrationResolution(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bool arbitrationResolution
    ) public onlyOwner {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        arbitrationResolutions[requestId] = ArbitrationResolution(true, arbitrationResolution);
    }

    function setUnplugUnplugFromDvm(bool value) public onlyOwner {
        unplugFromDvm = value;
    }

    function shouldArbitrateViaDvm(bytes32 assertionId) public view override returns (bool) {
        if (unplugFromDvm) return false;
        return !shouldUnplugOnAssertionIds[assertionId];
    }

    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override returns (int256) {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        require(arbitrationResolutions[requestId].valueSet, "Arbitration resolution not set");
        if (arbitrationResolutions[requestId].resolution) return 1e18;
        return 0;
    }
}
