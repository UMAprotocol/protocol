// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/OptimisticAsserterCallbackRecipientInterface.sol";
import "../interfaces/OptimisticAsserterInterface.sol";
import "../interfaces/SovereignSecurityInterface.sol";

import "../../data-verification-mechanism/implementation/Constants.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../../data-verification-mechanism/interfaces/StoreInterface.sol";

import "../../common/implementation/AddressWhitelist.sol";
import "../../common/implementation/AncillaryData.sol";
import "../../common/implementation/Lockable.sol";

// TODO use reentrancy guard
contract OptimisticAsserter is OptimisticAsserterInterface, Lockable, Ownable {
    using SafeERC20 for IERC20;

    FinderInterface public immutable finder;

    mapping(bytes32 => Assertion) public assertions;

    // TODO add setters to change burnedBondPercentage
    // TODO dynamic unit tests for burnedBondPercentage
    uint256 public burnedBondPercentage = 0.5e18; //50% of bond is burned.

    bytes32 public constant defaultIdentifier = "ASSERT_TRUTH";

    IERC20 public defaultCurrency;
    uint256 public defaultLiveness;

    CachedUmaParams public cachedUmaParams;

    constructor(
        FinderInterface _finder,
        IERC20 _defaultCurrency,
        uint256 _defaultLiveness
    ) {
        finder = _finder;
        setAssertionDefaults(_defaultCurrency, _defaultLiveness);
    }

    // TODO consider renaming this
    function setAssertionDefaults(IERC20 _defaultCurrency, uint256 _defaultLiveness) public onlyOwner {
        defaultCurrency = _defaultCurrency;
        defaultLiveness = _defaultLiveness;
        syncUmaParams(defaultIdentifier, address(_defaultCurrency));

        emit AssertionDefaultsSet(_defaultCurrency, _defaultLiveness);
    }

    function getAssertion(bytes32 assertionId) external view returns (Assertion memory) {
        return assertions[assertionId];
    }

    function setBurnedBondPercentage(uint256 _burnedBondPercentage) public onlyOwner {
        require(_burnedBondPercentage <= 1e18, "Burned bond percentage > 100");
        require(_burnedBondPercentage > 0, "Burned bond percentage is 0");
        burnedBondPercentage = _burnedBondPercentage;
        emit BurnedBondPercentageSet(_burnedBondPercentage);
    }

    function assertTruth(bytes memory claim) public returns (bytes32) {
        return
            assertTruthFor(
                claim,
                address(0),
                address(0),
                address(0),
                defaultCurrency,
                getMinimumBond(address(defaultCurrency)),
                defaultLiveness,
                defaultIdentifier
            );
    }

    function assertTruthFor(
        bytes memory claim,
        address asserter,
        address callbackRecipient,
        address sovereignSecurity,
        IERC20 currency,
        uint256 bond,
        uint256 liveness,
        bytes32 identifier
    ) public returns (bytes32) {
        asserter = asserter == address(0) ? msg.sender : asserter;
        bytes32 assertionId = _getId(claim, bond, liveness, currency, callbackRecipient, sovereignSecurity, identifier);

        require(assertions[assertionId].asserter == address(0), "Assertion already exists");
        require(_isIdentifierSupported(identifier), "Unsupported identifier");
        require(_isCurrencyWhitelisted(address(currency)), "Unsupported currency");
        require(bond >= getMinimumBond(address(currency)), "Bond amount too low");

        // Pull the bond
        currency.safeTransferFrom(msg.sender, address(this), bond);

        assertions[assertionId] = Assertion({
            asserter: asserter,
            disputer: address(0),
            callbackRecipient: callbackRecipient,
            currency: currency,
            settled: false,
            settlementResolution: false,
            bond: bond,
            assertionTime: getCurrentTime(),
            expirationTime: getCurrentTime() + liveness,
            claimId: keccak256(claim),
            identifier: identifier,
            ssSettings: SsSettings({
                arbitrateViaSs: false, // this is the default behavior: if not specified by the Sovereign security the assertion will use the DVM as an oracle.
                discardOracle: false, // this is the default behavior: if not specified by the Sovereign security the assertion will respect the Oracle result.
                validateDisputers: false, // this is the default behavior: if not specified by the Sovereign security the disputer will not be validated.
                sovereignSecurity: sovereignSecurity,
                assertingCaller: msg.sender
            })
        });

        SovereignSecurityInterface.AssertionPolicy memory assertionPolicy = _getAssertionPolicy(assertionId);

        // Check if the assertion is allowed by the sovereign security.
        require(!assertionPolicy.blockAssertion, "Assertion not allowed");

        SsSettings storage ssSettings = assertions[assertionId].ssSettings;
        (ssSettings.arbitrateViaSs, ssSettings.discardOracle, ssSettings.validateDisputers) = (
            assertionPolicy.arbitrateViaSs, // Use SS as an oracle if specified by the SS.
            assertionPolicy.discardOracle, // Discard Oracle result if specified by the SS.
            assertionPolicy.validateDisputers // Validate the disputers if specified by the SS.
        );

        emit AssertionMade(
            assertionId,
            claim,
            asserter,
            callbackRecipient,
            sovereignSecurity,
            msg.sender,
            currency,
            bond,
            assertions[assertionId].expirationTime // TODO [GAS] consider using a memory variable to avoid multiple reads
        );

        return assertionId;
    }

    function getAssertionResult(bytes32 assertionId) public view returns (bool) {
        Assertion memory assertion = assertions[assertionId];
        // Return early if not using answer from resolved dispute.
        if (assertion.disputer != address(0) && assertion.ssSettings.discardOracle) return false;
        require(assertion.settled, "Assertion not settled"); // Revert if assertion not settled.
        return assertion.settlementResolution;
    }

    function settleAndGetAssertionResult(bytes32 assertionId) public returns (bool) {
        if (!assertions[assertionId].settled) settleAssertion(assertionId);
        return getAssertionResult(assertionId);
    }

    function disputeAssertionFor(bytes32 assertionId, address disputer) public {
        disputer = disputer == address(0) ? msg.sender : disputer;
        Assertion storage assertion = assertions[assertionId];
        require(assertion.asserter != address(0), "Assertion does not exist"); // Revert if assertion does not exist.
        require(assertion.disputer == address(0), "Assertion already disputed"); // Revert if assertion already disputed.
        require(assertion.expirationTime > getCurrentTime(), "Assertion is expired"); // Revert if assertion expired.
        require(_isDisputeAllowed(assertionId), "Dispute not allowed"); // Revert if dispute not allowed.

        // Pull the bond
        assertion.currency.safeTransferFrom(msg.sender, address(this), assertion.bond);

        assertion.disputer = disputer;

        _oracleRequestPrice(assertionId, assertion.identifier, assertion.assertionTime);

        // Send dispute callback
        _callbackOnAssertionDispute(assertionId);

        // Send resolve callback if dispute resolution is discarded
        if (assertion.ssSettings.discardOracle) _callbackOnAssertionResolve(assertionId, false);

        emit AssertionDisputed(assertionId, disputer);
    }

    function settleAssertion(bytes32 assertionId) public {
        Assertion storage assertion = assertions[assertionId];
        require(assertion.asserter != address(0), "Assertion does not exist"); // Revert if assertion does not exist.
        require(!assertion.settled, "Assertion already settled"); // Revert if assertion already settled.
        assertion.settled = true;
        if (assertion.disputer == address(0)) {
            // No dispute, settle with the asserter
            require(assertion.expirationTime <= getCurrentTime(), "Assertion not expired"); // Revert if assertion not expired.
            assertion.currency.safeTransfer(assertion.asserter, assertion.bond);
            assertion.settlementResolution = true;
            _callbackOnAssertionResolve(assertionId, true);

            emit AssertionSettled(assertionId, assertion.asserter, false, true);
        } else {
            // Dispute, settle with the disputer
            int256 resolvedPrice = _oracleGetPrice(assertionId, assertion.identifier, assertion.assertionTime); // Revert if price not resolved.

            // If set to not use settlement resolution then the value remains false.
            // If set to use settlement resolution then set to true if resolved price is 1, false otherwise.
            assertion.settlementResolution = assertion.ssSettings.discardOracle ? false : resolvedPrice == 1e18;
            address bondRecipient = resolvedPrice == 1e18 ? assertion.asserter : assertion.disputer;

            // If set to use the DVM as oracle then must burn half the bond amount. Else, if not using the DVM as oracle
            // then the bond is returned to the correct party (asserter or disputer).
            uint256 burn = !assertion.ssSettings.arbitrateViaSs ? (burnedBondPercentage * assertion.bond) / 1e18 : 0;
            uint256 send = assertion.bond * 2 - burn;

            // Send tokens. If the DVM is used as an oracle then burn the burn amount. Send the bond recipient the send amount.
            if (burn > 0) assertion.currency.safeTransfer(address(_getStore()), burn);
            assertion.currency.safeTransfer(bondRecipient, send);

            if (!assertion.ssSettings.discardOracle)
                _callbackOnAssertionResolve(assertionId, assertion.settlementResolution);

            emit AssertionSettled(assertionId, bondRecipient, true, assertion.settlementResolution);
        }
    }

    function syncUmaParams(bytes32 identifier, address currency) public {
        cachedUmaParams.oracle = finder.getImplementationAddress(OracleInterfaces.Oracle);
        cachedUmaParams.supportedIdentifiers[identifier] = _getIdentifierWhitelist().isIdentifierSupported(identifier);
        cachedUmaParams.whitelistedCurrencies[currency].isWhitelisted = _getCollateralWhitelist().isOnWhitelist(
            currency
        );
        cachedUmaParams.whitelistedCurrencies[currency].finalFee = _getStore().computeFinalFee(currency).rawValue;
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
        uint256 finalFee = cachedUmaParams.whitelistedCurrencies[currencyAddress].finalFee;
        return (finalFee * 1e18) / burnedBondPercentage;
    }

    function _getId(
        bytes memory claim,
        uint256 bond,
        uint256 liveness,
        IERC20 currency,
        address callbackRecipient,
        address sovereignSecurity,
        bytes32 identifier
    ) internal pure returns (bytes32) {
        // Returns the unique ID for this assertion. This ID is used to identify the assertion in the Oracle.
        return
            keccak256(
                // TODO change order of abi.encode arguments to do potential gas savings
                abi.encode(claim, bond, liveness, currency, callbackRecipient, sovereignSecurity, identifier)
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
        if (assertions[assertionId].ssSettings.arbitrateViaSs)
            return OracleAncillaryInterface(address(_getSovereignSecurity(assertionId)));
        return OracleAncillaryInterface(cachedUmaParams.oracle);
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

    function _getSovereignSecurity(bytes32 assertionId) internal view returns (SovereignSecurityInterface) {
        return SovereignSecurityInterface(assertions[assertionId].ssSettings.sovereignSecurity);
    }

    function _getAssertionPolicy(bytes32 assertionId)
        internal
        view
        returns (SovereignSecurityInterface.AssertionPolicy memory)
    {
        address ss = assertions[assertionId].ssSettings.sovereignSecurity;
        if (ss == address(0)) return SovereignSecurityInterface.AssertionPolicy(false, false, false, false);
        return SovereignSecurityInterface(ss).getAssertionPolicy(assertionId);
    }

    function _isDisputeAllowed(bytes32 assertionId) internal view returns (bool) {
        address ss = assertions[assertionId].ssSettings.sovereignSecurity;
        if (!assertions[assertionId].ssSettings.validateDisputers) return true;
        return SovereignSecurityInterface(ss).isDisputeAllowed(assertionId, msg.sender);
    }

    function _isIdentifierSupported(bytes32 identifier) internal returns (bool) {
        if (cachedUmaParams.supportedIdentifiers[identifier]) return true;
        cachedUmaParams.supportedIdentifiers[identifier] = _getIdentifierWhitelist().isIdentifierSupported(identifier);
        return cachedUmaParams.supportedIdentifiers[identifier];
    }

    function _isCurrencyWhitelisted(address currency) internal returns (bool) {
        if (cachedUmaParams.whitelistedCurrencies[currency].isWhitelisted) return true;
        cachedUmaParams.whitelistedCurrencies[currency].isWhitelisted = _getCollateralWhitelist().isOnWhitelist(
            currency
        );
        cachedUmaParams.whitelistedCurrencies[currency].finalFee = _getStore().computeFinalFee(currency).rawValue;
        return cachedUmaParams.whitelistedCurrencies[currency].isWhitelisted;
    }

    function _callbackOnAssertionResolve(bytes32 assertionId, bool assertedTruthfully) internal {
        if (assertions[assertionId].callbackRecipient != address(0))
            OptimisticAsserterCallbackRecipientInterface(assertions[assertionId].callbackRecipient).assertionResolved(
                assertionId,
                assertedTruthfully
            );
        if (assertions[assertionId].ssSettings.sovereignSecurity != address(0))
            SovereignSecurityInterface(assertions[assertionId].ssSettings.sovereignSecurity).assertionResolved(
                assertionId,
                assertedTruthfully
            );
    }

    function _callbackOnAssertionDispute(bytes32 assertionId) internal {
        if (assertions[assertionId].callbackRecipient != address(0))
            OptimisticAsserterCallbackRecipientInterface(assertions[assertionId].callbackRecipient).assertionDisputed(
                assertionId
            );
        if (assertions[assertionId].ssSettings.sovereignSecurity != address(0))
            SovereignSecurityInterface(assertions[assertionId].ssSettings.sovereignSecurity).assertionDisputed(
                assertionId
            );
    }
}
