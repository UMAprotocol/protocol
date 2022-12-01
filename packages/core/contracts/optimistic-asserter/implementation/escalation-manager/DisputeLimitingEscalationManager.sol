pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseEscalationManager.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

// This Escalation Manager blocks all assertions till the blocking dispute is resolved by Oracle. In order to avoid
// interference among different applications this Escalation Manager allows assertions only from one requesting contract.
// This is useful to create a system where only one assertion dispute can occur at a time.
contract DisputeLimitingEscalationManager is BaseEscalationManager, Ownable {
    OptimisticAsserterInterface public immutable optimisticAsserter;

    // Address of linked requesting contract. Before this is set via setAssertingCaller all assertions will be blocked.
    address public assertingCaller;

    bytes32 public disputedAssertionId;

    event AssertingCallerSet(address indexed assertingCaller);

    constructor(address _optimisticAsserter) {
        optimisticAsserter = OptimisticAsserterInterface(_optimisticAsserter);
    }

    // Set the address of the contract that will be allowed to use Optimistic Asserter.
    // This can only be set once. We do not set this at constructor just to allow for some flexibility in the ordering
    // of how contracts are deployed.
    function setAssertingCaller(address _assertingCaller) public onlyOwner {
        require(_assertingCaller != address(0), "Invalid asserting caller");
        require(assertingCaller == address(0), "Asserting caller already set");
        assertingCaller = _assertingCaller;
        emit AssertingCallerSet(_assertingCaller);
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: _checkIfShouldBlockAssertion(assertionId),
                arbitrateViaEscalationManager: false,
                discardOracle: false,
                validateDisputers: false
            });
    }

    // Callback function that is called by Optimistic Asserter when an assertion is disputed.
    function assertionDisputedCallback(bytes32 assertionId) public override {
        require(msg.sender == address(optimisticAsserter), "Not authorized");

        // Only apply new assertion block if the dispute is related to the linked client contract.
        if (optimisticAsserter.getAssertion(assertionId).escalationManagerSettings.assertingCaller == assertingCaller) {
            disputedAssertionId = assertionId;
        }
    }

    // Callback function that is called by Optimistic Asserter when an assertion is resolved.
    function assertionResolvedCallback(bytes32 assertionId, bool) public override {
        require(msg.sender == address(optimisticAsserter), "Not authorized");

        // Remove assertion block if the disputed assertion was resolved.
        if (assertionId == disputedAssertionId) disputedAssertionId = bytes32(0);
    }

    function _checkIfShouldBlockAssertion(bytes32 assertionId) internal view returns (bool) {
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        if (assertion.escalationManagerSettings.assertingCaller != assertingCaller) return true; // Only allow assertions through linked client contract.
        return disputedAssertionId != bytes32(0); // Block if there is outstanding dispute.
    }
}
