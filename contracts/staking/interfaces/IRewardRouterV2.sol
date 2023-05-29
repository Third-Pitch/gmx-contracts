// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IRewardRouterV2 {
    function feeElpTracker() external view returns (address);
    function stakedElpTracker() external view returns (address);
}
