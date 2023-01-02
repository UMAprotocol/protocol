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
    uint256 gatMeetingNumOfTokens = 6e24;
    uint256 requestTime = 420;

    function _commonSetup() public {
        uint256 chainId = block.chainid;
        shouldRunForkedTest = (chainId == 1 || chainId == 5);
        if (!shouldRunForkedTest) return; // Exit early if we are not executing forked tests.

        // TODO: look into a way to not have to hard code these addresses. Ok for now as we wont be changing them.
        address votingAddress = chainId == 1 ? address(0) : 0xF71cdF8A34c56933A8871354A2570a301364e95F;

        voting = VotingV2(votingAddress);

        registeredRequester = chainId == 1
            ? 0xA0Ae6609447e57a42c51B50EAe921D701823FFAe
            : 0xA5B9d8a0B0Fa04Ba71BDD68069661ED5C0848884;

        governor = chainId == 1
            ? 0x592349F7DeDB2b75f9d4F194d4b7C16D82E507Dc
            : 0xFf0E348389400d7D7510a230361Fc00904429e48;

        votingToken = voting.votingToken();
    }

    function moveToNextPhase() public {
        vm.warp(voting.getRoundEndTime(voting.getCurrentRoundId()) - voting.voteTiming());
    }

    function moveToNextRound() public {
        vm.warp(voting.getRoundEndTime(voting.getCurrentRoundId()));
    }
}
