// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/OptimisticOracleV3CallbackRecipientInterface.sol";
import "../interfaces/OptimisticOracleV3Interface.sol";
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
 * @title Optimistic Oracle V3.
 * @notice The OOv3 is used to assert truths about the world which are verified using an optimistic escalation game.
 * @dev Core idea: an asserter makes a statement about a truth, calling "assertTruth". If this statement is not
 * challenged, it is taken as the state of the world. If challenged, it is arbitrated using the UMA DVM, or if
 * configured, an escalation manager. Escalation managers enable integrations to define their own security properties and
 * tradeoffs, enabling the notion of "sovereign security".
 */

contract OptimisticOracleV3 is OptimisticOracleV3Interface, Lockable, Ownable, MultiCaller {
    using SafeERC20 for IERC20;

    FinderInterface public immutable finder; // Finder used to discover other UMA ecosystem contracts.

    // Cached UMA parameters.
    address public cachedOracle;
    mapping(address => WhitelistedCurrency) public cachedCurrencies;
    mapping(bytes32 => bool) public cachedIdentifiers;

    mapping(bytes32 => Assertion) public assertions; // All assertions made by the Optimistic Oracle V3.

    uint256 public burnedBondPercentage; // Percentage of the bond that is paid to the UMA store if the assertion is disputed.

    bytes32 public constant defaultIdentifier = "ASSERT_TRUTH";
    int256 public constant numericalTrue = 1e18; // Numerical representation of true.
    IERC20 public defaultCurrency;
    uint64 public defaultLiveness;

    /**
     * @notice Construct the OptimisticOracleV3 contract.
     * @param _finder keeps track of all contracts within the UMA system based on their interfaceName.
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
     * @param _burnedBondPercentage the percentage of the bond that is sent as fee to UMA Store contract on disputes.
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
     * @notice Asserts a truth about the world, using the default currency and liveness. No callback recipient or
     * escalation manager is enabled. The caller is expected to provide a bond of finalFee/burnedBondPercentage
     * (with burnedBondPercentage set to 50%, the bond is 2x final fee) of the default currency.
     * @dev The caller must approve this contract to spend at least the result of getMinimumBond(defaultCurrency).
     * @param claim the truth claim being asserted. This is an assertion about the world, and is verified by disputers.
     * @param asserter account that receives bonds back at settlement. This could be msg.sender or
     * any other account that the caller wants to receive the bond at settlement time.
     * @return assertionId unique identifier for this assertion.
     */

    function assertTruthWithDefaults(bytes calldata claim, address asserter) external returns (bytes32) {
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
     * @param asserter account that receives bonds back at settlement. This could be msg.sender or
     * any other account that the caller wants to receive the bond at settlement time.
     * @param callbackRecipient if configured, this address will receive a function call assertionResolvedCallback and
     * assertionDisputedCallback at resolution or dispute respectively. Enables dynamic responses to these events. The
     * recipient _must_ implement these callbacks and not revert or the assertion resolution will be blocked.
     * @param escalationManager if configured, this address will control escalation properties of the assertion. This
     * means a) choosing to arbitrate via the UMA DVM, b) choosing to discard assertions on dispute, or choosing to
     * validate disputes. Combining these, the asserter can define their own security properties for the assertion.
     * escalationManager also _must_ implement the same callbacks as callbackRecipient.
     * @param liveness time to wait before the assertion can be resolved. Assertion can be disputed in this time.
     * @param currency bond currency pulled from the caller and held in escrow until the assertion is resolved.
     * @param bond amount of currency to pull from the caller and hold in escrow until the assertion is resolved. This
     * must be >= getMinimumBond(address(currency)).
     * @param identifier UMA DVM identifier to use for price requests in the event of a dispute. Must be pre-approved.
     * @param domainId optional domain that can be used to relate this assertion to others in the escalationManager and
     * can be used by the configured escalationManager to define custom behavior for groups of assertions. This is
     * typically used for "escalation games" by changing bonds or other assertion properties based on the other
     * assertions that have come before. If not needed this value should be 0 to save gas.
     * @return assertionId unique identifier for this assertion.
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
                // Choose which oracle to arbitrate disputes via. If set to true then the escalation manager will
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
            bond,
            identifier
        );
    }

    /**
     * @notice Disputes an assertion. Depending on how the assertion was configured, this may either escalate to the UMA
     * DVM or the configured escalation manager for arbitration.
     * @dev The caller must approve this contract to spend at least bond amount of currency for the associated assertion.
     * @param assertionId unique identifier for the assertion to dispute.
     * @param disputer receives bonds back at settlement.
     */
    function disputeAssertion(bytes32 assertionId, address disputer) external nonReentrant {
        require(disputer != address(0), "Disputer can't be 0");
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

        emit AssertionDisputed(assertionId, msg.sender, disputer);
    }

    /**
     * @notice Resolves an assertion. If the assertion has not been disputed, the assertion is resolved as true and the
     * asserter receives the bond. If the assertion has been disputed, the assertion is resolved depending on the oracle
     * result. Based on the result, the asserter or disputer receives the bond. If the assertion was disputed then an
     * amount of the bond is sent to the UMA Store as an oracle fee based on the burnedBondPercentage. The remainder of
     * the bond is returned to the asserter or disputer.
     * @param assertionId unique identifier for the assertion to resolve.
     */
    function settleAssertion(bytes32 assertionId) public nonReentrant {
        Assertion storage assertion = assertions[assertionId];
        require(assertion.asserter != address(0), "Assertion does not exist"); // Revert if assertion does not exist.
        require(!assertion.settled, "Assertion already settled"); // Revert if assertion already settled.
        assertion.settled = true;
        if (assertion.disputer == address(0)) {
            // No dispute, settle with the asserter
            require(assertion.expirationTime <= getCurrentTime(), "Assertion not expired"); // Revert if not expired.
            assertion.settlementResolution = true;
            assertion.currency.safeTransfer(assertion.asserter, assertion.bond);
            _callbackOnAssertionResolve(assertionId, true);

            emit AssertionSettled(assertionId, assertion.asserter, false, true, msg.sender);
        } else {
            // Dispute, settle with the disputer. Reverts if price not resolved.
            int256 resolvedPrice = _oracleGetPrice(assertionId, assertion.identifier, assertion.assertionTime);

            // If set to discard settlement resolution then false. Else, use oracle value to find resolution.
            if (assertion.escalationManagerSettings.discardOracle) assertion.settlementResolution = false;
            else assertion.settlementResolution = resolvedPrice == numericalTrue;

            address bondRecipient = resolvedPrice == numericalTrue ? assertion.asserter : assertion.disputer;

            // Calculate oracle fee and the remaining amount of bonds to send to the correct party (asserter or disputer).
            uint256 oracleFee = (burnedBondPercentage * assertion.bond) / 1e18;
            uint256 bondRecipientAmount = assertion.bond * 2 - oracleFee;

            // Pay out the oracle fee and remaining bonds to the correct party. Note: the oracle fee is sent to the
            // Store contract, even if the escalation manager is used to arbitrate disputes.
            assertion.currency.safeTransfer(address(_getStore()), oracleFee);
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
    function settleAndGetAssertionResult(bytes32 assertionId) external returns (bool) {
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
    function getAssertion(bytes32 assertionId) external view returns (Assertion memory) {
        return assertions[assertionId];
    }

    /**
     * @notice Fetches the resolution of a specific assertion and returns it. If the assertion has not been settled then
     * this will revert. If the assertion was disputed and configured to discard the oracle resolution return false.
     * @param assertionId unique identifier for the assertion to fetch the resolution for.
     * @return resolution of the assertion.
     */
    function getAssertionResult(bytes32 assertionId) public view returns (bool) {
        Assertion memory assertion = assertions[assertionId];
        // Return early if not using answer from resolved dispute.
        if (assertion.disputer != address(0) && assertion.escalationManagerSettings.discardOracle) return false;
        require(assertion.settled, "Assertion not settled"); // Revert if assertion not settled.
        return assertion.settlementResolution;
    }

    /**
     * @notice Returns the current block timestamp.
     * @dev Can be overridden to control contract time.
     * @return current block timestamp.
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
     * currency divided by the burnedBondPercentage. If burn percentage is 50% then the min bond is 2x the final fee.
     * @param currency currency to calculate the minimum bond for.
     * @return minimum bond amount.
     */
    function getMinimumBond(address currency) public view returns (uint256) {
        uint256 finalFee = cachedCurrencies[currency].finalFee;
        return (finalFee * 1e18) / burnedBondPercentage;
    }

    // Returns the unique identifier for this assertion. This identifier is used to identify the assertion.
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

    // Returns ancillary data for the Oracle request containing assertionId and asserter.
    function _stampAssertion(bytes32 assertionId) internal view returns (bytes memory) {
        return
            AncillaryData.appendKeyValueAddress(
                AncillaryData.appendKeyValueBytes32("", "assertionId", assertionId),
                "ooAsserter",
                assertions[assertionId].asserter
            );
    }

    // Returns the Address Whitelist contract to validate the currency.
    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    // Returns the Identifier Whitelist contract to validate the identifier.
    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    // Returns the Store contract to fetch the final fee.
    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    // Returns the Oracle contract to use on dispute. This can be either UMA DVM or the escalation manager.
    function _getOracle(bytes32 assertionId) internal view returns (OracleAncillaryInterface) {
        if (assertions[assertionId].escalationManagerSettings.arbitrateViaEscalationManager)
            return OracleAncillaryInterface(_getEscalationManager(assertionId));
        return OracleAncillaryInterface(cachedOracle);
    }

    // Requests resolving dispute from the Oracle (UMA DVM or escalation manager).
    function _oracleRequestPrice(
        bytes32 assertionId,
        bytes32 identifier,
        uint256 time
    ) internal {
        _getOracle(assertionId).requestPrice(identifier, time, _stampAssertion(assertionId));
    }

    // Returns the resolved resolution from the Oracle (UMA DVM or escalation manager).
    function _oracleGetPrice(
        bytes32 assertionId,
        bytes32 identifier,
        uint256 time
    ) internal view returns (int256) {
        return _getOracle(assertionId).getPrice(identifier, time, _stampAssertion(assertionId));
    }

    // Returns the escalation manager address for the assertion.
    function _getEscalationManager(bytes32 assertionId) internal view returns (address) {
        return assertions[assertionId].escalationManagerSettings.escalationManager;
    }

    // Returns the assertion policy parameters from the escalation manager. If no escalation manager is set then return
    // default values.
    function _getAssertionPolicy(bytes32 assertionId)
        internal
        view
        returns (EscalationManagerInterface.AssertionPolicy memory)
    {
        address em = _getEscalationManager(assertionId);
        if (em == address(0)) return EscalationManagerInterface.AssertionPolicy(false, false, false, false);
        return EscalationManagerInterface(em).getAssertionPolicy(assertionId);
    }

    // Returns whether the dispute is allowed by the escalation manager. If no escalation manager is set or the
    // escalation manager is not configured to validate disputers then return true.
    function _isDisputeAllowed(bytes32 assertionId) internal view returns (bool) {
        if (!assertions[assertionId].escalationManagerSettings.validateDisputers) return true;
        address em = assertions[assertionId].escalationManagerSettings.escalationManager;
        if (em == address(0)) return true;
        return EscalationManagerInterface(em).isDisputeAllowed(assertionId, msg.sender);
    }

    // Validates if the identifier is whitelisted by first checking the cache. If not whitelisted in the cache then
    // checks it from the identifier whitelist contract and caches result.
    function _validateAndCacheIdentifier(bytes32 identifier) internal returns (bool) {
        if (cachedIdentifiers[identifier]) return true;
        cachedIdentifiers[identifier] = _getIdentifierWhitelist().isIdentifierSupported(identifier);
        return cachedIdentifiers[identifier];
    }

    // Validates if the currency is whitelisted by first checking the cache. If not whitelisted in the cache then
    // checks it from the collateral whitelist contract and caches whitelist status and final fee.
    function _validateAndCacheCurrency(address currency) internal returns (bool) {
        if (cachedCurrencies[currency].isWhitelisted) return true;
        cachedCurrencies[currency].isWhitelisted = _getCollateralWhitelist().isOnWhitelist(currency);
        cachedCurrencies[currency].finalFee = _getStore().computeFinalFee(currency).rawValue;
        return cachedCurrencies[currency].isWhitelisted;
    }

    // Sends assertion resolved callback to the callback recipient and escalation manager (if set).
    function _callbackOnAssertionResolve(bytes32 assertionId, bool assertedTruthfully) internal {
        address cr = assertions[assertionId].callbackRecipient;
        address em = _getEscalationManager(assertionId);
        if (cr != address(0))
            OptimisticOracleV3CallbackRecipientInterface(cr).assertionResolvedCallback(assertionId, assertedTruthfully);
        if (em != address(0)) EscalationManagerInterface(em).assertionResolvedCallback(assertionId, assertedTruthfully);
    }

    // Sends assertion disputed callback to the callback recipient and escalation manager (if set).
    function _callbackOnAssertionDispute(bytes32 assertionId) internal {
        address cr = assertions[assertionId].callbackRecipient;
        address em = _getEscalationManager(assertionId);
        if (cr != address(0)) OptimisticOracleV3CallbackRecipientInterface(cr).assertionDisputedCallback(assertionId);
        if (em != address(0)) EscalationManagerInterface(em).assertionDisputedCallback(assertionId);
    }
}
