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
    using SafeERC20 for IERC20;

    constructor(
        FinderInterface _finder,
        IERC20 _defaultCurrency,
        uint64 _defaultLiveness
    ) OptimisticAsserter(_finder, _defaultCurrency, _defaultLiveness) {}

    function getAssertionSettlementResolution(bytes32 assertionID) external view returns (bool) {
        return assertions[assertionID].settlementResolution;
    }
}