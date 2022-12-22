pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/EscalationManagerInterface.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

/**
 * @title BaseEscalationManager
 * @notice Base contract for escalation managers. This contract is responsible for managing the escalation policy for
 * assertions. This base implementation simply exposes the required interface and provides a default implementation
 * (returning default values or doing nothing).
 */
contract BaseEscalationManager is EscalationManagerInterface, Ownable {
    OptimisticAsserterInterface public immutable optimisticAsserter;

    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    /**
     * @notice Reverts unless the configured optimistic asserter is the caller.
     */
    modifier onlyOptimisticAsserter() {
        require(msg.sender == address(optimisticAsserter), "Not the optimistic asserter");
        _;
    }

    /**
     * @notice Constructs the escalation manager.
     * @param _optimisticAsserter the optimistic asserter to use.
     */
    constructor(address _optimisticAsserter) {
        optimisticAsserter = OptimisticAsserterInterface(_optimisticAsserter);
    }

    /**
     * @notice Returns the assertion policy for the given assertionId.
     * @param assertionId the assertionId to get the assertion policy for.
     * @return the assertion policy for the given assertionId.
     */
    function getAssertionPolicy(bytes32 assertionId) public view virtual override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: false,
                arbitrateViaEscalationManager: false,
                discardOracle: false,
                validateDisputers: false
            });
    }

    /**
     * @notice Callback function that is called by Optimistic Asserter when an assertion is disputed. Used to validate
     * if the dispute should be allowed based on the escalation policy.
     * @param assertionId the assertionId to validate the dispute for.
     * @param disputeCaller the caller of the dispute function.
     * @return bool if the dispute is allowed, false otherwise.
     */
    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) public view virtual override returns (bool) {
        return true;
    }

    /**
     * @notice Implements price getting logic. This method is called by Optimistic Asserter settling an assertion that
     * is configured to use the escalation manager as the oracle. The interface is constructed to mimic the UMA DVM.
     * @param identifier price identifier being requested.
     * @param time timestamp of the price being requested.
     * @param ancillaryData ancillary data of the price being requested.
     * @return price from the escalation manager to inform the resolution of the dispute.
     */
    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view virtual override returns (int256) {}

    /**
     * @notice Implements price requesting logic for the escalation manager. This function is called by the Optimistic
     * on dispute and is constructed to mimic that of the UMA DVM interface.
     * @param identifier the identifier to fetch the price for.
     * @param time the time to fetch the price for.
     * @param ancillaryData ancillary data of the price being requested.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public virtual override onlyOptimisticAsserter {
        emit PriceRequestAdded(identifier, time, ancillaryData);
    }

    // Callback function that is called by Optimistic Asserter when an assertion is resolved.
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully)
        public
        virtual
        override
        onlyOptimisticAsserter
    {}

    // Callback function that is called by Optimistic Asserter when an assertion is disputed.
    function assertionDisputedCallback(bytes32 assertionId) public virtual override onlyOptimisticAsserter {}
}
