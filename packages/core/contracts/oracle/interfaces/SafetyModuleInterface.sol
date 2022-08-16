// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../implementation/VotingToken.sol";
import "../../common/interfaces/ExpandedIERC20.sol";

interface SafetyModuleInterface {
    function isProposalRatified(uint256 id) external returns (bool);

    function isVoterActivelySignaledOnEmergencyAction(address account) external returns (bool);
}
