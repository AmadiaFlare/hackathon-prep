// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {RandomNumberV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/RandomNumberV2Interface.sol";

/**
 * @title GenerativeNFT
 * @dev An ERC721 contract that mints NFTs with on-chain generative art.
 * The art's properties are determined by a secure random number from the Flare Network.
 */
contract GenerativeNFT is ERC721, Ownable {
    using Strings for uint256;
    using Strings for uint8;

    RandomNumberV2Interface private _generator;
    uint256 private _nextTokenId;

    // Struct to hold the visual properties of an NFT
    struct NFTTraits {
        uint8 hue;
        uint8 saturation;
        uint8 lightness;
        uint8 circleSize; // e.g., radius
    }

    // Mapping from token ID to its traits
    mapping(uint256 => NFTTraits) public traits;

    /**
     * @dev Sets up the contract, initializing the ERC721 token and the random number generator.
     */
    constructor() ERC721("Generative NFT", "gNFT") Ownable(msg.sender) {
        _generator = ContractRegistry.getRandomNumberV2();
    }

    /**
     * @dev Mints a new NFT to the specified address.
     * The NFT's traits are generated using a random number.
     */
    function safeMint(address to) public {
        (uint256 randomNumber, , ) = _generator.getRandomNumber();

        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        // Use the random number to generate traits for the SVG art
        traits[tokenId] = NFTTraits({
            hue: uint8(randomNumber % 360), // Full color spectrum
            saturation: uint8((randomNumber >> 8) % 51) + 50, // 50-100% saturation
            lightness: uint8((randomNumber >> 16) % 41) + 30, // 30-70% lightness
            circleSize: uint8((randomNumber >> 24) % 41) + 10 // 10-50 radius
        });
    }

    /**
     * @dev Returns the Uniform Resource Identifier (URI) for a token.
     * The URI contains base64 encoded JSON metadata, including a base64 encoded SVG image.
     */
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        // The ownerOf function will revert if the token does not exist, which is
        // the behavior we want.
        ownerOf(tokenId);

        NFTTraits memory currentTraits = traits[tokenId];

        string memory svg = _generateSVG(currentTraits);
        string memory json = Base64.encode(
            bytes(
                string.concat(
                    '{"name": "Generative NFT #',
                    tokenId.toString(),
                    '",',
                    '"description": "An on-chain generative NFT using Flare Time Series Oracle for randomness.",',
                    '"image": "data:image/svg+xml;base64,',
                    Base64.encode(bytes(svg)),
                    '",',
                    '"attributes": [',
                    '{"trait_type": "Hue", "value": "',
                    currentTraits.hue.toString(),
                    '"},',
                    '{"trait_type": "Saturation", "value": "',
                    currentTraits.saturation.toString(),
                    '"},',
                    '{"trait_type": "Lightness", "value": "',
                    currentTraits.lightness.toString(),
                    '"},',
                    '{"trait_type": "Circle Size", "value": "',
                    currentTraits.circleSize.toString(),
                    '"}]',
                    '}'
                )
            )
        );

        return string.concat("data:application/json;base64,", json);
    }

    /**
     * @dev Generates an SVG image string based on the NFT's traits.
     */
    function _generateSVG(
        NFTTraits memory currentTraits
    ) private pure returns (string memory) {
        string memory color = string.concat(
            "hsl(",
            currentTraits.hue.toString(),
            ", ",
            currentTraits.saturation.toString(),
            "%, ",
            currentTraits.lightness.toString(),
            "%)"
        );

        return
            string.concat(
                '<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">',
                '<rect width="100%" height="100%" fill="#222" />',
                '<circle cx="100" cy="100" r="',
                currentTraits.circleSize.toString(),
                '" fill="',
                color,
                '" />',
                '</svg>'
            );
    }
}
