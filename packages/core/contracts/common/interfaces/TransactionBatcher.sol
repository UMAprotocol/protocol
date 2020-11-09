pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;


// This is an interface to interact with a deployed implementation by https://github.com/kleros/action-callback-bots for
// batching on-chain transactions.
// See deployed implementation here: https://etherscan.io/address/0x82458d1c812d7c930bb3229c9e159cbabd9aa8cb.
abstract contract TransactionBatcher {
    function batchSend(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory datas
    ) public virtual payable;
}
