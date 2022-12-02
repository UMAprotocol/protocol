pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseEscalationManager.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

enum AssertionBlockMode {
    None, // No assertions are blocked
    BlockByAssertingCallerAndAsserter, // Assertion are block by asserting caller and asserter pair
    BlockByAssertingCaller // Assertions are blocked by asserting caller
}

/**
 * @title The FullPolicyEscalationManager allows the owner to configure all Escalation Manager policy parameters and store
 * arbitration resolutions. Optionally, we can enable assertion blocking via a whitelist of assertingCallers or a
 * combination of a whitelist of assertingCallers and asserters. On the other hand, it allows us to determine if we want
 * to arbitrate via the escalation manager instead of the DVM, if we want to ignore the resolution of a potential dispute
 * arbitrated by the Oracle, and if we want to restrict who can file disputes via a whitelistedDisputeCallers list.
 * @dev If nothing is configured using the setters and configureEscalationManager method upon deployment, the
 * FullPolicyEscalationManager will return a default policy with all values set to false.
 */
contract FullPolicyEscalationManager is BaseEscalationManager, Ownable {
    struct ArbitrationResolution {
        bool valueSet; // True if the resolution has been set.
        bool resolution; // True or false depending on the resolution.
    }

    AssertionBlockMode public assertionBlockMode; // The mode for blocking assertions.

    bool public arbitrateViaEscalationManager; // True if we should arbitrate via the escalation manager instead of the DVM.

    bool public discardOracle; // True if we should ignore the resolution of a potential dispute arbitrated by the Oracle (DVM or EM).

    bool public validateDisputers; // True if we should restrict who can file disputes via a whitelistedDisputeCallers list.

    mapping(bytes32 => ArbitrationResolution) public arbitrationResolutions; // Arbitration resolutions for a given identifier, time, and ancillary data.

    mapping(address => bool) public whitelistedDisputeCallers; // Whitelisted assertingCallers that can file disputes.

    mapping(address => bool) public whitelistedAssertingCallers; // Whitelisted assertingCallers that can assert prices.

    mapping(address => bool) public whitelistedAsserters; // Whitelisted asserters that can assert prices.

    /**
     * @notice Gets the price for identifier and time if it has already been requested and resolved.
     * @dev If the price is not available, the method reverts.
     * @param identifier uniquely identifies the price requested.
     * @param time unix timestamp of the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @return int256 representing the resolved price for the given identifier and timestamp.
     * @dev This function replicates the interface of the corresponding DVM function to allow the user to use his own
     * dispute arbitration system when arbitrating via the escalation manager in a DVM-compatible manner. Refer to the
     * UMA Voting and VotingV2 contracts for further details.
     */
    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override returns (int256) {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        require(arbitrationResolutions[requestId].valueSet, "Arbitration resolution not set");
        if (arbitrationResolutions[requestId].resolution) return 1e18;
        return 0;
    }

    /**
     * @notice Returns the Assertion Policy defined by this contract's parameters and functions.
     * @param assertionId the ID of the assertion to get the policy for.
     * @return the Assertion Policy defined by this contract's parameters and functions.
     * @dev If no configuration is done after deployment, this function returns an all false default policy.
     */
    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        OptimisticAsserterInterface optimisticAsserter = OptimisticAsserterInterface(msg.sender);
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        bool blocked = _checkIfAssertionBlocked(assertion);
        return
            AssertionPolicy({
                blockAssertion: blocked, // Block assertion if it is blocked.
                arbitrateViaEscalationManager: arbitrateViaEscalationManager, // Arbitrate via escalation manager if configured.
                discardOracle: discardOracle, // Ignore Oracle (DVM or EM) resolution if configured.
                validateDisputers: validateDisputers // Validate disputers if configured.
            });
    }

    /**
     * @notice Returns, given an assertionId and a disputerCaller address, if the disputerCaller is authorised to
     * dispute the assertion.
     * @param assertionId the ID of the assertion to check the disputerCaller for.
     * @param disputerCaller the address of the disputerCaller to check.
     * @return true if the disputerCaller is authorised to dispute the assertion.
     * @dev In order for this function to be used by the Optimistic Assertor, validateDisputers must be set to true.
     */
    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) public view override returns (bool) {
        return whitelistedDisputeCallers[disputeCaller];
    }

    /**
     * @notice Defines how the assertion policy for each configuration's rules is to be defined.
     * @param _validateDisputers true if we should restrict who can file disputes via a whitelistedDisputeCallers list.
     * @param _arbitrateViaEscalationManager true if we should arbitrate via the escalation manager instead of the DVM.
     * @param _discardOracle true if we should ignore the resolution of a potential dispute arbitrated by the Oracle
     * (DVM or EM).
     * @param _assertionBlockMode the mode for blocking assertions.
     * @dev This setting just activates the rules that will be executed; each rule must additionally be defined using
     * the other functions.
     */
    function configureEscalationManager(
        bool _validateDisputers,
        bool _arbitrateViaEscalationManager,
        bool _discardOracle,
        AssertionBlockMode _assertionBlockMode
    ) public onlyOwner {
        validateDisputers = _validateDisputers;
        arbitrateViaEscalationManager = _arbitrateViaEscalationManager;
        discardOracle = _discardOracle;
        assertionBlockMode = _assertionBlockMode;
    }

    /**
     * @notice Set the arbitration resolution for a given identifier, time, and ancillary data.
     * @param identifier uniquely identifies the price requested.
     * @param time unix timestamp of the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param arbitratioResolution true if the assertion should be resolved as true, false otherwise.
     * @dev The owner should use this function whenever a dispute arises and it should be arbitrated by the Escalation
     * Manager; it is up to the owner to determine how to resolve the dispute. See the requestPrice implementation in
     * BaseEscalationManager, which escalates a dispute to the Escalation Manager for resolution.
     */
    function setArbitrationResolution(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bool arbitrationResolution
    ) public onlyOwner {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        arbitrationResolutions[requestId] = ArbitrationResolution(true, arbitrationResolution);
    }

    /**
     * @notice Adds a disputerCaller to the whitelist of assertingCallers that can file disputes.
     * @param disputerCaller the address of the disputerCaller to add.
     * @dev This function is only used if validateDisputers is set to true.
     */
    function setDisputeCallerInWhitelist(address disputeCaller, bool value) public onlyOwner {
        whitelistedDisputeCallers[disputeCaller] = value;
    }

    /**
     * @notice Adds an asserter to the whitelist of assertingCallers that can make assertions.
     * @param asserter the address of the asserter to add.
     */
    function setWhitelistedAssertingCallers(address assertingCaller, bool value) public onlyOwner {
        whitelistedAssertingCallers[assertingCaller] = value;
    }

    /**
     * @notice Adds an asserter to the whitelist of asserters that can make assertions.
     * @param asserter the address of the asserter to add.
     * @dev This function must be used in conjunction with setWhitelistedAssertingCallers in order to have an effect.
     */
    function setWhitelistedAsserters(address asserter, bool value) public onlyOwner {
        whitelistedAsserters[asserter] = value;
    }

    // Checks if an assertion is blocked depending on the assertionBlockMode and the assertion's properties.
    function _checkIfAssertionBlocked(OptimisticAsserterInterface.Assertion memory assertion)
        internal
        view
        returns (bool)
    {
        if (assertionBlockMode == AssertionBlockMode.BlockByAssertingCallerAndAsserter) {
            if (whitelistedAssertingCallers[assertion.escalationManagerSettings.assertingCaller])
                return !whitelistedAsserters[assertion.asserter];
            return true;
        }
        if (assertionBlockMode == AssertionBlockMode.BlockByAssertingCaller) {
            return !whitelistedAssertingCallers[assertion.escalationManagerSettings.assertingCaller];
        }
        return false;
    }
}
