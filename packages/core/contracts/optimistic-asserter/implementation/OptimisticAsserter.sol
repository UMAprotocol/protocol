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

contract OptimisticAsserter is OptimisticAsserterInterface, Lockable, Ownable, MultiCaller {
    using SafeERC20 for IERC20;

    FinderInterface public immutable finder;

    // Cached UMA parameters.
    address public cachedOracle;
    mapping(address => WhitelistedCurrency) public cachedCurrencies;
    mapping(bytes32 => bool) public cachedIdentifiers;

    mapping(bytes32 => Assertion) public assertions;

    uint256 public burnedBondPercentage;

    bytes32 public constant defaultIdentifier = "ASSERT_TRUTH";

    IERC20 public defaultCurrency;
    uint64 public defaultLiveness;

    constructor(
        FinderInterface _finder,
        IERC20 _defaultCurrency,
        uint64 _defaultLiveness
    ) {
        finder = _finder;
        setAdminProperties(_defaultCurrency, _defaultLiveness, 0.5e18);
    }

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

    function getAssertion(bytes32 assertionId) external view returns (Assertion memory) {
        return assertions[assertionId];
    }

    function assertTruthWithDefaults(bytes calldata claim) public returns (bytes32) {
        // Note: re-entrancy guard is done in the inner call.
        return
            assertTruth(
                claim,
                msg.sender, // asserter
                address(0), // callbackRecipient
                address(0), // escalationManager
                defaultCurrency,
                getMinimumBond(address(defaultCurrency)),
                defaultLiveness,
                defaultIdentifier
            );
    }

    function assertTruth(
        bytes calldata claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        IERC20 currency,
        uint256 bond,
        uint64 liveness,
        bytes32 identifier
    ) public nonReentrant returns (bytes32) {
        // TODO: think about placing either msg.sender or block.timestamp into the claim ID to block an advasery
        // creating a claim that collides with a known assertion that will be created into the future.
        bytes32 assertionId = _getId(claim, bond, liveness, currency, callbackRecipient, escalationManager, identifier);

        require(asserter != address(0), "Asserter cant be 0");
        require(assertions[assertionId].asserter == address(0), "Assertion already exists");
        require(_validateAndCacheIdentifier(identifier), "Unsupported identifier");
        require(_validateAndCacheCurrency(address(currency)), "Unsupported currency");
        require(bond >= getMinimumBond(address(currency)), "Bond amount too low");

        uint64 currentTime = uint64(getCurrentTime());
        assertions[assertionId] = Assertion({
            escalationManagerSettings: EscalationManagerSettings({
                arbitrateViaEscalationManager: false, // this is the default behavior: if not specified by the Sovereign security the assertion will use the DVM as an oracle.
                discardOracle: false, // this is the default behavior: if not specified by the Sovereign security the assertion will respect the Oracle result.
                validateDisputers: false, // this is the default behavior: if not specified by the Sovereign security the disputer will not be validated.
                escalationManager: escalationManager,
                assertingCaller: msg.sender
            }),
            asserter: asserter,
            disputer: address(0),
            callbackRecipient: callbackRecipient,
            currency: currency,
            claimId: keccak256(claim),
            identifier: identifier,
            bond: bond,
            settled: false,
            settlementResolution: false,
            assertionTime: currentTime,
            expirationTime: currentTime + liveness
        });

        {
            // Scope for Escalation Manager Settings update, avoids stack too deep errors
            EscalationManagerInterface.AssertionPolicy memory assertionPolicy = _getAssertionPolicy(assertionId);
            // Check if the assertion is allowed by the sovereign security.
            require(!assertionPolicy.blockAssertion, "Assertion not allowed");
            EscalationManagerSettings storage emSettings = assertions[assertionId].escalationManagerSettings;
            (emSettings.arbitrateViaEscalationManager, emSettings.discardOracle, emSettings.validateDisputers) = (
                assertionPolicy.arbitrateViaEscalationManager, // Use SS as an oracle if specified by the SS.
                assertionPolicy.discardOracle, // Discard Oracle result if specified by the SS.
                assertionPolicy.validateDisputers // Validate the disputers if specified by the SS.
            );
        }

        // Pull the bond
        currency.safeTransferFrom(msg.sender, address(this), bond);

        emit AssertionMade(
            assertionId,
            claim,
            asserter,
            callbackRecipient,
            escalationManager,
            msg.sender,
            currency,
            bond,
            currentTime + liveness
        );

        return assertionId;
    }

    function getAssertionResult(bytes32 assertionId) public view returns (bool) {
        Assertion memory assertion = assertions[assertionId];
        // Return early if not using answer from resolved dispute.
        if (assertion.disputer != address(0) && assertion.escalationManagerSettings.discardOracle) return false;
        require(assertion.settled, "Assertion not settled"); // Revert if assertion not settled.
        return assertion.settlementResolution;
    }

    function settleAndGetAssertionResult(bytes32 assertionId) public returns (bool) {
        // Note: re-entrancy guard is done in the inner settleAssertion call.
        if (!assertions[assertionId].settled) settleAssertion(assertionId);
        return getAssertionResult(assertionId);
    }

    function disputeAssertion(bytes32 assertionId, address disputer) public nonReentrant {
        require(disputer != address(0), "Disputer cant be 0");
        Assertion storage assertion = assertions[assertionId];
        require(assertion.asserter != address(0), "Assertion does not exist"); // Revert if assertion does not exist.
        require(assertion.disputer == address(0), "Assertion already disputed"); // Revert if assertion already disputed.
        require(assertion.expirationTime > getCurrentTime(), "Assertion is expired"); // Revert if assertion expired.
        require(_isDisputeAllowed(assertionId), "Dispute not allowed"); // Revert if dispute not allowed.

        assertion.disputer = disputer;

        // Pull the bond
        assertion.currency.safeTransferFrom(msg.sender, address(this), assertion.bond);

        _oracleRequestPrice(assertionId, assertion.identifier, assertion.assertionTime);

        // Send dispute callback
        // TODO: consider mergeing the isDisputeAlloowed into toe SSM callback (revert within callback to block).
        _callbackOnAssertionDispute(assertionId);

        // Send resolve callback if dispute resolution is discarded
        if (assertion.escalationManagerSettings.discardOracle) _callbackOnAssertionResolve(assertionId, false);

        emit AssertionDisputed(assertionId, disputer);
    }

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

            emit AssertionSettled(assertionId, assertion.asserter, false, true);
        } else {
            // Dispute, settle with the disputer
            int256 resolvedPrice = _oracleGetPrice(assertionId, assertion.identifier, assertion.assertionTime); // Revert if price not resolved.

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

            emit AssertionSettled(assertionId, bondRecipient, true, assertion.settlementResolution);
        }
    }

    function syncUmaParams(bytes32 identifier, address currency) public {
        cachedOracle = finder.getImplementationAddress(OracleInterfaces.Oracle);
        cachedIdentifiers[identifier] = _getIdentifierWhitelist().isIdentifierSupported(identifier);
        cachedCurrencies[currency].isWhitelisted = _getCollateralWhitelist().isOnWhitelist(currency);
        cachedCurrencies[currency].finalFee = _getStore().computeFinalFee(currency).rawValue;
    }

    /**
     * @notice Returns the current block timestamp.
     * @dev Can be overridden to control contract time.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    function stampAssertion(bytes32 assertionId) public view returns (bytes memory) {
        return _stampAssertion(assertionId);
    }

    function getMinimumBond(address currencyAddress) public view returns (uint256) {
        uint256 finalFee = cachedCurrencies[currencyAddress].finalFee;
        return (finalFee * 1e18) / burnedBondPercentage;
    }

    function _getId(
        bytes calldata claim,
        uint256 bond,
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
                    liveness,
                    currency,
                    callbackRecipient,
                    escalationManager,
                    identifier,
                    getCurrentTime(),
                    msg.sender
                )
            );
    }

    function _stampAssertion(bytes32 assertionId) internal view returns (bytes memory) {
        // Returns the unique ID for this assertion. This ID is used to identify the assertion in the Oracle.
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
