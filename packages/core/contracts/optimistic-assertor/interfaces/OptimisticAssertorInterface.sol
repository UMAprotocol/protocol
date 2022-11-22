// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface OptimisticAssertorInterface {
    struct SsmSettings {
        bool useDisputeResolution; // TODO: might be moved to SovereignSecurityManager.
        bool useDvmAsOracle; // True if the DVM is used as an oracle (SovereignSecurityManager on False)
        address sovereignSecurityManager;
        address assertingCaller;
    }

    struct Assertion {
        address proposer; // Address of the proposer.
        // TODO: consider naming proposer->asserter.
        address disputer; // Address of the disputer.
        address callbackRecipient; // Address that receives the callback.
        IERC20 currency; // ERC20 token used to pay rewards and fees.
        bool settled; // True if the request is settled.
        bool settlementResolution;
        uint256 bond;
        uint256 assertionTime; // Time of the assertion.
        uint256 expirationTime;
        bytes32 claimId;
        bytes32 identifier;
        SsmSettings ssmSettings;
    }

    function defaultIdentifier() external view returns (bytes32);

    function readAssertion(bytes32 assertionId) external view returns (Assertion memory);

    function assertTruth(bytes memory claim) external returns (bytes32);

    function assertTruthFor(
        bytes memory claim,
        address proposer,
        address callbackRecipient,
        address sovereignSecurityManager,
        IERC20 currency,
        uint256 bond,
        uint256 liveness,
        bytes32 identifier
    ) external returns (bytes32);

    function getAssertion(bytes32 assertionId) external view returns (bool);

    function getMinimumBond(address currencyAddress) external view returns (uint256);

    event AssertionMade(
        bytes32 assertionId,
        bytes claim,
        address indexed proposer,
        address callbackRecipient,
        address indexed sovereignSecurityManager,
        IERC20 currency,
        uint256 bond,
        uint256 expirationTime
    );

    event AssertionDisputed(bytes32 indexed assertionId, address indexed disputer);

    event AssertionSettled(
        bytes32 indexed assertionId,
        address indexed bondRecipient,
        bool disputed,
        bool settlementResolution
    );

    event AssertionDefaultsSet(IERC20 defaultCurrency, uint256 defaultBond, uint256 defaultLiveness);
}
