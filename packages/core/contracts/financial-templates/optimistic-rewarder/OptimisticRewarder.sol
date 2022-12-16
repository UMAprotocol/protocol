// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "./OptimisticRewarderBase.sol";
import "./OptimisticRewarderToken.sol";

/**
 * @notice The common optimistic rewarder contract. It is both the contract that pays out the rewards and the ERC721
 * token itself.
 */
contract OptimisticRewarder is OptimisticRewarderBase, OptimisticRewarderToken {
    /**
     * @notice Constructor.
     * @param _name name for the ERC721 token.
     * @param _symbol symbol for the ERC721 token.
     * @param _baseUri prefix to each ERC721 tokenId's name.
     * @param _liveness liveness period between submission and verification of a reward.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _bond size of the bond.
     * @param _identifier identifier that should be passed to the optimistic oracle on dispute.
     * @param _customAncillaryData custom ancillary data that should be sent to the optimistic oracle on dispute.
     * @param _finder finder to look up UMA contract addresses.
     */
    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseUri,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        bytes memory _customAncillaryData,
        FinderInterface _finder
    )
        OptimisticRewarderBase(_liveness, _bondToken, _bond, _identifier, _customAncillaryData, _finder)
        OptimisticRewarderToken(_name, _symbol, _baseUri)
    {}

    /**
     * @notice Used to mint the next ERC721 tokenId.
     * @param recipient the recipient of the newly minted token.
     */
    function mintNextToken(address recipient)
        public
        virtual
        override(OptimisticRewarderBase, OptimisticRewarderToken)
        returns (uint256)
    {
        return OptimisticRewarderToken.mintNextToken(recipient);
    }

    /**
     * @notice Used to check the owner of the token.
     * @dev this override is a formality required by solidity. It forwards the call to the internal ERC721
     * immplentation.
     * @param tokenId the tokenId to check the owner of.
     */
    function ownerOf(uint256 tokenId) public view virtual override(OptimisticRewarderBase, ERC721) returns (address) {
        return ERC721.ownerOf(tokenId);
    }
}

/**
 * @notice The optimistic rewarder that does not contain the ERC721 token. It allows the user to pass in an external
 * ERC721 token.
 * @dev this setup allows for graceful migrations to new rewarder contracts. It also allows external ERC721 tokens,
 * like uniswap v3 positions to be rewarded.
 */
contract OptimisticRewarderNoToken is OptimisticRewarderBase {
    OptimisticRewarderToken public token;

    /**
     * @notice Constructor.
     * @param _token external ERC721 token for the rewarder to base redemptions on. Note: this token doesn't
     * necessarily need to implement the mintNextToken method. See mintNextToken below for details.
     * @param _liveness liveness period between submission and verification of a reward.
     * @param _bondToken ERC20 token that the bond is paid in.
     * @param _bond size of the bond.
     * @param _identifier identifier that should be passed to the optimistic oracle on dispute.
     * @param _customAncillaryData custom ancillary data that should be sent to the optimistic oracle on dispute.
     * @param _finder finder to look up UMA contract addresses.
     */
    constructor(
        OptimisticRewarderToken _token,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        bytes memory _customAncillaryData,
        FinderInterface _finder
    ) OptimisticRewarderBase(_liveness, _bondToken, _bond, _identifier, _customAncillaryData, _finder) {
        token = _token;
    }

    /**
     * @notice Used to mint the next ERC721 tokenId.
     * @dev even if token contract does not support the `mintNextToken` function, this contract can still function
     * correctly assuming there is some other way to mint the ERC721 tokens. An issue in this method will only
     * affect the mint token in the base contract. Other methods will work fine.
     * @param recipient the recipient of the newly minted token.
     */
    function mintNextToken(address recipient) public virtual override returns (uint256) {
        return token.mintNextToken(recipient);
    }

    /**
     * @notice Used to check the owner of the token.
     * @dev this override forwards the call to the external token contract.
     * @param tokenId the tokenId to check the owner of.
     */
    function ownerOf(uint256 tokenId) public view virtual override returns (address) {
        return token.ownerOf(tokenId);
    }
}
