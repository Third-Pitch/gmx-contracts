// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

import "../core/interfaces/IElpManager.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IRewardTracker.sol";

import "../access/Governable.sol";

// provide a way to migrate staked ELP tokens by unstaking from the sender
// and staking for the receiver
// meant for a one-time use for a specified sender
// requires the contract to be added as a handler for stakedElpTracker and feeElpTracker
contract StakedElpMigrator is Governable {
    using SafeMath for uint256;

    address public sender;
    address public elp;
    address public stakedElpTracker;
    address public feeElpTracker;
    bool public isEnabled = true;

    constructor(
        address _sender,
        address _elp,
        address _stakedElpTracker,
        address _feeElpTracker
    ) public {
        sender = _sender;
        elp = _elp;
        stakedElpTracker = _stakedElpTracker;
        feeElpTracker = _feeElpTracker;
    }

    function disable() external onlyGov {
        isEnabled = false;
    }

    function transfer(address _recipient, uint256 _amount) external onlyGov {
        _transfer(sender, _recipient, _amount);
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) private {
        require(isEnabled, "StakedElpMigrator: not enabled");
        require(_sender != address(0), "StakedElpMigrator: transfer from the zero address");
        require(_recipient != address(0), "StakedElpMigrator: transfer to the zero address");

        IRewardTracker(stakedElpTracker).unstakeForAccount(_sender, feeElpTracker, _amount, _sender);
        IRewardTracker(feeElpTracker).unstakeForAccount(_sender, elp, _amount, _sender);

        IRewardTracker(feeElpTracker).stakeForAccount(_sender, _recipient, elp, _amount);
        IRewardTracker(stakedElpTracker).stakeForAccount(_recipient, _recipient, feeElpTracker, _amount);
    }
}
