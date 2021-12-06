// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../common/implementation/MultiCaller.sol";

/**
 * @title Maps rate model objects to L1 token.
 * @dev This contract is designed to be queried by off-chain relayers that need to compute realized LP fee %'s before
 * submitting relay transactions to a BridgePool contract. Therefore, this contract does not perform any validation on
 * the shape of the rate model, which is stored as a string to enable arbitrary data encoding via a stringified JSON
 * object. This leaves this contract unopionated on the parameters within the rate model, enabling governance to adjust
 * the structure in the future.
 */
contract RateModelStore is Ownable, MultiCaller {
    mapping(address => string) public l1TokenRateModels;

    event UpdatedRateModel(address indexed l1Token, string rateModel);

    /**
     * @notice Updates rate model string for L1 token.
     * @param l1Token the l1 token rate model to update.
     * @param rateModel the updated rate model.
     */
    function updateRateModel(address l1Token, string memory rateModel) external onlyOwner {
        l1TokenRateModels[l1Token] = rateModel;
        emit UpdatedRateModel(l1Token, rateModel);
    }
}
