pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;


abstract contract TransactionBatcher {
    function batchSend(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory datas
    ) public virtual payable;
}
