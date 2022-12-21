pragma solidity 0.8.16;

import "./BaseEscalationManager.sol";

contract OwnerDiscardOracleEscalationManager is BaseEscalationManager {
    bool public discardOracle;

    constructor(address _optimisticAsserter) BaseEscalationManager(_optimisticAsserter) {}

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
