// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseEscalationManager.sol";

contract OwnerSelectOracleEscalationManager is BaseEscalationManager, Ownable {
    struct ArbitrationResolution {
        bool valueSet;
        bool resolution;
    }

    mapping(bytes32 => ArbitrationResolution) arbitrationResolutions;

    bool arbitrateViaEscalationManager;

    constructor(address _optimisticOracleV3) BaseEscalationManager(_optimisticOracleV3) {}

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
        arbitrateViaEscalationManager = value;
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: false,
                arbitrateViaEscalationManager: arbitrateViaEscalationManager,
                discardOracle: false,
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
