pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurityManager.sol";
import "../../interfaces/OptimisticAssertorInterface.sol";

contract WhitelistDisputerSovereignSecurityManager is BaseSovereignSecurityManager, Ownable {
    mapping(address => bool) whitelistedDisputeCallers;

    function getAssertionPolicies(bytes32 assertionId) public view override returns (AssertionPolicies memory) {
        return
            AssertionPolicies({
                allowAssertion: true,
                useDvmAsOracle: true,
                useDisputeResolution: true,
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
