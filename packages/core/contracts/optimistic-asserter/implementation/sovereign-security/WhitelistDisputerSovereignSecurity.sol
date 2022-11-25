pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurity.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

contract WhitelistDisputerSovereignSecurity is BaseSovereignSecurity, Ownable {
    mapping(address => bool) whitelistedDisputeCallers;

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicies memory) {
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
