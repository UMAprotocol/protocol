pragma solidity 0.8.16;

import "./BaseEscalationManager.sol";

contract WhitelistDisputerEscalationManager is BaseEscalationManager {
    mapping(address => bool) whitelistedDisputeCallers;

    constructor(address _optimisticAsserter) BaseEscalationManager(_optimisticAsserter) {}

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: false,
                arbitrateViaEscalationManager: false,
                discardOracle: false,
                validateDisputers: true
            });
    }

    function setDisputeCallerInWhitelist(address disputeCaller, bool value) public onlyOwner {
        whitelistedDisputeCallers[disputeCaller] = value;
    }

    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) public view override returns (bool) {
        return whitelistedDisputeCallers[disputeCaller];
    }
}
