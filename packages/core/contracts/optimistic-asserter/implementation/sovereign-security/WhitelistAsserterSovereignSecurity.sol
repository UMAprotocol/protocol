pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurity.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

contract WhitelistAsserterSovereignSecurity is BaseSovereignSecurity, Ownable {
    // Address of linked requesting contract. Before this is set via setAssertingCaller all assertions will be blocked.
    // Security of returning correct policy depends on requesting contract passing msg.sender as asserter.
    address public assertingCaller;

    mapping(address => bool) public whitelistedAsserters;

    event AssertingCallerSet(address indexed assertingCaller);

    // Set the address of the contract that will be allowed to use Optimistic Asserter.
    // This can only be set once. We do not set this at constructor just to allow for some flexibility in the ordering
    // of how contracts are deployed.
    function setAssertingCaller(address _assertingCaller) public onlyOwner {
        require(_assertingCaller != address(0), "Invalid asserting caller");
        require(assertingCaller == address(0), "Asserting caller already set");
        assertingCaller = _assertingCaller;
        emit AssertingCallerSet(_assertingCaller);
    }

    function setAsserterInWhitelist(address asserter, bool value) public onlyOwner {
        whitelistedAsserters[asserter] = value;
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        OptimisticAsserterInterface optimisticAsserter = OptimisticAsserterInterface(msg.sender);
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        bool blocked = _checkIfAssertionBlocked(assertion);
        return
            AssertionPolicy({
                blockAssertion: blocked,
                useDvmAsOracle: true,
                useDisputeResolution: true,
                validateDisputers: false
            });
    }

    function _checkIfAssertionBlocked(OptimisticAsserterInterface.Assertion memory assertion)
        internal
        view
        returns (bool)
    {
        if (assertion.ssSettings.assertingCaller != assertingCaller) return true; // Only allow assertions through linked client contract.
        return !whitelistedAsserters[assertion.asserter]; // Return if asserter is not whitelisted.
    }
}
