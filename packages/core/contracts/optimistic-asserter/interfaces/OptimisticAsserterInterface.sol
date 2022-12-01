// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface OptimisticAsserterInterface {
    // TODO: SecurityManager!!!. rename EscalationManagerManager->EscalationManager
    // TODO: Em->EscalationManager...check this is not too long.
    // Options: AssertionManager, EscalationManager, SecurityManager, SovereignManager.
    struct EscalationManagerSettings {
        bool arbitrateViaEscalationManager; // False if the DVM is used as an oracle (EscalationManager on True).
        bool discardOracle; // False if Oracle result is used for resolving assertion after dispute.
        bool validateDisputers; // True if the SS isDisputeAllowed should be checked on disputes.
        address escalationManager;
        address assertingCaller;
    }

    // TODO variable packing to save gas.
    struct Assertion {
        EscalationManagerSettings escalationManagerSettings;
        address asserter; // Address of the asserter.
        address disputer; // Address of the disputer.
        address callbackRecipient; // Address that receives the callback.
        IERC20 currency; // ERC20 token used to pay rewards and fees.
        bytes32 domainId;
        bytes32 identifier;
        uint256 bond;
        bool settled; // True if the request is settled.
        bool settlementResolution;
        uint64 assertionTime; // Time of the assertion. TODO uint64 could be enough.
        uint64 expirationTime;
    }

    struct WhitelistedCurrency {
        bool isWhitelisted;
        uint256 finalFee;
    }

    function defaultIdentifier() external view returns (bytes32);

    function getAssertion(bytes32 assertionId) external view returns (Assertion memory);

    function assertTruthWithDefaults(bytes memory claim) external returns (bytes32);

    function assertTruth(
        bytes memory claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        IERC20 currency,
        uint256 bond,
        uint64 liveness,
        bytes32 identifier,
        bytes32 domainId
    ) external returns (bytes32);

    function getAssertionResult(bytes32 assertionId) external view returns (bool);

    function getMinimumBond(address currencyAddress) external view returns (uint256);

    event AssertionMade(
        bytes32 indexed assertionId,
        bytes32 domainId,
        bytes claim,
        address indexed asserter,
        address callbackRecipient,
        address indexed escalationManager,
        address caller,
        IERC20 currency,
        uint256 bond,
        uint64 expirationTime
    );

    event AssertionDisputed(bytes32 indexed assertionId, address indexed disputer);

    event AssertionSettled(
        bytes32 indexed assertionId,
        address indexed bondRecipient,
        bool disputed,
        bool settlementResolution
    );

    event AdminPropertiesSet(IERC20 defaultCurrency, uint64 defaultLiveness, uint256 burnedBondPercentage);
}
