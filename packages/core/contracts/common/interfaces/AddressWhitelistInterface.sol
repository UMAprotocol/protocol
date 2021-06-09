// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

interface AddressWhitelistInterface {
    function addToWhitelist(address newElement) external;

    function removeFromWhitelist(address newElement) external virtual;

    function isOnWhitelist(address newElement) external view virtual returns (bool);

    function getWhitelist() external view virtual returns (address[] memory);
}
