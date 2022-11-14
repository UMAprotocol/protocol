pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurityManager.sol";

contract OwnerSelectOracleSovereignSecurityManager is BaseSovereignSecurityManager, Ownable {
    struct ArbitrationResolution {
        bool valueSet;
        bool resolution;
    }

    mapping(bytes32 => ArbitrationResolution) arbitrationResolutions;

    bool arbitrateViaSsm;

    function setArbitrationResolution(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bool arbitrationResolution
    ) public onlyOwner {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        arbitrationResolutions[requestId] = ArbitrationResolution(true, arbitrationResolution);
    }

    function setArbitrateViaSsm(bool value) public onlyOwner {
        arbitrateViaSsm = value;
    }

    function processAssertionPolicies(bytes32 assertionId) public view override returns (AssertionPolicies memory) {
        return
            AssertionPolicies({ allowAssertion: true, useDvmAsOracle: !arbitrateViaSsm, useDisputeResolution: true });
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
