pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurity.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

contract WhitelistCallerSovereignSecurity is BaseSovereignSecurity, Ownable {
    mapping(address => bool) whitelistedAssertingCallers;

    function setAssertingCallerInWhitelist(address assertingCaller, bool value) public onlyOwner {
        whitelistedAssertingCallers[assertingCaller] = value;
    }

    function getAssertionPolicies(bytes32 assertionId) public view override returns (AssertionPolicies memory) {
        OptimisticAsserterInterface optimisticAsserter = OptimisticAsserterInterface(msg.sender);
        return
            AssertionPolicies({
                allowAssertion: whitelistedAssertingCallers[
                    optimisticAsserter.readAssertion(assertionId).ssSettings.assertingCaller
                ],
                useDvmAsOracle: true,
                useDisputeResolution: true,
                validateDisputers: false
            });
    }
}
