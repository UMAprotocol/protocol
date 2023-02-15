// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../../interfaces/EscalationManagerInterface.sol";
import "../../interfaces/OptimisticOracleV3Interface.sol";

/**
 * @title BaseEscalationManager
 * @notice Base contract for escalation managers. This contract is responsible for managing the escalation policy for
 * assertions. This base implementation simply exposes the required interface and provides a default implementation
 * (returning default values or doing nothing).
 */
contract BaseEscalationManager is EscalationManagerInterface {
    OptimisticOracleV3Interface public immutable optimisticOracleV3;

    event PriceRequestAdded(bytes32 indexed identifier, uint256 time, bytes ancillaryData);

    /**
     * @notice Reverts unless the configured Optimistic Oracle V3 is the caller.
     */
    modifier onlyOptimisticOracleV3() {
        require(msg.sender == address(optimisticOracleV3), "Not the Optimistic Oracle V3");
        _;
    }

    /**
     * @notice Constructs the escalation manager.
     * @param _optimisticOracleV3 the Optimistic Oracle V3 to use.
     */
    constructor(address _optimisticOracleV3) {
        optimisticOracleV3 = OptimisticOracleV3Interface(_optimisticOracleV3);
    }

    /**
     * @notice Returns the assertion policy for the given assertionId.
     * @param assertionId the assertionId to get the assertion policy for.
     * @return the assertion policy for the given assertionId.
     */
    function getAssertionPolicy(bytes32 assertionId) public view virtual returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: false,
                arbitrateViaEscalationManager: false,
                discardOracle: false,
                validateDisputers: false
            });
    }

    /**
     * @notice Callback function that is called by Optimistic Oracle V3 when an assertion is disputed. Used to validate
     * if the dispute should be allowed based on the escalation policy.
     * @param assertionId the assertionId to validate the dispute for.
     * @param disputeCaller the caller of the dispute function.
     * @return bool true if the dispute is allowed, false otherwise.
     */
    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) public view virtual returns (bool) {
        return true;
    }

    /**
     * @notice Implements price getting logic. This method is called by Optimistic Oracle V3 settling an assertion that
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
    ) public view virtual returns (int256) {}

    /**
     * @notice Implements price requesting logic for the escalation manager. This function is called by the Optimistic
     * Oracle V3 on dispute and is constructed to mimic that of the UMA DVM interface.
     * @param identifier the identifier to fetch the price for.
     * @param time the time to fetch the price for.
     * @param ancillaryData ancillary data of the price being requested.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public virtual onlyOptimisticOracleV3 {
        emit PriceRequestAdded(identifier, time, ancillaryData);
    }

    /**
     * @notice Callback function that is called by Optimistic Oracle V3 when an assertion is resolved.
     * @param assertionId The identifier of the assertion that was resolved.
     * @param assertedTruthfully Whether the assertion was resolved as truthful or not.
     */
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully)
        public
        virtual
        onlyOptimisticOracleV3
    {}

    /**
     * @notice Callback function that is called by Optimistic Oracle V3 when an assertion is disputed.
     * @param assertionId The identifier of the assertion that was disputed.
     */
    function assertionDisputedCallback(bytes32 assertionId) public virtual onlyOptimisticOracleV3 {}
}
