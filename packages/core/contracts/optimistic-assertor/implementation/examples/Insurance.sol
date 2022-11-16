// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../interfaces/OptimisticAssertorInterface.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Insurance {
    using SafeERC20 for IERC20;
    IERC20 public immutable defaultCurrency;
    OptimisticAssertorInterface public immutable oa;
    uint256 public constant assertionLiveness = 7200;

    struct Policy {
        uint256 insuranceAmount;
        address payoutAddress;
        address insurer;
        bytes insuredEvent;
        bool settled;
    }

    mapping(bytes32 => bytes32) public oaIdentifiers;

    mapping(bytes32 => Policy) public policies;

    event InsuranceIssued(
        bytes32 indexed policyId,
        bytes insuredEvent,
        uint256 insuranceAmount,
        address indexed payoutAddress,
        address indexed insurer
    );

    event InsurancePayoutRequested(bytes32 indexed policyId, bytes32 indexed assertionId);

    event InsurancePayoutSettled(bytes32 indexed policyId, bytes32 indexed assertionId);

    constructor(address _defaultCurrency, address _optimisticAssertor) {
        defaultCurrency = IERC20(_defaultCurrency);
        oa = OptimisticAssertorInterface(_optimisticAssertor);
    }

    function issueInsurance(
        uint256 insuranceAmount,
        address payoutAddress,
        bytes memory insuredEvent
    ) public returns (bytes32 policyId) {
        policyId = keccak256(abi.encode(insuredEvent, payoutAddress));
        require(policies[policyId].insurer == address(0), "Policy already exists");
        policies[policyId] = Policy({
            insuranceAmount: insuranceAmount,
            payoutAddress: payoutAddress,
            insurer: msg.sender,
            insuredEvent: insuredEvent,
            settled: false
        });
        defaultCurrency.safeTransferFrom(msg.sender, address(this), insuranceAmount);
        emit InsuranceIssued(policyId, insuredEvent, insuranceAmount, payoutAddress, msg.sender);
    }

    function requestPayout(bytes32 policyId) public returns (bytes32 assertionId) {
        uint256 bond = oa.getMinimumBond(address(defaultCurrency));
        defaultCurrency.safeTransferFrom(msg.sender, address(this), bond);
        defaultCurrency.safeApprove(address(oa), bond);
        assertionId = oa.assertTruthFor(
            policies[policyId].insuredEvent,
            msg.sender,
            address(this),
            address(0), // No sovereign security manager.
            defaultCurrency,
            bond,
            assertionLiveness
        );
        oaIdentifiers[assertionId] = policyId;
        emit InsurancePayoutRequested(policyId, assertionId);
    }

    function assertionResolved(bytes32 assertionId, bool assertedTruthfully) public {
        require(msg.sender == address(oa));
        // If the assertion was true, then the policy is settled.
        if (assertedTruthfully) {
            _settlePayout(assertionId);
        }
    }

    function assertionDisputed(bytes32 assertionId) public {}

    function _settlePayout(bytes32 assertionId) internal {
        // If already settled, do nothing. We don't revert because this function is called by the
        // OptimisticAssertor, which may block the assertion resolution.
        bytes32 policyId = oaIdentifiers[assertionId];
        Policy storage policy = policies[policyId];
        if (policy.settled) return;
        policy.settled = true;
        defaultCurrency.safeTransfer(policy.payoutAddress, policy.insuranceAmount);
        emit InsurancePayoutSettled(policyId, assertionId);
    }
}
