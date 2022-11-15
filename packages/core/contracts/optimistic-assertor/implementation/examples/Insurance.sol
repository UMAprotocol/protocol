// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../interfaces/OptimisticAssertorInterface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Insurance {
    using SafeERC20 for IERC20;
    IERC20 public immutable defaultCurrency;
    OptimisticAssertorInterface public immutable oa;

    struct Policy {
        uint256 insuranceAmount;
        address payoutAddress;
        address insurer;
        bytes insuredEvent;
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
    ) public {
        bytes32 policyId = keccak256(abi.encode(insuredEvent, payoutAddress));
        require(policies[policyId].insurer == address(0), "Policy already exists");
        policies[policyId] = Policy({
            insuranceAmount: insuranceAmount,
            payoutAddress: payoutAddress,
            insurer: msg.sender,
            insuredEvent: insuredEvent
        });
        emit InsuranceIssued(policyId, insuredEvent, insuranceAmount, payoutAddress, msg.sender);
    }

    function requestPayout(bytes32 policyId) public {
        uint256 bond = oa.getMinimumBond(address(defaultCurrency));
        defaultCurrency.safeTransferFrom(msg.sender, address(this), bond);
        bytes32 assertionId =
            oa.assertTruthFor(
                policies[policyId].insuredEvent,
                msg.sender,
                address(this),
                address(0),
                defaultCurrency,
                bond,
                7200
            );
        oaIdentifiers[assertionId] = policyId;
        emit InsurancePayoutRequested(policyId, assertionId);
    }

    function settlePayout(bytes32 assertionId) public {
        require(oa.getAssertion(assertionId));
        bytes32 policyId = oaIdentifiers[assertionId];
        delete oaIdentifiers[assertionId];
        Policy memory policy = policies[policyId];
        delete policies[policyId];
        defaultCurrency.safeTransfer(policy.payoutAddress, policy.insuranceAmount);
        emit InsurancePayoutSettled(policyId, assertionId);
    }

    function assertionResolved(bytes32 assertionId, bool assertedTruthfully) public {
        require(msg.sender == address(oa));
        if (assertedTruthfully) {
            settlePayout(assertionId);
        }
    }

    function assertionDisputed(bytes32 assertionId) public {}
}
