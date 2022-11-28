pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurity.sol";

contract OwnerSelectOracleSovereignSecurity is BaseSovereignSecurity, Ownable {
    struct ArbitrationResolution {
        bool valueSet;
        bool resolution;
    }

    mapping(bytes32 => ArbitrationResolution) arbitrationResolutions;

    bool arbitrateViaSs;

    function setArbitrationResolution(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bool arbitrationResolution
    ) public onlyOwner {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        arbitrationResolutions[requestId] = ArbitrationResolution(true, arbitrationResolution);
    }

    function setArbitrateViaSs(bool value) public onlyOwner {
        arbitrateViaSs = value;
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                allowAssertion: true,
                useDvmAsOracle: !arbitrateViaSs,
                useDisputeResolution: true,
                validateDisputers: false
            });
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
