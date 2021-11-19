// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./OptimisticRewarder.sol";

contract OptimisticRewarderToken is ERC721 {
    string public baseUri;
    uint256 public nextTokenId;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _baseUri
    ) ERC721(_name, _symbol) {
        nextTokenId = 0;
        baseUri = _baseUri;
    }

    function mintNextToken(address recipient) public virtual returns (uint256 tokenId) {
        tokenId = tokenId++;
        _safeMint(recipient, tokenId);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseUri;
    }
}
