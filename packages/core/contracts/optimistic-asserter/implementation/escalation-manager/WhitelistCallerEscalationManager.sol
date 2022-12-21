pragma solidity 0.8.16;

import "./BaseEscalationManager.sol";

contract WhitelistCallerEscalationManager is BaseEscalationManager {
    mapping(address => bool) whitelistedAssertingCallers;

    constructor(address _optimisticAsserter) BaseEscalationManager(_optimisticAsserter) {}

    function setAssertingCallerInWhitelist(address assertingCaller, bool value) public onlyOwner {
        whitelistedAssertingCallers[assertingCaller] = value;
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: !whitelistedAssertingCallers[
                    optimisticAsserter.getAssertion(assertionId).escalationManagerSettings.assertingCaller
                ],
                arbitrateViaEscalationManager: false,
                discardOracle: false,
                validateDisputers: false
            });
    }
}
