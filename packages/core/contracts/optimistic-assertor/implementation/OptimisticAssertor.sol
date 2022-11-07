// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../../oracle/interfaces/StoreInterface.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/Constants.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/AddressWhitelist.sol";
import "../../oracle/interfaces/OracleAncillaryInterface.sol";
import "../../common/implementation/AncillaryData.sol";
import "../interfaces/OptimisticAsserterCallbackRecipientInterface.sol";
import "../interfaces/OptimisticAssertorInterface.sol";
import "../interfaces/SovereignSecurityManagerInterface.sol";

contract OptimisticAssertor is Lockable, OptimisticAssertorInterface, Ownable {
    using SafeERC20 for IERC20;

    FinderInterface public immutable finder;

    mapping(bytes32 => Assertion) public assertions;

    uint256 burnedBondPercentage = 0.5e18; //50% of bond is burned.

    bytes32 identifier = "ASSERT_TRUTH";

    IERC20 public defaultCurrency;
    uint256 public defaultBond;
    uint256 public defaultLiveness;

    event AssertionMade(
        bytes32 assertionId,
        bytes claim,
        address indexed proposer,
        address indexed callbackRecipient,
        address indexed sovereignSecurityManager,
        IERC20 currency,
        uint256 bond,
        uint256 liveness
    );

    event AssertionDisputed(bytes32 indexed assertionId, address indexed disputer);

    event AssertionSettled(
        bytes32 indexed assertionId,
        address indexed bondRecipient,
        bool disputed,
        bool settlementResolution
    );

    event AssertionDefaultsSet(IERC20 defaultCurrency, uint256 defaultBond, uint256 defaultLiveness);

    constructor(
        FinderInterface _finder,
        IERC20 _defaultCurrency,
        uint256 _defaultBond,
        uint256 _defaultLiveness
    ) {
        finder = _finder;
        setAssertionDefaults(_defaultCurrency, _defaultBond, _defaultLiveness);
    }

    function setAssertionDefaults(
        IERC20 _defaultCurrency,
        uint256 _defaultBond,
        uint256 _defaultLiveness
    ) public onlyOwner {
        defaultCurrency = _defaultCurrency;
        defaultBond = _defaultBond;
        defaultLiveness = _defaultLiveness;

        emit AssertionDefaultsSet(_defaultCurrency, _defaultBond, _defaultLiveness);
    }

    function assertTruth(bytes memory claim) public returns (bytes32) {
        // The simplest form of assertion. Bond currency and bond amount default to WETH and WETH final fee.
        // If there is a pending assertion with the same configuration (timestamp, claim and default bond prop) then
        // reverts. Internally calls assertTruth(...) with all the associated props.
        // returns the value that assertTruth(...) returns.
        return assertTruthFor(claim, address(0), address(0), address(0), defaultCurrency, defaultBond, defaultLiveness);
    }

    function assertTruthFor(
        bytes memory claim,
        address proposer,
        address callbackRecipient,
        address sovereignSecurityManager,
        IERC20 currency,
        uint256 bond,
        uint256 liveness
    ) public returns (bytes32) {
        bytes32 assertionId =
            _getId(claim, bond, liveness, currency, proposer, callbackRecipient, sovereignSecurityManager);

        require(assertions[assertionId].proposer == address(0)); // Revert if assertion already exists.
        require(_getCollateralWhitelist().isOnWhitelist(address(currency)), "Unsupported currency");
        uint256 finalFee = _getStore().computeFinalFee(address(currency)).rawValue;
        require((bond * burnedBondPercentage) / 1e18 >= finalFee, "Bond amount too low");

        // Pull the bond
        currency.safeTransferFrom(msg.sender, address(this), bond);

        assertions[assertionId] = Assertion({
            proposer: proposer == address(0) ? msg.sender : proposer,
            msgSender: msg.sender,
            disputer: address(0),
            callbackRecipient: callbackRecipient,
            sovereignSecurityManager: sovereignSecurityManager,
            currency: currency,
            respectDvmOnArbitration: true, // this is the default behavior: if not specified by the Sovereign security manager the assertion will respect the DVM result.
            dvmAsOracle: true, // this is the default behavior: if not specified by the Sovereign security manager the assertion will use the DVM as an oracle.
            settled: false,
            settlementResolution: false,
            bond: bond,
            assertionTime: block.timestamp,
            expirationTime: block.timestamp + liveness
        });

        // Check if the Sovereign Security Manager is configured to arbitrate via DVM. Note that this call will revert
        // if the Sovereign Security Manager is configured to not allow this assertion, such as if the manager has a
        // configured whitelist and the asserter is not on it.
        assertions[assertionId].respectDvmOnArbitration = _checkIfShouldRespectDvmOnArbitrate(assertionId);

        // Check if the Sovereign Security Manager is configured to use the DVM as an oracle.
        // TODO: As we are checking this only at assertion time, we can refactor to get all Sovereign Security Manager
        // settings in one call.
        assertions[assertionId].dvmAsOracle = _checkIfShouldArbitrateViaDvm(assertionId);

        emit AssertionMade(
            assertionId,
            claim,
            proposer,
            callbackRecipient,
            sovereignSecurityManager,
            currency,
            bond,
            liveness
        );

        return assertionId;
    }

    function getAssertion(bytes32 assertionId) public view returns (bool) {
        Assertion memory assertion = assertions[assertionId];
        require(assertion.settled, "Assertion not settled"); // Revert if assertion not settled.
        return assertion.settlementResolution;
    }

    function settleAndGetAssertion(bytes32 assertionId) public returns (bool) {
        settleAssertion(assertionId);
        return getAssertion(assertionId);
    }

    function disputeAssertionFor(bytes32 assertionId, address disputer) public {
        Assertion memory assertion = assertions[assertionId];
        require(assertion.proposer != address(0), "Assertion does not exist"); // Revert if assertion does not exist.
        require(assertion.disputer == address(0), "Assertion already disputed"); // Revert if assertion already disputed.
        require(assertion.expirationTime > block.timestamp, "Assertion is expired"); // Revert if assertion expired.

        // Pull the bond
        assertion.currency.safeTransferFrom(msg.sender, address(this), assertion.bond);

        assertion.disputer = disputer;

        _getOracle(assertionId).requestPrice(identifier, assertion.assertionTime, _stampAssertion(assertionId));

        if (!assertion.respectDvmOnArbitration) _sendCallback(assertionId, false);

        emit AssertionDisputed(assertionId, disputer);
    }

    function settleAssertion(bytes32 assertionId) public {
        Assertion memory assertion = assertions[assertionId];
        require(assertion.proposer != address(0), "Assertion does not exist"); // Revert if assertion does not exist.
        require(!assertion.settled, "Assertion already settled"); // Revert if assertion already settled.
        assertion.settled = true;
        if (assertion.disputer == address(0)) {
            // No dispute, settle with the proposer
            require(assertion.expirationTime <= block.timestamp, "Assertion not expired"); // Revert if assertion not expired.
            assertion.currency.safeTransfer(assertion.proposer, assertion.bond);
            assertion.settlementResolution = true;
            _sendCallback(assertionId, true);

            emit AssertionSettled(assertionId, assertion.proposer, false, true);
        } else {
            // Dispute, settle with the disputer
            int256 dvmResolvedPrice =
                _getOracle(assertionId).getPrice(identifier, assertion.assertionTime, _stampAssertion(assertionId)); // Revert if price not resolved.

            assertion.settlementResolution = dvmResolvedPrice == 1e18;
            // todo: if (assertion.respectDvmOnArbitration)
            address bondRecipient = assertion.settlementResolution ? assertion.proposer : assertion.disputer;

            // todo: should you only play the final fee in the case of a DVM arbitrated dispute?
            uint256 amountToBurn = burnedBondPercentage * assertion.bond;
            uint256 amountToSend = assertion.bond * 2 - amountToBurn; // 50% of the bond is burned. The other 50% is sent to the bond recipient.

            assertion.currency.safeTransfer(bondRecipient, amountToSend);
            assertion.currency.safeTransfer(address(_getStore()), amountToBurn);

            if (assertion.respectDvmOnArbitration) _sendCallback(assertionId, assertion.settlementResolution);

            emit AssertionSettled(assertionId, bondRecipient, true, assertion.settlementResolution);
        }
    }

    function _getId(
        bytes memory claim,
        uint256 bond,
        uint256 liveness,
        IERC20 currency,
        address proposer,
        address callbackRecipient,
        address sovereignSecurityManager
    ) internal pure returns (bytes32) {
        // Returns the unique ID for this assertion. This ID is used to identify the assertion in the Oracle.
        return
            keccak256(
                abi.encode(claim, bond, liveness, currency, proposer, callbackRecipient, sovereignSecurityManager)
            );
    }

    function _stampAssertion(bytes32 assertionId) internal view returns (bytes memory) {
        // Returns the unique ID for this assertion. This ID is used to identify the assertion in the Oracle.
        return
            AncillaryData.appendKeyValueAddress(
                AncillaryData.appendKeyValueBytes32("", "assertionId", assertionId),
                "aoRequester",
                address(this)
            );
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelist) {
        return AddressWhitelist(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _getOracle(bytes32 assertionId) internal view returns (OracleAncillaryInterface) {
        if (assertions[assertionId].dvmAsOracle)
            return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
        return OracleAncillaryInterface(address(_getSovereignSecurityManager(assertionId)));
    }

    function _getSovereignSecurityManager(bytes32 assertionId)
        internal
        view
        returns (SovereignSecurityManagerInterface)
    {
        return SovereignSecurityManagerInterface(assertions[assertionId].sovereignSecurityManager);
    }

    function _sendCallback(bytes32 assertionId, bool assertedTruthfully) internal {
        if (assertions[assertionId].callbackRecipient != address(0))
            OptimisticAsserterCallbackRecipientInterface(assertions[assertionId].callbackRecipient).assertionResolved(
                assertionId,
                assertedTruthfully
            );
    }

    function _checkIfShouldRespectDvmOnArbitrate(bytes32 assertionId) internal returns (bool) {
        // True is now the default behavior: if the SSM is not configured, then the assertion will respect the DVM.
        if (assertions[assertionId].sovereignSecurityManager == address(0)) return true;
        return _getSovereignSecurityManager(assertionId).shouldAllowAssertionAndRespectDvmOnArbitrate(assertionId);
    }

    function _checkIfShouldArbitrateViaDvm(bytes32 assertionId) internal view returns (bool) {
        if (assertions[assertionId].sovereignSecurityManager == address(0)) return true;
        return _getSovereignSecurityManager(assertionId).shouldArbitrateViaDvm(assertionId);
    }
}
