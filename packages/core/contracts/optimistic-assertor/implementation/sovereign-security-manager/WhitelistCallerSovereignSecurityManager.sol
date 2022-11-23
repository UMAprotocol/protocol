pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurityManager.sol";
import "../../interfaces/OptimisticAssertorInterface.sol";

contract WhitelistCallerSovereignSecurityManager is BaseSovereignSecurityManager, Ownable {
    mapping(address => bool) whitelistedAssertingCallers;

    function setAssertingCallerInWhitelist(address assertingCaller, bool value) public onlyOwner {
        whitelistedAssertingCallers[assertingCaller] = value;
    }

    function getAssertionPolicies(bytes32 assertionId) public view override returns (AssertionPolicies memory) {
        OptimisticAssertorInterface optimisticAssertor = OptimisticAssertorInterface(msg.sender);
        return
            AssertionPolicies({
                allowAssertion: whitelistedAssertingCallers[
                    optimisticAssertor.readAssertion(assertionId).assertingCaller
                ],
                useDvmAsOracle: true,
                useDisputeResolution: true
            });
    }
}
