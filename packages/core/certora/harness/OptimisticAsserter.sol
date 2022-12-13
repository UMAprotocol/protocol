// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../../contracts/optimistic-asserter/implementation/OptimisticAsserter.sol";

/**
 * @title Optimistic Asserter.
 * @notice The OA is used to assert truths about the world which are verified using an optimistic escalation game.
 * @dev Core idea: an asserter makes a statement about a truth, calling "assertTruth". If this statement is not
 * challenged, it is taken as the state of the world. If challenged, it is arbitrated using the UMA DVM, or if
 * configured, an escalation manager. Escalation managers enable integrations to define their own security properties and
 * tradeoffs, enabling the notion of "sovereign security".
 */

contract OptimisticAsserterHarness is OptimisticAsserter {

    constructor(
        FinderInterface _finder,
        IERC20 _defaultCurrency,
        uint64 _defaultLiveness
    ) OptimisticAsserter(_finder, _defaultCurrency, _defaultLiveness) {}

    function tokenBalanceOf(IERC20 token, address account) external view returns (uint256) {
        return token.balanceOf(account);
    }

    function getOracleFeeByAssertion(bytes32 assertionID) external view returns (uint256) {
        return (assertions[assertionID].bond * burnedBondPercentage)/1e18;
    }

    function getId(
        bytes memory claim,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier) external view returns (bytes32) {
            return _getId(claim, bond, uint64(getCurrentTime()), liveness,
            currency, callbackRecipient, escalationManager, identifier);
    }

    function getAssertionSettlementResolution(bytes32 assertionID) external view returns (bool) {
        return assertions[assertionID].settlementResolution;
    }

    function getAssertionSettled(bytes32 assertionID) external view returns (bool) {
        return assertions[assertionID].settled;
    }

    function getAssertionBond(bytes32 assertionID) external view returns (uint256) {
        return assertions[assertionID].bond;
    }

    function getAssertionCurrency(bytes32 assertionID) external view returns (IERC20) {
        return assertions[assertionID].currency;
    }

    function getAssertionExpirationTime(bytes32 assertionID) external view returns (uint64) {
        return assertions[assertionID].expirationTime;
    }

    function getAssertionAsserter(bytes32 assertionID) external view returns (address) {
        return assertions[assertionID].asserter;
    }

    function getAssertionDisputer(bytes32 assertionID) external view returns (address) {
        return assertions[assertionID].disputer;
    }
}