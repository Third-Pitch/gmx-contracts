// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../libraries/utils/Address.sol";

import "./interfaces/IRewardTracker.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IWETH.sol";
import "../core/interfaces/IElpManager.sol";
import "../access/Governable.sol";

contract RewardRouter is ReentrancyGuard, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    bool public isInitialized;

    address public weth;

    address public eddx;
    address public esEddx;
    address public bnEddx;

    address public elp; // EDDX Liquidity Provider token

    address public stakedEddxTracker;
    address public bonusEddxTracker;
    address public feeEddxTracker;

    address public stakedElpTracker;
    address public feeElpTracker;

    address public elpManager;

    event StakeEddx(address account, uint256 amount);
    event UnstakeEddx(address account, uint256 amount);

    event StakeElp(address account, uint256 amount);
    event UnstakeElp(address account, uint256 amount);

    receive() external payable {
        require(msg.sender == weth, "Router: invalid sender");
    }

    function initialize(
        address _weth,
        address _eddx,
        address _esEddx,
        address _bnEddx,
        address _elp,
        address _stakedEddxTracker,
        address _bonusEddxTracker,
        address _feeEddxTracker,
        address _feeElpTracker,
        address _stakedElpTracker,
        address _elpManager
    ) external onlyGov {
        require(!isInitialized, "RewardRouter: already initialized");
        isInitialized = true;

        weth = _weth;

        eddx = _eddx;
        esEddx = _esEddx;
        bnEddx = _bnEddx;

        elp = _elp;

        stakedEddxTracker = _stakedEddxTracker;
        bonusEddxTracker = _bonusEddxTracker;
        feeEddxTracker = _feeEddxTracker;

        feeElpTracker = _feeElpTracker;
        stakedElpTracker = _stakedElpTracker;

        elpManager = _elpManager;
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(address _token, address _account, uint256 _amount) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function batchStakeEddxForAccount(address[] memory _accounts, uint256[] memory _amounts) external nonReentrant onlyGov {
        address _eddx = eddx;
        for (uint256 i = 0; i < _accounts.length; i++) {
            _stakeEddx(msg.sender, _accounts[i], _eddx, _amounts[i]);
        }
    }

    function stakeEddxForAccount(address _account, uint256 _amount) external nonReentrant onlyGov {
        _stakeEddx(msg.sender, _account, eddx, _amount);
    }

    function stakeEddx(uint256 _amount) external nonReentrant {
        _stakeEddx(msg.sender, msg.sender, eddx, _amount);
    }

    function stakeEsEddx(uint256 _amount) external nonReentrant {
        _stakeEddx(msg.sender, msg.sender, esEddx, _amount);
    }

    function unstakeEddx(uint256 _amount) external nonReentrant {
        _unstakeEddx(msg.sender, eddx, _amount);
    }

    function unstakeEsEddx(uint256 _amount) external nonReentrant {
        _unstakeEddx(msg.sender, esEddx, _amount);
    }

    function mintAndStakeElp(address _token, uint256 _amount, uint256 _minUsdg, uint256 _minElp) external nonReentrant returns (uint256) {
        require(_amount > 0, "RewardRouter: invalid _amount");

        address account = msg.sender;
        uint256 elpAmount = IElpManager(elpManager).addLiquidityForAccount(account, account, _token, _amount, _minUsdg, _minElp);
        IRewardTracker(feeElpTracker).stakeForAccount(account, account, elp, elpAmount);
        IRewardTracker(stakedElpTracker).stakeForAccount(account, account, feeElpTracker, elpAmount);

        emit StakeElp(account, elpAmount);

        return elpAmount;
    }

    function mintAndStakeElpETH(uint256 _minUsdg, uint256 _minElp) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "RewardRouter: invalid msg.value");

        IWETH(weth).deposit{value: msg.value}();
        IERC20(weth).approve(elpManager, msg.value);

        address account = msg.sender;
        uint256 elpAmount = IElpManager(elpManager).addLiquidityForAccount(address(this), account, weth, msg.value, _minUsdg, _minElp);

        IRewardTracker(feeElpTracker).stakeForAccount(account, account, elp, elpAmount);
        IRewardTracker(stakedElpTracker).stakeForAccount(account, account, feeElpTracker, elpAmount);

        emit StakeElp(account, elpAmount);

        return elpAmount;
    }

    function unstakeAndRedeemElp(address _tokenOut, uint256 _elpAmount, uint256 _minOut, address _receiver) external nonReentrant returns (uint256) {
        require(_elpAmount > 0, "RewardRouter: invalid _elpAmount");

        address account = msg.sender;
        IRewardTracker(stakedElpTracker).unstakeForAccount(account, feeElpTracker, _elpAmount, account);
        IRewardTracker(feeElpTracker).unstakeForAccount(account, elp, _elpAmount, account);
        uint256 amountOut = IElpManager(elpManager).removeLiquidityForAccount(account, _tokenOut, _elpAmount, _minOut, _receiver);

        emit UnstakeElp(account, _elpAmount);

        return amountOut;
    }

    function unstakeAndRedeemElpETH(uint256 _elpAmount, uint256 _minOut, address payable _receiver) external nonReentrant returns (uint256) {
        require(_elpAmount > 0, "RewardRouter: invalid _elpAmount");

        address account = msg.sender;
        IRewardTracker(stakedElpTracker).unstakeForAccount(account, feeElpTracker, _elpAmount, account);
        IRewardTracker(feeElpTracker).unstakeForAccount(account, elp, _elpAmount, account);
        uint256 amountOut = IElpManager(elpManager).removeLiquidityForAccount(account, weth, _elpAmount, _minOut, address(this));

        IWETH(weth).withdraw(amountOut);

        _receiver.sendValue(amountOut);

        emit UnstakeElp(account, _elpAmount);

        return amountOut;
    }

    function claim() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(feeEddxTracker).claimForAccount(account, account);
        IRewardTracker(feeElpTracker).claimForAccount(account, account);

        IRewardTracker(stakedEddxTracker).claimForAccount(account, account);
        IRewardTracker(stakedElpTracker).claimForAccount(account, account);
    }

    function claimEsEddx() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(stakedEddxTracker).claimForAccount(account, account);
        IRewardTracker(stakedElpTracker).claimForAccount(account, account);
    }

    function claimFees() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(feeEddxTracker).claimForAccount(account, account);
        IRewardTracker(feeElpTracker).claimForAccount(account, account);
    }

    function compound() external nonReentrant {
        _compound(msg.sender);
    }

    function compoundForAccount(address _account) external nonReentrant onlyGov {
        _compound(_account);
    }

    function batchCompoundForAccounts(address[] memory _accounts) external nonReentrant onlyGov {
        for (uint256 i = 0; i < _accounts.length; i++) {
            _compound(_accounts[i]);
        }
    }

    function _compound(address _account) private {
        _compoundEddx(_account);
        _compoundElp(_account);
    }

    function _compoundEddx(address _account) private {
        uint256 esEddxAmount = IRewardTracker(stakedEddxTracker).claimForAccount(_account, _account);
        if (esEddxAmount > 0) {
            _stakeEddx(_account, _account, esEddx, esEddxAmount);
        }

        uint256 bnEddxAmount = IRewardTracker(bonusEddxTracker).claimForAccount(_account, _account);
        if (bnEddxAmount > 0) {
            IRewardTracker(feeEddxTracker).stakeForAccount(_account, _account, bnEddx, bnEddxAmount);
        }
    }

    function _compoundElp(address _account) private {
        uint256 esEddxAmount = IRewardTracker(stakedElpTracker).claimForAccount(_account, _account);
        if (esEddxAmount > 0) {
            _stakeEddx(_account, _account, esEddx, esEddxAmount);
        }
    }

    function _stakeEddx(address _fundingAccount, address _account, address _token, uint256 _amount) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        IRewardTracker(stakedEddxTracker).stakeForAccount(_fundingAccount, _account, _token, _amount);
        IRewardTracker(bonusEddxTracker).stakeForAccount(_account, _account, stakedEddxTracker, _amount);
        IRewardTracker(feeEddxTracker).stakeForAccount(_account, _account, bonusEddxTracker, _amount);

        emit StakeEddx(_account, _amount);
    }

    function _unstakeEddx(address _account, address _token, uint256 _amount) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        uint256 balance = IRewardTracker(stakedEddxTracker).stakedAmounts(_account);

        IRewardTracker(feeEddxTracker).unstakeForAccount(_account, bonusEddxTracker, _amount, _account);
        IRewardTracker(bonusEddxTracker).unstakeForAccount(_account, stakedEddxTracker, _amount, _account);
        IRewardTracker(stakedEddxTracker).unstakeForAccount(_account, _token, _amount, _account);

        uint256 bnEddxAmount = IRewardTracker(bonusEddxTracker).claimForAccount(_account, _account);
        if (bnEddxAmount > 0) {
            IRewardTracker(feeEddxTracker).stakeForAccount(_account, _account, bnEddx, bnEddxAmount);
        }

        uint256 stakedBnEddx = IRewardTracker(feeEddxTracker).depositBalances(_account, bnEddx);
        if (stakedBnEddx > 0) {
            uint256 reductionAmount = stakedBnEddx.mul(_amount).div(balance);
            IRewardTracker(feeEddxTracker).unstakeForAccount(_account, bnEddx, reductionAmount, _account);
            IMintable(bnEddx).burn(_account, reductionAmount);
        }

        emit UnstakeEddx(_account, _amount);
    }
}
