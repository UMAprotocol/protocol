pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurity.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

contract WhitelistCallerSovereignSecurity is BaseSovereignSecurity, Ownable {
    mapping(address => bool) whitelistedAssertingCallers;

    function setAssertingCallerInWhitelist(address assertingCaller, bool value) public onlyOwner {
        whitelistedAssertingCallers[assertingCaller] = value;
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        OptimisticAsserterInterface optimisticAsserter = OptimisticAsserterInterface(msg.sender);
        return
            AssertionPolicy({
                blockAssertion: !whitelistedAssertingCallers[
                    optimisticAsserter.getAssertion(assertionId).ssSettings.assertingCaller
                ],
                arbitrateViaSs: false,
                discardOracle: false,
                validateDisputers: false
            });
    }
}
