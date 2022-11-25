pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurity.sol";
import "../../interfaces/OptimisticAssertorInterface.sol";

contract WhitelistCallerSovereignSecurity is BaseSovereignSecurity, Ownable {
    mapping(address => bool) whitelistedAssertingCallers;

    function setAssertingCallerInWhitelist(address assertingCaller, bool value) public onlyOwner {
        whitelistedAssertingCallers[assertingCaller] = value;
    }

    function getAssertionPolicies(bytes32 assertionId) public view override returns (AssertionPolicies memory) {
        OptimisticAssertorInterface optimisticAssertor = OptimisticAssertorInterface(msg.sender);
        return
            AssertionPolicies({
                allowAssertion: whitelistedAssertingCallers[
                    optimisticAssertor.readAssertion(assertionId).ssSettings.assertingCaller
                ],
                useDvmAsOracle: true,
                useDisputeResolution: true,
                validateDisputers: false
            });
    }
}
