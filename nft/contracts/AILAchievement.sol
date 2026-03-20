// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AILAchievement is ERC721, ERC721Burnable, Ownable {
    uint256 private _nextTokenId;
    address public minter;

    struct Badge {
        string ailId;
        uint256 ailTokenId;
        string badgeId;
        string source;
        uint256 earnedAt;
        string metadataURI;
    }

    mapping(uint256 => Badge) public badges;
    mapping(bytes32 => bool) public badgeMinted;

    event MinterChanged(address indexed previousMinter, address indexed newMinter);

    modifier onlyMinter() {
        require(msg.sender == minter, "AILAchievement: caller is not the minter");
        _;
    }

    constructor(address initialMinter)
        ERC721("AIL Achievement", "AILA")
        Ownable(msg.sender)
    {
        require(initialMinter != address(0), "AILAchievement: zero minter address");
        minter = initialMinter;
    }

    function setMinter(address newMinter) external onlyOwner {
        require(newMinter != address(0), "AILAchievement: zero minter address");
        emit MinterChanged(minter, newMinter);
        minter = newMinter;
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        require(from == address(0) || to == address(0), "Soulbound: transfer not allowed");
        return super._update(to, tokenId, auth);
    }

    function mintBadge(
        address to,
        string calldata ailId,
        uint256 ailTokenId,
        string calldata badgeId,
        string calldata source,
        string calldata metadataURI
    ) external onlyMinter returns (uint256 tokenId) {
        require(to != address(0), "AILAchievement: mint to zero address");
        require(bytes(ailId).length > 0, "AILAchievement: empty AIL ID");
        require(bytes(badgeId).length > 0, "AILAchievement: empty badge ID");

        bytes32 key = keccak256(abi.encodePacked(ailId, badgeId));
        require(!badgeMinted[key], "Badge already minted");

        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);

        Badge storage badge = badges[tokenId];
        badge.ailId = ailId;
        badge.ailTokenId = ailTokenId;
        badge.badgeId = badgeId;
        badge.source = source;
        badge.earnedAt = block.timestamp;
        badge.metadataURI = metadataURI;
        badgeMinted[key] = true;
    }

    function burn(uint256 tokenId) public override onlyMinter {
        require(_ownerOf(tokenId) != address(0), "AILAchievement: token does not exist");
        bytes32 key = keccak256(abi.encodePacked(badges[tokenId].ailId, badges[tokenId].badgeId));
        if (bytes(badges[tokenId].badgeId).length > 0) {
            delete badgeMinted[key];
            delete badges[tokenId];
        }
        _update(address(0), tokenId, address(0));
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }
}
