// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

import "../core/interfaces/IElpManager.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IRewardTracker.sol";

// provide a way to transfer staked ELP tokens by unstaking from the sender
// and staking for the receiver
// tests in RewardRouterV2.js
contract StakedElp {
    using SafeMath for uint256;

    string public constant name = "StakedElp";
    string public constant symbol = "sELP";
    uint8 public constant decimals = 18;

    address public elp;
    IElpManager public elpManager;
    address public stakedElpTracker;
    address public feeElpTracker;

    mapping (address => mapping (address => uint256)) public allowances;

    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        address _elp,
        IElpManager _elpManager,
        address _stakedElpTracker,
        address _feeElpTracker
    ) public {
        elp = _elp;
        elpManager = _elpManager;
        stakedElpTracker = _stakedElpTracker;
        feeElpTracker = _feeElpTracker;
    }

    function allowance(address _owner, address _spender) external view returns (uint256) {
        return allowances[_owner][_spender];
    }

    function approve(address _spender, uint256 _amount) external returns (bool) {
        _approve(msg.sender, _spender, _amount);
        return true;
    }

    function transfer(address _recipient, uint256 _amount) external returns (bool) {
        _transfer(msg.sender, _recipient, _amount);
        return true;
    }

    function transferFrom(address _sender, address _recipient, uint256 _amount) external returns (bool) {
        uint256 nextAllowance = allowances[_sender][msg.sender].sub(_amount, "StakedElp: transfer amount exceeds allowance");
        _approve(_sender, msg.sender, nextAllowance);
        _transfer(_sender, _recipient, _amount);
        return true;
    }

    function balanceOf(address _account) external view returns (uint256) {
        return IRewardTracker(feeElpTracker).depositBalances(_account, elp);
    }

    function totalSupply() external view returns (uint256) {
        return IERC20(stakedElpTracker).totalSupply();
    }

    function _approve(address _owner, address _spender, uint256 _amount) private {
        require(_owner != address(0), "StakedElp: approve from the zero address");
        require(_spender != address(0), "StakedElp: approve to the zero address");

        allowances[_owner][_spender] = _amount;

        emit Approval(_owner, _spender, _amount);
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) private {
        require(_sender != address(0), "StakedElp: transfer from the zero address");
        require(_recipient != address(0), "StakedElp: transfer to the zero address");

        require(
            elpManager.lastAddedAt(_sender).add(elpManager.cooldownDuration()) <= block.timestamp,
            "StakedElp: cooldown duration not yet passed"
        );

        IRewardTracker(stakedElpTracker).unstakeForAccount(_sender, feeElpTracker, _amount, _sender);
        IRewardTracker(feeElpTracker).unstakeForAccount(_sender, elp, _amount, _sender);

        IRewardTracker(feeElpTracker).stakeForAccount(_sender, _recipient, elp, _amount);
        IRewardTracker(stakedElpTracker).stakeForAccount(_recipient, _recipient, feeElpTracker, _amount);
    }
}
