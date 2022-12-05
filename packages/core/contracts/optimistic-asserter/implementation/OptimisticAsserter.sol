// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/OptimisticAsserterCallbackRecipientInterface.sol";
import "../interfaces/OptimisticAsserterInterface.sol";
import "../interfaces/EscalationManagerInterface.sol";

import "../../data-verification-mechanism/implementation/Constants.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../../data-verification-mechanism/interfaces/StoreInterface.sol";

import "../../common/implementation/AddressWhitelist.sol";
import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";

/**
 * @title Optimistic Asserter.
 * @notice The OA is used to assert truths about the world which are verified using an optimistic escalation game.
 * @dev Core idea: an asserter makes a statement about a truth, calling "assertTruth". If this statement is not
 * challenged, it is taken as the state of the world. If challenged, it is arbitrated using the UMA DVM, or if
 * configured, an escalation manager. Escalation managers enable integrations to define their own security properties and
 * tradeoffs, enabling the notion of "sovereign security".
 */

contract OptimisticAsserter is OptimisticAsserterInterface, Lockable, Ownable, MultiCaller {
    using SafeERC20 for IERC20;

    FinderInterface public immutable finder; // Finder used to discover other UMA ecosystem contracts.

    // Cached UMA parameters.
    address public cachedOracle;
    mapping(address => WhitelistedCurrency) public cachedCurrencies;
    mapping(bytes32 => bool) public cachedIdentifiers;

    mapping(bytes32 => Assertion) public assertions; // All assertions made by the optimistic asserter.

    uint256 public burnedBondPercentage; // Percentage of the bond that is paid to the UMA store if the assertion is disputed.

    bytes32 public constant defaultIdentifier = "ASSERT_TRUTH";
    IERC20 public defaultCurrency;
    uint64 public defaultLiveness;

    /**
     * @notice Construct the OptimisticAsserter contract.
     * @param _finder keeps track of all contracts within the UMA system based on their interfaceName. Managed by the UMA Governor contract.
     * @param _defaultCurrency the default currency to bond asserters in assertTruthWithDefaults.
     * @param _defaultLiveness the default liveness for assertions in assertTruthWithDefaults.
     */
    constructor(
        FinderInterface _finder,
        IERC20 _defaultCurrency,
        uint64 _defaultLiveness
    ) {
        finder = _finder;
        setAdminProperties(_defaultCurrency, _defaultLiveness, 0.5e18);
    }

    /**
     * @notice Sets the default currency, liveness, and burned bond percentage.
     * @dev Only callable by the contract owner (UMA governor).
     * @param _defaultCurrency the default currency to bond asserters in assertTruthWithDefaults.
     * @param _defaultLiveness the default liveness for assertions in assertTruthWithDefaults.
     * @param _burnedBondPercentage the percentage of the bond that is burned if the assertion is disputed.
     */
    function setAdminProperties(
        IERC20 _defaultCurrency,
        uint64 _defaultLiveness,
        uint256 _burnedBondPercentage
    ) public onlyOwner {
        require(_burnedBondPercentage <= 1e18, "Burned bond percentage > 100");
        require(_burnedBondPercentage > 0, "Burned bond percentage is 0");
        burnedBondPercentage = _burnedBondPercentage;
        defaultCurrency = _defaultCurrency;
        defaultLiveness = _defaultLiveness;
        syncUmaParams(defaultIdentifier, address(_defaultCurrency));

        emit AdminPropertiesSet(_defaultCurrency, _defaultLiveness, _burnedBondPercentage);
    }

    /**
     * @notice Asserts a truth about the world, using the default currency and liveness. No callback recipient
     * or escalation manager is enabled. The caller is the asserter and is expected to provide a bond of the
     * currencies finalFee/burnedBondPercentage (with burnedBondPercentage set to 50%, the bond is 2x final fee).
     * @dev The caller must approve this contract to spend at least the result of getMinimumBond(defaultCurrency).
     * @param claim the truth claim being asserted. This is an assertion about the world, and is verified by disputers.
     * @return assertionId unique identifier for this assertion.
     */

    function assertTruthWithDefaults(bytes calldata claim, address asserter) public returns (bytes32 assertionId) {
        // Note: re-entrancy guard is done in the inner call.
        return
            assertTruth(
                claim,
                asserter, // asserter
                address(0), // callbackRecipient
                address(0), // escalationManager
                defaultLiveness,
                defaultCurrency,
                getMinimumBond(address(defaultCurrency)),
                defaultIdentifier,
                bytes32(0)
            );
    }

    /**
     * @notice Asserts a truth about the world, using a fully custom configuration.
     * @dev The caller must approve this contract to spend at least bond amount of currency.
     * @param claim the truth claim being asserted. This is an assertion about the world, and is verified by disputers.
     * @param asserter receives bonds back at settlement. This could be msg.sender or
     * any other account that the caller wants to receive the bond at settlement time.
     * @param callbackRecipient if configured, this address will receive a function call assertionResolvedCallback and
     * assertionDisputedCallback at resolution or dispute respectively. Enables dynamic responses to these events. The recipient _must_ implement these callbacks and not revert
     * or the assertion resolution will be blocked.
     * @param escalationManager if configured, this address will control escalation properties of the assertion. This
     * this means a) choosing to arbitrate via the UMA DVM, b) choosing to discard assertions on dispute, or choosing to
     * validate disputes. Combining these, the asserter can define their own security properties the assertion.
     * @param currency bond currency pulled from the caller and held in escrow until the assertion is resolved.
     * @param bond amount of currency to pull from the caller and hold in escrow until the assertion is resolved. This must be >= getMinimumBond(address(currency)).
     * @param liveness time to wait before the assertion can be resolved. Assertion can be disputed in this time.
     * @param identifier UMA DVM identifier to use for price requests in the event of a dispute. Must be a pre-approved identifier in the UMA DVM.
     * @param domainId optional domain that can be used to relate this assertion to other assertions in the escalationManager.
     * This can be used by the configured escalationManager to define custom behavior for groups of assertions.
     * This is typically used for "escalation games" by changing bonds or other assertion properties
     * based on the other assertions that have come before. If no escalationManager is configured or a domain is not needed,
     * this value should be set to bytes32(0) to reduce gas costs.
     */
    function assertTruth(
        bytes memory claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 domainId
    ) public nonReentrant returns (bytes32 assertionId) {
        uint64 time = uint64(getCurrentTime());
        assertionId = _getId(claim, bond, time, liveness, currency, callbackRecipient, escalationManager, identifier);

        require(asserter != address(0), "Asserter cant be 0");
        require(assertions[assertionId].asserter == address(0), "Assertion already exists");
        require(_validateAndCacheIdentifier(identifier), "Unsupported identifier");
        require(_validateAndCacheCurrency(address(currency)), "Unsupported currency");
        require(bond >= getMinimumBond(address(currency)), "Bond amount too low");

        assertions[assertionId] = Assertion({
            escalationManagerSettings: EscalationManagerSettings({
                arbitrateViaEscalationManager: false, // Default behavior: use the DVM as an oracle.
                discardOracle: false, // Default behavior: respect the Oracle result.
                validateDisputers: false, // Default behavior: disputer will not be validated.
                escalationManager: escalationManager,
                assertingCaller: msg.sender
            }),
            asserter: asserter,
            disputer: address(0),
            callbackRecipient: callbackRecipient,
            currency: currency,
            domainId: domainId,
            identifier: identifier,
            bond: bond,
            settled: false,
            settlementResolution: false,
            assertionTime: time,
            expirationTime: time + liveness
        });

        {
            EscalationManagerInterface.AssertionPolicy memory assertionPolicy = _getAssertionPolicy(assertionId);
            require(!assertionPolicy.blockAssertion, "Assertion not allowed"); // Check if the assertion is permitted.
            EscalationManagerSettings storage emSettings = assertions[assertionId].escalationManagerSettings;
            (emSettings.arbitrateViaEscalationManager, emSettings.discardOracle, emSettings.validateDisputers) = (
                // Choose which oracle to arbitrate disputes via. If Set to true then the escalation manager will
                // arbitrate disputes. Else, the DVM arbitrates disputes. This lets integrations "unplug" the DVM.
                assertionPolicy.arbitrateViaEscalationManager,
                // Choose whether to discard the Oracle result. If true then "throw away" the assertion. To get an
                // assertion to be true it must be re-asserted and not disputed.
                assertionPolicy.discardOracle,
                // Configures if the escalation manager should validate the disputer on assertions. This enables you
                // to construct setups such as whitelisted disputers.
                assertionPolicy.validateDisputers
            );
        }

        currency.safeTransferFrom(msg.sender, address(this), bond); // Pull the bond from the caller.

        emit AssertionMade(
            assertionId,
            domainId,
            claim,
            asserter,
            callbackRecipient,
            escalationManager,
            msg.sender,
            time + liveness,
            currency,
            bond
        );

        return assertionId;
    }

    /**
     * @notice Disputes an assertion. Depending on how the assertion was configured, this may either escalate to the UMA
     * DVM or the configured escalation manager for arbitration.
     * @dev The caller must approve this contract to spend at least bond amount of currency for the associated assertion.
     * @param assertionId unique identifier for the assertion to dispute.
     * @param disputer receives bonds back at settlement.
     */
    function disputeAssertion(bytes32 assertionId, address disputer) public nonReentrant {
        require(disputer != address(0), "Disputer cant be 0");
        Assertion storage assertion = assertions[assertionId];
        require(assertion.asserter != address(0), "Assertion does not exist");
        require(assertion.disputer == address(0), "Assertion already disputed");
        require(assertion.expirationTime > getCurrentTime(), "Assertion is expired");
        require(_isDisputeAllowed(assertionId), "Dispute not allowed");

        assertion.disputer = disputer;

        assertion.currency.safeTransferFrom(msg.sender, address(this), assertion.bond);

        _oracleRequestPrice(assertionId, assertion.identifier, assertion.assertionTime);

        _callbackOnAssertionDispute(assertionId);

        // Send resolve callback if dispute resolution is discarded
        if (assertion.escalationManagerSettings.discardOracle) _callbackOnAssertionResolve(assertionId, false);

        emit AssertionDisputed(assertionId, disputer);
    }

    /**
     * @notice Resolves an assertion. If the assertion has not been disputed, the assertion is resolved as true and the
     * asserter receives the bond. If the assertion has been disputed, the assertion is resolved depending on the oracle
     * result. Based on the result, the asserter or disputer receives the bond. If the assertion was disputed then an
     * amount of the bond is burned to the UMA Store based on the burnedBondPercentage. The remainder of the bond is
     * returned to the asserter or disputer.
     * @param assertionId unique identifier for the assertion to resolve.
     */
    function settleAssertion(bytes32 assertionId) public nonReentrant {
        Assertion storage assertion = assertions[assertionId];
        require(assertion.asserter != address(0), "Assertion does not exist"); // Revert if assertion does not exist.
        require(!assertion.settled, "Assertion already settled"); // Revert if assertion already settled.
        assertion.settled = true;
        if (assertion.disputer == address(0)) {
            // No dispute, settle with the asserter
            require(assertion.expirationTime <= getCurrentTime(), "Assertion not expired"); // Revert if assertion not expired.
            assertion.settlementResolution = true;
            assertion.currency.safeTransfer(assertion.asserter, assertion.bond);
            _callbackOnAssertionResolve(assertionId, true);

            emit AssertionSettled(assertionId, assertion.asserter, false, true, msg.sender);
        } else {
            // Dispute, settle with the disputer. // Revert if price not resolved.
            int256 resolvedPrice = _oracleGetPrice(assertionId, assertion.identifier, assertion.assertionTime);

            // If set to discard settlement resolution then false. Else, use oracle value to find resolution.
            if (assertion.escalationManagerSettings.discardOracle) assertion.settlementResolution = false;
            else assertion.settlementResolution = resolvedPrice == 1e18;

            address bondRecipient = resolvedPrice == 1e18 ? assertion.asserter : assertion.disputer;

            // If set to use UMA DVM as oracle then oracleFee must be sent to UMA Store contract. Else, if not using UMA
            // DVM then the bond is returned to the correct party (asserter or disputer).
            uint256 oracleFee = (burnedBondPercentage * assertion.bond) / 1e18;
            if (assertion.escalationManagerSettings.arbitrateViaEscalationManager) oracleFee = 0;
            uint256 bondRecipientAmount = assertion.bond * 2 - oracleFee;

            // Send tokens. If the DVM is used as an oracle then send the oracleFee to the Store.
            if (oracleFee > 0) assertion.currency.safeTransfer(address(_getStore()), oracleFee);
            assertion.currency.safeTransfer(bondRecipient, bondRecipientAmount);

            if (!assertion.escalationManagerSettings.discardOracle)
                _callbackOnAssertionResolve(assertionId, assertion.settlementResolution);

            emit AssertionSettled(assertionId, bondRecipient, true, assertion.settlementResolution, msg.sender);
        }
    }

    /**
     * @notice Settles an assertion and returns the resolution.
     * @param assertionId unique identifier for the assertion to resolve and return the resolution for.
     * @return resolution of the assertion.
     */
    function settleAndGetAssertionResult(bytes32 assertionId) public returns (bool resolution) {
        // Note: re-entrancy guard is done in the inner settleAssertion call.
        if (!assertions[assertionId].settled) settleAssertion(assertionId);
        return getAssertionResult(assertionId);
    }

    /**
     * @notice Fetches information about a specific identifier & currency from the UMA contracts and stores a local copy
     * of the information within this contract. This is used to save gas when making assertions as we can avoid an
     * external call to the UMA contracts to fetch this.
     * @param identifier identifier to fetch information for and store locally.
     * @param currency currency to fetch information for and store locally.
     */
    function syncUmaParams(bytes32 identifier, address currency) public {
        cachedOracle = finder.getImplementationAddress(OracleInterfaces.Oracle);
        cachedIdentifiers[identifier] = _getIdentifierWhitelist().isIdentifierSupported(identifier);
        cachedCurrencies[currency].isWhitelisted = _getCollateralWhitelist().isOnWhitelist(currency);
        cachedCurrencies[currency].finalFee = _getStore().computeFinalFee(currency).rawValue;
    }

    /**
     * @notice Fetches information about a specific assertion and returns it.
     * @param assertionId unique identifier for the assertion to fetch information for.
     * @return assertion information about the assertion.
     */
    function getAssertion(bytes32 assertionId) external view returns (Assertion memory assertion) {
        return assertions[assertionId];
    }

    /**
     * @notice Fetches the resolution of a specific assertion and returns it. If the assertion has not been settled then
     * this will revert. If the assertion was disputed and configured to discard the oracle resolution return false.
     * @param assertionId unique identifier for the assertion to fetch the resolution for.
     * @return resolution of the assertion.
     */
    function getAssertionResult(bytes32 assertionId) public view returns (bool resolution) {
        Assertion memory assertion = assertions[assertionId];
        // Return early if not using answer from resolved dispute.
        if (assertion.disputer != address(0) && assertion.escalationManagerSettings.discardOracle) return false;
        require(assertion.settled, "Assertion not settled"); // Revert if assertion not settled.
        return assertion.settlementResolution;
    }

    /**
     * @notice Returns the current block timestamp.
     * @dev Can be overridden to control contract time.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    /**
     * @notice Appends information onto an assertionId to construct ancillary data used for dispute resolution.
     * @param assertionId unique identifier for the assertion to construct ancillary data for.
     * @return ancillaryData stamped assertion information.
     */
    function stampAssertion(bytes32 assertionId) public view returns (bytes memory) {
        return _stampAssertion(assertionId);
    }

    /**
     * @notice Returns the minimum bond amount required to make an assertion. This is calculated as the final fee of the
     * currency divided by the burnedBondPercentage. If the burn percentage is 50% then the min bond is 2x the final fee.
     * @param currency currency to calculate the minimum bond for.
     * @return minimum bond amount.
     */
    function getMinimumBond(address currency) public view returns (uint256) {
        uint256 finalFee = cachedCurrencies[currency].finalFee;
        return (finalFee * 1e18) / burnedBondPercentage;
    }

    function _getId(
        bytes memory claim,
        uint256 bond,
        uint256 time,
        uint64 liveness,
        IERC20 currency,
        address callbackRecipient,
        address escalationManager,
        bytes32 identifier
    ) internal view returns (bytes32) {
        // Returns the unique ID for this assertion. This ID is used to identify the assertion in the Oracle.
        return
            keccak256(
                abi.encode(
                    claim,
                    bond,
                    time,
                    liveness,
                    currency,
                    callbackRecipient,
                    escalationManager,
                    identifier,
                    msg.sender
                )
            );
    }

    function _stampAssertion(bytes32 assertionId) internal view returns (bytes memory) {
        // Returns ancillary data for the Oracle request containing assertionId and asserter.
        return
            AncillaryData.appendKeyValueAddress(
                AncillaryData.appendKeyValueBytes32("", "assertionId", assertionId),
                "oaAsserter",
                assertions[assertionId].asserter
            );
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _getOracle(bytes32 assertionId) internal view returns (OracleAncillaryInterface) {
        if (assertions[assertionId].escalationManagerSettings.arbitrateViaEscalationManager)
            return OracleAncillaryInterface(address(_getEscalationManager(assertionId)));
        return OracleAncillaryInterface(cachedOracle);
    }

    function _oracleRequestPrice(
        bytes32 assertionId,
        bytes32 identifier,
        uint256 time
    ) internal {
        _getOracle(assertionId).requestPrice(identifier, time, _stampAssertion(assertionId));
    }

    function _oracleGetPrice(
        bytes32 assertionId,
        bytes32 identifier,
        uint256 time
    ) internal view returns (int256) {
        return _getOracle(assertionId).getPrice(identifier, time, _stampAssertion(assertionId));
    }

    function _getEscalationManager(bytes32 assertionId) internal view returns (EscalationManagerInterface) {
        return EscalationManagerInterface(assertions[assertionId].escalationManagerSettings.escalationManager);
    }

    function _getAssertionPolicy(bytes32 assertionId)
        internal
        view
        returns (EscalationManagerInterface.AssertionPolicy memory)
    {
        address em = assertions[assertionId].escalationManagerSettings.escalationManager;
        if (em == address(0)) return EscalationManagerInterface.AssertionPolicy(false, false, false, false);
        return EscalationManagerInterface(em).getAssertionPolicy(assertionId);
    }

    function _isDisputeAllowed(bytes32 assertionId) internal view returns (bool) {
        address em = assertions[assertionId].escalationManagerSettings.escalationManager;
        if (!assertions[assertionId].escalationManagerSettings.validateDisputers) return true;
        return EscalationManagerInterface(em).isDisputeAllowed(assertionId, msg.sender);
    }

    function _validateAndCacheIdentifier(bytes32 identifier) internal returns (bool) {
        if (cachedIdentifiers[identifier]) return true;
        cachedIdentifiers[identifier] = _getIdentifierWhitelist().isIdentifierSupported(identifier);
        return cachedIdentifiers[identifier];
    }

    function _validateAndCacheCurrency(address currency) internal returns (bool) {
        if (cachedCurrencies[currency].isWhitelisted) return true;
        cachedCurrencies[currency].isWhitelisted = _getCollateralWhitelist().isOnWhitelist(currency);
        cachedCurrencies[currency].finalFee = _getStore().computeFinalFee(currency).rawValue;
        return cachedCurrencies[currency].isWhitelisted;
    }

    function _callbackOnAssertionResolve(bytes32 assertionId, bool assertedTruthfully) internal {
        if (assertions[assertionId].callbackRecipient != address(0))
            OptimisticAsserterCallbackRecipientInterface(assertions[assertionId].callbackRecipient)
                .assertionResolvedCallback(assertionId, assertedTruthfully);
        if (assertions[assertionId].escalationManagerSettings.escalationManager != address(0))
            EscalationManagerInterface(assertions[assertionId].escalationManagerSettings.escalationManager)
                .assertionResolvedCallback(assertionId, assertedTruthfully);
    }

    function _callbackOnAssertionDispute(bytes32 assertionId) internal {
        if (assertions[assertionId].callbackRecipient != address(0))
            OptimisticAsserterCallbackRecipientInterface(assertions[assertionId].callbackRecipient)
                .assertionDisputedCallback(assertionId);
        if (assertions[assertionId].escalationManagerSettings.escalationManager != address(0))
            EscalationManagerInterface(assertions[assertionId].escalationManagerSettings.escalationManager)
                .assertionDisputedCallback(assertionId);
    }
}
