// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/StoreInterface.sol";
import "../interfaces/FinderInterface.sol";
import "./Constants.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/AddressWhitelist.sol";
import "../interfaces/OracleAncillaryInterface.sol";
import "../../common/implementation/AncillaryData.sol";
import "../interfaces/OptimisticAsserterCallbackRecipientInterface.sol";
import "../interfaces/OptimisticAssertorInterface.sol";

contract OptimisticAssertor is Lockable, OptimisticAssertorInterface {
    using SafeERC20 for IERC20;

    FinderInterface public immutable finder;

    mapping(bytes32 => Assertion) public assertions;

    uint256 burnedBondPercentage = 0.5e18; //50% of bond is burned.

    bytes32 identifier = "ASSERT_TRUTH";

    constructor(address _finderAddress) {
        finder = FinderInterface(_finderAddress);
    }

    function assertTruth(bytes memory claim) public returns (bytes32) {
        // The simplest form of assertion. Bond currency and bond amount default to WETH and WETH final fee.
        // If there is a pending assertion with the same configuration (timestamp, claim and default bond prop) then
        // reverts. Internally calls assertTruth(...) with all the associated props.
        // returns the value that assertTruth(...) returns.
        return assertTruthFor(claim, address(0), address(0), address(0), address(0), 0, 0);
    }

    function assertTruthFor(
        bytes memory claim,
        address proposer,
        address callbackRecipient,
        address sovereignSecurityManager,
        address currency,
        uint256 bondAmount,
        uint256 liveness
    ) public returns (bytes32) {
        bytes32 assertionId =
            _getId(claim, bondAmount, liveness, currency, proposer, callbackRecipient, sovereignSecurityManager);
        require(assertions[assertionId].proposer == address(0)); // Revert if assertion already exists.
        require(_getCollateralWhitelist().isOnWhitelist(address(currency)), "Unsupported currency");
        uint256 finalFee = _getStore().computeFinalFee(address(currency)).rawValue;
        require((bondAmount * burnedBondPercentage) / 1e18 >= finalFee, "Bond amount too low");

        // Pull the bond
        IERC20(currency).safeTransferFrom(msg.sender, address(this), bondAmount);

        assertions[assertionId] = Assertion({
            proposer: proposer == address(0) ? msg.sender : proposer,
            disputer: address(0),
            callbackRecipient: callbackRecipient,
            sovereignSecurityManager: sovereignSecurityManager,
            currency: IERC20(currency),
            respectDvmArbitration: true, // TODO: might be moved to SovereignSecurityManager.
            settled: false,
            bondAmount: bondAmount,
            assertionTime: block.timestamp,
            expirationTime: block.timestamp + liveness
        });

        // emit event

        return assertionId;
    }

    function getAssertion(bytes32 assertionId) public view returns (bool) {
        Assertion memory assertion = assertions[assertionId];
        require(assertion.settled, "Assertion not settled"); // Revert if assertion not settled.
        if (assertion.settled && assertion.disputer == address(0)) return true;
        if (!assertion.respectDvmArbitration) return false;
        int256 dvmResolvedPrice =
            _getOracle().getPrice(identifier, assertion.assertionTime, _stampAssertion(assertionId)); // Revert if price not resolved.
        return dvmResolvedPrice == 1e18;
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
        assertion.currency.safeTransferFrom(msg.sender, address(this), assertion.bondAmount);

        assertion.disputer = disputer;

        _getOracle().requestPrice(identifier, assertion.assertionTime, _stampAssertion(assertionId));

        if (!assertion.respectDvmArbitration) _sendCallback(assertionId, false);

        // emit event
    }

    function settleAssertion(bytes32 assertionId) public {
        Assertion memory assertion = assertions[assertionId];
        require(assertion.proposer != address(0), "Assertion does not exist"); // Revert if assertion does not exist.
        require(!assertion.settled, "Assertion already settled"); // Revert if assertion already settled.
        assertion.settled = true;
        if (assertion.disputer == address(0)) {
            // No dispute, settle with the proposer
            require(assertion.expirationTime <= block.timestamp, "Assertion not expired"); // Revert if assertion not expired.
            assertion.currency.safeTransfer(assertion.proposer, assertion.bondAmount);
            _sendCallback(assertionId, true);
            // emit event
        } else {
            // Dispute, settle with the disputer
            int256 dvmResolvedPrice =
                _getOracle().getPrice(identifier, assertion.assertionTime, _stampAssertion(assertionId)); // Revert if price not resolved.
            bool dvmAssertedTruth = dvmResolvedPrice == 1e18;
            address bondRecipient = dvmAssertedTruth ? assertion.proposer : assertion.disputer;

            uint256 amountToBurn = burnedBondPercentage * assertion.bondAmount;
            uint256 amountToSend = assertion.bondAmount * 2 - amountToBurn; // 50% of the bond is burned. The other 50% is sent to the bond recipient.

            assertion.currency.safeTransfer(bondRecipient, amountToSend);
            assertion.currency.safeTransfer(address(_getStore()), amountToBurn);

            if (assertion.respectDvmArbitration) _sendCallback(assertionId, dvmAssertedTruth);
            // emit event
        }

        // TODO: assertionResolvedCallback
    }

    function _getId(
        bytes memory claim,
        uint256 bondAmount,
        uint256 liveness,
        address currency,
        address proposer,
        address callbackRecipient,
        address sovereignSecurityManager
    ) internal pure returns (bytes32) {
        // Returns the unique ID for this assertion. This ID is used to identify the assertion in the Oracle.
        return
            keccak256(
                abi.encode(claim, bondAmount, liveness, currency, proposer, callbackRecipient, sovereignSecurityManager)
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

    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    function _sendCallback(bytes32 assertionId, bool assertedThruthfully) internal {
        OptimisticAsserterCallbackRecipientInterface(assertions[assertionId].callbackRecipient).assertionResolved(
            assertionId,
            assertedThruthfully
        );
    }
}
