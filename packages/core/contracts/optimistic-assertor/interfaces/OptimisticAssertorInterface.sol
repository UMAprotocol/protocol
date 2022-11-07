// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface OptimisticAssertorInterface {
    struct Assertion {
        address proposer; // Address of the proposer.
        // TODO: consider naming proposer->asserter.
        address disputer; // Address of the disputer.
        address msgSender; // Address that called into the OA contract.
        address callbackRecipient; // Address that receives the callback.
        address sovereignSecurityManager;
        IERC20 currency; // ERC20 token used to pay rewards and fees.
        bool respectDvmOnArbitration; // TODO: might be moved to SovereignSecurityManager.
        bool settled; // True if the request is settled.
        bool settlementResolution;
        uint256 bond;
        uint256 assertionTime; // Time of the assertion.
        uint256 expirationTime;
    }
}
