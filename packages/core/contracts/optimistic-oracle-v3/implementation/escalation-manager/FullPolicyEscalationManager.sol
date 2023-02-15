// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseEscalationManager.sol";

/**
 * @title The FullPolicyEscalationManager enables the owner to configure all policy parameters and store the arbitration
 * resolutions for the Escalation Manager. Optionally, assertion blocking can be enabled using a whitelist of
 * assertingCallers or assertingCallers and asserters. On the other hand, it enables the determination of whether to
 * arbitrate via the escalation manager as opposed to the DVM, whether to disregard the resolution of a potential
 * dispute arbitrated by the Oracle, and whether to restrict who can register disputes via whitelistedDisputeCallers.
 * @dev If nothing is configured using the setters and configureEscalationManager method upon deployment, the
 * FullPolicyEscalationManager will return a default policy with all values set to false.
 */
contract FullPolicyEscalationManager is BaseEscalationManager, Ownable {
    // Struct to store the arbitration resolution for a given identifier, time, and ancillary data.
    struct ArbitrationResolution {
        bool valueSet; // True if the resolution has been set.
        bool resolution; // True or false depending on the resolution.
    }

    event EscalationManagerConfigured(
        bool blockByAssertingCaller,
        bool blockByAsserter,
        bool validateDisputers,
        bool arbitrateViaEscalationManager,
        bool discardOracle
    );

    event ArbitrationResolutionSet(bytes32 indexed identifier, uint256 time, bytes ancillaryData, bool resolution);

    event DisputeCallerWhitelistSet(address indexed disputeCaller, bool whitelisted);

    event AssertingCallerWhitelistSet(address indexed assertingCaller, bool whitelisted);

    event AsserterWhitelistSet(address indexed asserter, bool whitelisted);

    int256 public constant numericalTrue = 1e18; // Numerical representation of true.

    bool public blockByAssertingCaller; // True if assertions are allowed only by whitelisted asserting callers.

    bool public blockByAsserter; // True if assertions are allowed only by whitelisted asserters.

    bool public arbitrateViaEscalationManager; // True if it is determined that the escalation manager should arbitrate.

    bool public discardOracle; // True if escalation manager should disregard the Oracle's resolution.

    bool public validateDisputers; // True if escalation manager should validate disputers via whitelistedDisputeCallers.

    mapping(bytes32 => ArbitrationResolution) public arbitrationResolutions; // Arbitration resolutions for a given identifier, time, and ancillary data.

    mapping(address => bool) public whitelistedDisputeCallers; // Whitelisted disputer that can file disputes.

    mapping(address => bool) public whitelistedAssertingCallers; // Whitelisted assertingCallers that can assert prices.

    mapping(address => bool) public whitelistedAsserters; // Whitelisted asserters that can assert prices.

    /**
     * @notice Constructs the escalation manager.
     * @param _optimisticOracleV3 the Optimistic Oracle V3 to use.
     */
    constructor(address _optimisticOracleV3) BaseEscalationManager(_optimisticOracleV3) {}

    /**
     * @notice Returns the Assertion Policy defined by this contract's parameters and functions.
     * @param assertionId the ID of the assertion to get the policy for.
     * @return the Assertion Policy defined by this contract's parameters and functions.
     * @dev If no configuration is done after deployment, this function returns an all false default policy.
     */
    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        bool blocked = _checkIfAssertionBlocked(assertionId);
        return
            AssertionPolicy({
                blockAssertion: blocked, // Block assertion if it is blocked.
                arbitrateViaEscalationManager: arbitrateViaEscalationManager, // Arbitrate via escalation manager if configured.
                discardOracle: discardOracle, // Ignore Oracle (DVM or EM) resolution if configured.
                validateDisputers: validateDisputers // Validate disputers if configured.
            });
    }

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
        bytes32 requestId = getRequestId(identifier, time, ancillaryData);
        require(arbitrationResolutions[requestId].valueSet, "Arbitration resolution not set");
        if (arbitrationResolutions[requestId].resolution) return numericalTrue;
        return 0;
    }

    /**
     * @notice Returns, given an assertionId and a disputerCaller address, if the disputerCaller is authorised to
     * dispute the assertion.
     * @param assertionId the ID of the assertion to check the disputerCaller for.
     * @param disputeCaller the address of the disputeCaller to check.
     * @return true if the disputerCaller is authorised to dispute the assertion.
     * @dev In order for this function to be used by the Optimistic Oracle V3, validateDisputers must be set to true.
     */
    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) public view override returns (bool) {
        return whitelistedDisputeCallers[disputeCaller];
    }

    /**
     * @notice Defines how the assertion policy for each configuration's rules is to be defined.
     * @param _blockByAssertingCaller true if assertions are allowed only by whitelisted asserting callers.
     * @param _blockByAsserter true if assertions are allowed only by whitelisted asserters.
     * @param _validateDisputers true if the escalation manager should validate disputers via whitelistedDisputeCallers.
     * @param _arbitrateViaEscalationManager true if the escalation manager should arbitrate instead of the DVM.
     * @param _discardOracle true if the escalation manager should disregard the Oracle's (DVM or EM) resolution.
     * @dev This setting just activates the rules that will be executed; each rule must additionally be defined using
     * the other functions.
     */
    function configureEscalationManager(
        bool _blockByAssertingCaller,
        bool _blockByAsserter,
        bool _validateDisputers,
        bool _arbitrateViaEscalationManager,
        bool _discardOracle
    ) public onlyOwner {
        require(!_blockByAsserter || _blockByAssertingCaller, "Cannot block only by asserter");
        blockByAssertingCaller = _blockByAssertingCaller;
        blockByAsserter = _blockByAsserter;
        validateDisputers = _validateDisputers;
        arbitrateViaEscalationManager = _arbitrateViaEscalationManager;
        discardOracle = _discardOracle;
        emit EscalationManagerConfigured(
            _blockByAssertingCaller,
            _blockByAsserter,
            _validateDisputers,
            _arbitrateViaEscalationManager,
            _discardOracle
        );
    }

    /**
     * @notice Set the arbitration resolution for a given identifier, time, and ancillary data.
     * @param identifier uniquely identifies the price requested.
     * @param time unix timestamp of the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param arbitrationResolution true if the assertion should be resolved as true, false otherwise.
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
        bytes32 requestId = getRequestId(identifier, time, ancillaryData);
        require(arbitrationResolutions[requestId].valueSet == false, "Arbitration already resolved");
        arbitrationResolutions[requestId] = ArbitrationResolution(true, arbitrationResolution);
        emit ArbitrationResolutionSet(identifier, time, ancillaryData, arbitrationResolution);
    }

    /**
     * @notice Adds/removes a disputeCaller to the whitelist of disputers that can file disputes.
     * @param disputeCaller the address of the disputeCaller to add.
     * @param value true represents adding and false represents removing the disputeCaller from the whitelist.
     * @dev This function is only used if validateDisputers is set to true.
     */
    function setDisputeCallerInWhitelist(address disputeCaller, bool value) public onlyOwner {
        whitelistedDisputeCallers[disputeCaller] = value;
        emit DisputeCallerWhitelistSet(disputeCaller, value);
    }

    /**
     * @notice Adds/removes an asserter to the whitelist of assertingCallers that can make assertions.
     * @param assertingCaller the address of the assertingCaller to add.
     * @param value true represents adding and false represents removing the assertingCaller from the whitelist.
     */
    function setWhitelistedAssertingCallers(address assertingCaller, bool value) public onlyOwner {
        whitelistedAssertingCallers[assertingCaller] = value;
        emit AssertingCallerWhitelistSet(assertingCaller, value);
    }

    /**
     * @notice Adds/removes an asserter to the whitelist of asserters that can make assertions.
     * @param asserter the address of the asserter to add.
     * @param value true represents adding and false represents removing the asserter from the whitelist.
     * @dev This function must be used in conjunction with setWhitelistedAssertingCallers in order to have an effect.
     */
    function setWhitelistedAsserters(address asserter, bool value) public onlyOwner {
        whitelistedAsserters[asserter] = value;
        emit AsserterWhitelistSet(asserter, value);
    }

    /**
     * @notice Calculates price request identifier for a given identifier, time, and ancillary data.
     * @param identifier uniquely identifies the price requested.
     * @param time unix timestamp of the price request.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @return price request identifier.
     */
    function getRequestId(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(identifier, time, ancillaryData));
    }

    // Checks if an assertion is blocked depending on the blockByAssertingCaller / blockByAsserter settings and the
    // assertion's properties.
    function _checkIfAssertionBlocked(bytes32 assertionId) internal view returns (bool) {
        OptimisticOracleV3Interface.Assertion memory assertion = optimisticOracleV3.getAssertion(assertionId);
        return
            (blockByAssertingCaller &&
                !whitelistedAssertingCallers[assertion.escalationManagerSettings.assertingCaller]) ||
            (blockByAsserter && !whitelistedAsserters[assertion.asserter]);
    }
}
