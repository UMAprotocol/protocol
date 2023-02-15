// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "./OptimisticOracleV3CallbackRecipientInterface.sol";

/**
 * @title Escalation Manager Interface
 * @notice Interface for contracts that manage the escalation policy for assertions.
 */
interface EscalationManagerInterface is OptimisticOracleV3CallbackRecipientInterface {
    // Assertion policy parameters as returned by the escalation manager.
    struct AssertionPolicy {
        bool blockAssertion; // If true, the the assertion should be blocked.
        bool arbitrateViaEscalationManager; // If true, the escalation manager will arbitrate the assertion.
        bool discardOracle; // If true, the Optimistic Oracle V3 should discard the oracle price.
        bool validateDisputers; // If true, the escalation manager will validate the disputers.
    }

    /**
     * @notice Returns the assertion policy for the given assertion.
     * @param assertionId the assertion identifier to get the assertion policy for.
     * @return the assertion policy for the given assertion identifier.
     */
    function getAssertionPolicy(bytes32 assertionId) external view returns (AssertionPolicy memory);

    /**
     * @notice Callback function that is called by Optimistic Oracle V3 when an assertion is disputed. Used to validate
     * if the dispute should be allowed based on the escalation policy.
     * @param assertionId the assertionId to validate the dispute for.
     * @param disputeCaller the caller of the dispute function.
     * @return bool true if the dispute is allowed, false otherwise.
     */
    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) external view returns (bool);

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
    ) external returns (int256);

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
    ) external;
}
