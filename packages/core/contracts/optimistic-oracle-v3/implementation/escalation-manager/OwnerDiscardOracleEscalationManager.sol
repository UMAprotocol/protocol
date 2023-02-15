// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseEscalationManager.sol";

contract OwnerDiscardOracleEscalationManager is BaseEscalationManager, Ownable {
    bool public discardOracle;

    constructor(address _optimisticOracleV3) BaseEscalationManager(_optimisticOracleV3) {}

    function setDiscardOracle(bool value) public onlyOwner {
        discardOracle = value;
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: false,
                arbitrateViaEscalationManager: false,
                discardOracle: discardOracle,
                validateDisputers: false
            });
    }
}
