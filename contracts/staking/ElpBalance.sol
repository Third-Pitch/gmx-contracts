// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../core/interfaces/IElpManager.sol";

contract ElpBalance {
    using SafeMath for uint256;

    IElpManager public elpManager;
    address public stakedElpTracker;

    mapping (address => mapping (address => uint256)) public allowances;

    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        IElpManager _elpManager,
        address _stakedElpTracker
    ) public {
        elpManager = _elpManager;
        stakedElpTracker = _stakedElpTracker;
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
        uint256 nextAllowance = allowances[_sender][msg.sender].sub(_amount, "ElpBalance: transfer amount exceeds allowance");
        _approve(_sender, msg.sender, nextAllowance);
        _transfer(_sender, _recipient, _amount);
        return true;
    }

    function _approve(address _owner, address _spender, uint256 _amount) private {
        require(_owner != address(0), "ElpBalance: approve from the zero address");
        require(_spender != address(0), "ElpBalance: approve to the zero address");

        allowances[_owner][_spender] = _amount;

        emit Approval(_owner, _spender, _amount);
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) private {
        require(_sender != address(0), "ElpBalance: transfer from the zero address");
        require(_recipient != address(0), "ElpBalance: transfer to the zero address");

        require(
            elpManager.lastAddedAt(_sender).add(elpManager.cooldownDuration()) <= block.timestamp,
            "ElpBalance: cooldown duration not yet passed"
        );

        IERC20(stakedElpTracker).transferFrom(_sender, _recipient, _amount);
    }
}
