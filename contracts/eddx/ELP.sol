// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../tokens/MintableBaseToken.sol";

contract ELP is MintableBaseToken {
    constructor() public MintableBaseToken("EDDX LP", "ELP", 0) {
    }

    function id() external pure returns (string memory _name) {
        return "ELP";
    }
}