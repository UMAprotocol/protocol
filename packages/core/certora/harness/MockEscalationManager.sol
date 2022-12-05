// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;


import "../../contracts/optimistic-asserter/interfaces/EscalationManagerInterface.sol";

contract MockEscalationManager is EscalationManagerInterface {
    
    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) external view returns (bool) {
        return true;
    }
    
    /**
     * @notice Returns the assertion policy for the given assertionId.
     * @param assertionId the assertionId to get the assertion policy for.
     * @return the assertion policy for the given assertionId.
     */
    function getAssertionPolicy(bytes32 assertionId) public pure override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: _blockAssertion(assertionId),
                arbitrateViaEscalationManager: _arbitrateViaEscalationManager(assertionId),
                discardOracle: _discardOracle(assertionId),
                validateDisputers: _validateDisputers(assertionId)
            });
    }

    /*
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
    ) public view override returns (int256) {return 0;}

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
    ) public override {
        //emit PriceRequestAdded(identifier, time, ancillaryData);
    }

    // Callback function that is called by Optimistic Asserter when an assertion is resolved.
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) public virtual override {}

    // Callback function that is called by Optimistic Asserter when an assertion is disputed.
    function assertionDisputedCallback(bytes32 assertionId) public virtual override {}

    function _blockAssertion(bytes32 assertionId) internal pure returns (bool) {return false;}
    function _arbitrateViaEscalationManager(bytes32 assertionId) internal pure returns (bool) {return false;}
    function _discardOracle(bytes32 assertionId) internal pure returns (bool) {return false;}
    function _validateDisputers(bytes32 assertionId) internal pure returns (bool) {return false;}
}