// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../tokens/MintableBaseToken.sol";

contract EsEDDX is MintableBaseToken {
    constructor() public MintableBaseToken("Escrowed EDDX", "esEDDX", 0) {
    }

    function id() external pure returns (string memory _name) {
        return "esEDDX";
    }
}
