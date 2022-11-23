// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../interfaces/OptimisticAssertorInterface.sol";
import "../../../common/implementation/AncillaryData.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// This Isurance contract enables for the issuance of a single unlimited time policy per event/payout recipient There is
// no limit to the number of payout requests that can be made of the same policy; however, only the first asserted
// request will settle the insurance payment, whereas OA will settle bonds for all requestors.
contract Insurance {
    using SafeERC20 for IERC20;
    IERC20 public immutable defaultCurrency;
    OptimisticAssertorInterface public immutable oa;
    uint256 public constant assertionLiveness = 7200;

    struct Policy {
        uint256 insuranceAmount;
        address payoutAddress;
        bytes insuredEvent;
        bool settled;
    }

    mapping(bytes32 => bytes32) public assertedPolicies;

    mapping(bytes32 => Policy) public policies;

    event InsuranceIssued(
        bytes32 indexed policyId,
        bytes insuredEvent,
        uint256 insuranceAmount,
        address indexed payoutAddress
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
        require(policies[policyId].payoutAddress == address(0), "Policy already exists");
        policies[policyId] = Policy({
            insuranceAmount: insuranceAmount,
            payoutAddress: payoutAddress,
            insuredEvent: insuredEvent,
            settled: false
        });
        defaultCurrency.safeTransferFrom(msg.sender, address(this), insuranceAmount);
        emit InsuranceIssued(policyId, insuredEvent, insuranceAmount, payoutAddress);
    }

    function requestPayout(bytes32 policyId) public returns (bytes32 assertionId) {
        require(policies[policyId].payoutAddress != address(0), "Policy does not exist");
        uint256 bond = oa.getMinimumBond(address(defaultCurrency));
        defaultCurrency.safeTransferFrom(msg.sender, address(this), bond);
        defaultCurrency.safeApprove(address(oa), bond);
        assertionId = oa.assertTruthFor(
            abi.encodePacked(
                "Insurance contract is claiming that insurance event ",
                policies[policyId].insuredEvent,
                " had occurred as of ",
                AncillaryData.toUtf8BytesUint(block.timestamp),
                "."
            ),
            msg.sender,
            address(this),
            address(0), // No sovereign security manager.
            defaultCurrency,
            bond,
            assertionLiveness
        );
        assertedPolicies[assertionId] = policyId;
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
        bytes32 policyId = assertedPolicies[assertionId];
        Policy storage policy = policies[policyId];
        if (policy.settled) return;
        policy.settled = true;
        defaultCurrency.safeTransfer(policy.payoutAddress, policy.insuranceAmount);
        emit InsurancePayoutSettled(policyId, assertionId);
    }
}
