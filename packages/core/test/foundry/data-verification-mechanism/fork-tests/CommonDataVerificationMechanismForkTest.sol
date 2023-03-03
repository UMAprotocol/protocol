// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../fixtures/common/CommonTestBase.sol";

import "../../../../contracts/data-verification-mechanism/implementation/VotingV2.sol";
import "../../../../contracts/data-verification-mechanism/interfaces/VotingAncillaryInterface.sol";
import "../../../../contracts/common/interfaces/ExpandedIERC20.sol";

contract CommonDataVerificationMechanismForkTest is CommonTestBase {
    VotingV2 voting;
    ExpandedIERC20 votingToken;

    bool shouldRunForkedTest;

    address registeredRequester;
    address governor;

    bytes32 identifier = bytes32("YES_OR_NO_QUERY");
    bytes ancillaryData = bytes("Some data");
    uint128 gatMeetingNumOfTokens = 5e25;
    uint256 requestTime = 420;

    function _commonSetup() public {
        uint256 chainId = block.chainid;
        shouldRunForkedTest = (chainId == 1 || chainId == 5);
        if (!shouldRunForkedTest) return; // Exit early if we are not executing forked tests.

        address votingAddress =
            chainId == 1 ? 0x004395edb43EFca9885CEdad51EC9fAf93Bd34ac : 0xBc3683DEf184ad64f6162024BD401e8D49d0E517;

        voting = VotingV2(votingAddress);

        registeredRequester = chainId == 1
            ? 0xA0Ae6609447e57a42c51B50EAe921D701823FFAe
            : 0xA5B9d8a0B0Fa04Ba71BDD68069661ED5C0848884;

        votingToken = voting.votingToken();
    }

    function moveToNextPhase() public {
        vm.warp(voting.getRoundEndTime(voting.getCurrentRoundId()) - voting.voteTiming());
    }

    function moveToNextRound() public {
        vm.warp(voting.getRoundEndTime(voting.getCurrentRoundId()));
    }
}
