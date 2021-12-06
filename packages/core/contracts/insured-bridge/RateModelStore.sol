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
    struct RateModel {
        uint256 startBlock; // When the new rate model becomes active.
        string oldRateModel; // Store old rate model so that public getter method does not need to modify state to
        // return correct rate model based on current block
        string newRateModel; // New rate model that becomes active when current block >= start block.
    }
    mapping(address => RateModel) public l1TokenRateModels;

    event UpdatedRateModel(address indexed l1Token, string oldRateModel, string newRateModel, uint256 startBlock);

    /**
     * @notice Updates rate model string for L1 token.
     * @param l1Token the l1 token rate model to update.
     * @param rateModel the updated rate model.
     * @param startBlock determines when `rateModel` officially becomes active.
     */
    function updateRateModel(
        address l1Token,
        string memory rateModel,
        uint256 startBlock
    ) external onlyOwner {
        // If current block >= existing rate model's start block, then the new "old" rate model is the existing
        // "new" rate model. Otherwise, the existing rate model has not updated to the "new" rate model yet and the new
        // "old" rate model gets carried over.
        // Note: If current block >= existing rate model's start block, then the new rate model will immediately take
        // effect. This is a potentially useful feature for the admin who has the responsibility for determining when
        // the rate model should update.
        string memory oldRateModel =
            (block.number >= l1TokenRateModels[l1Token].startBlock)
                ? l1TokenRateModels[l1Token].newRateModel
                : l1TokenRateModels[l1Token].oldRateModel;
        l1TokenRateModels[l1Token] = RateModel({
            startBlock: startBlock,
            oldRateModel: oldRateModel,
            newRateModel: rateModel
        });
        emit UpdatedRateModel(l1Token, oldRateModel, rateModel, startBlock);
    }

    /**
     * @notice Designed to be called by off-chain clien to get latest rate model for L1 token.
     * @param l1Token the l1 token rate model to fetch rate model for.
     * @return rateModel the latest rate model.
     */
    function getRateModel(address l1Token) external view returns (string memory) {
        if (block.number >= l1TokenRateModels[l1Token].startBlock) {
            return l1TokenRateModels[l1Token].newRateModel;
        } else {
            return l1TokenRateModels[l1Token].oldRateModel;
        }
    }
}
