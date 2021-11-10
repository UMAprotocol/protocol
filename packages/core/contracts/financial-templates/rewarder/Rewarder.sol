// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Rewarder is ERC721 {
    using SafeERC20 for IERC20;

    struct RedemptionAmount {
        uint256 amount;
        IERC20 token;
    }

    string public baseUri;
    uint256 public nextTokenId;
    mapping(bytes32 => uint256) public redemptions;

    event UpdateToken(uint256 indexed tokenId, address indexed caller, bytes data);
    event RedemptionSubmitted(uint256 indexed tokenId, RedemptionAmount[] amounts);

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseUri
    ) ERC721(_name, _symbol) {
        baseUri = _baseUri;
    }

    function depositRewards(uint256 amount, IERC20 token) public {
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function mint(address receiver, bytes memory data) public returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(receiver, tokenId);
        emit UpdateToken(tokenId, msg.sender, data);
    }

    function updateToken(uint256 tokenId, bytes memory data) public {
        emit UpdateToken(tokenId, msg.sender, data);
    }

    function submitRedemption(uint256 tokenId, RedemptionAmount[] memory amounts) public {
        bytes32 redemptionId = _redemptionId(tokenId, amounts);
        require(redemptions[redemptionId] == 0);

        // TODO: collect bond

        // TODO: liveness shouldn't be hardcoded and use getCurrentTime for timestamp.
        redemptions[redemptionId] = block.timestamp + 7200;

        emit RedemptionSubmitted(tokenId, amounts);
    }

    function dispute(uint256 tokenId, RedemptionAmount[] memory amounts) public {
        bytes32 redemptionId = _redemptionId(tokenId, amounts);

        // This automatically checks that redemptions[redemptionId] != 0.
        // Check that it has not passed liveness liveness.
        require(block.timestamp < redemptions[redemptionId]);

        // TODO: Make OO request

        redemptions[redemptionId] = 0;
    }

    function redeem(uint256 tokenId, RedemptionAmount[] memory amounts) public {
        bytes32 redemptionId = _redemptionId(tokenId, amounts);

        // Can only be redeemed by owner.
        require(msg.sender == ownerOf(tokenId));

        // Check that the redemption is initialized and that it passed liveness.
        require(redemptions[redemptionId] != 0 && block.timestamp >= redemptions[redemptionId]);
        _burn(tokenId);

        for (uint256 i = 0; i < amounts.length; i++) {
            amounts[i].token.safeTransfer(msg.sender, amounts[i].amount);
        }
    }

    function _baseURI() internal view override returns (string memory) {
        return baseUri;
    }

    function _redemptionId(uint256 tokenId, RedemptionAmount[] memory amounts) internal pure returns (bytes32) {
        return keccak256(abi.encode(tokenId, amounts));
    }
}
