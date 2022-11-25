pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurity.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

contract WhitelistProposerSovereignSecurity is BaseSovereignSecurity, Ownable {
    // Address of linked requesting contract. Before this is set via setAssertingCaller all assertions will be blocked.
    // Security of returning correct policy depends on requesting contract passing msg.sender as proposer.
    address public assertingCaller;

    mapping(address => bool) public whitelistedProposers;

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

    function setProposerInWhitelist(address proposer, bool value) public onlyOwner {
        whitelistedProposers[proposer] = value;
    }

    function getAssertionPolicies(bytes32 assertionId) public view override returns (AssertionPolicies memory) {
        OptimisticAsserterInterface optimisticAsserter = OptimisticAsserterInterface(msg.sender);
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.readAssertion(assertionId);
        bool allow = _checkIfAssertionAllowed(assertion);
        return
            AssertionPolicies({
                allowAssertion: allow,
                useDvmAsOracle: true,
                useDisputeResolution: true,
                validateDisputers: false
            });
    }

    function _checkIfAssertionAllowed(OptimisticAsserterInterface.Assertion memory assertion)
        internal
        view
        returns (bool)
    {
        if (assertion.ssSettings.assertingCaller != assertingCaller) return false; // Only allow assertions through linked client contract.
        return whitelistedProposers[assertion.proposer]; // Return if proposer is whitelisted.
    }
}