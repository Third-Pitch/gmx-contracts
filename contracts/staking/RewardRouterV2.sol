// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../libraries/utils/Address.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IRewardRouterV2.sol";
import "./interfaces/IVester.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IWETH.sol";
import "../core/interfaces/IElpManager.sol";
import "../access/Governable.sol";

contract RewardRouterV2 is IRewardRouterV2, ReentrancyGuard, Governable {
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

    address public override stakedElpTracker;
    address public override feeElpTracker;

    address public elpManager;

    address public eddxVester;
    address public elpVester;

    mapping (address => address) public pendingReceivers;

    event StakeEddx(address account, address token, uint256 amount);
    event UnstakeEddx(address account, address token, uint256 amount);

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
        address _elpManager,
        address _eddxVester,
        address _elpVester
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

        eddxVester = _eddxVester;
        elpVester = _elpVester;
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
        _unstakeEddx(msg.sender, eddx, _amount, true);
    }

    function unstakeEsEddx(uint256 _amount) external nonReentrant {
        _unstakeEddx(msg.sender, esEddx, _amount, true);
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

    function handleRewards(
        bool _shouldClaimEddx,
        bool _shouldStakeEddx,
        bool _shouldClaimEsEddx,
        bool _shouldStakeEsEddx,
        bool _shouldStakeMultiplierPoints,
        bool _shouldClaimWeth,
        bool _shouldConvertWethToEth
    ) external nonReentrant {
        address account = msg.sender;

        uint256 eddxAmount = 0;
        if (_shouldClaimEddx) {
            uint256 eddxAmount0 = IVester(eddxVester).claimForAccount(account, account);
            uint256 eddxAmount1 = IVester(elpVester).claimForAccount(account, account);
            eddxAmount = eddxAmount0.add(eddxAmount1);
        }

        if (_shouldStakeEddx && eddxAmount > 0) {
            _stakeEddx(account, account, eddx, eddxAmount);
        }

        uint256 esEddxAmount = 0;
        if (_shouldClaimEsEddx) {
            uint256 esEddxAmount0 = IRewardTracker(stakedEddxTracker).claimForAccount(account, account);
            uint256 esEddxAmount1 = IRewardTracker(stakedElpTracker).claimForAccount(account, account);
            esEddxAmount = esEddxAmount0.add(esEddxAmount1);
        }

        if (_shouldStakeEsEddx && esEddxAmount > 0) {
            _stakeEddx(account, account, esEddx, esEddxAmount);
        }

        if (_shouldStakeMultiplierPoints) {
            uint256 bnEddxAmount = IRewardTracker(bonusEddxTracker).claimForAccount(account, account);
            if (bnEddxAmount > 0) {
                IRewardTracker(feeEddxTracker).stakeForAccount(account, account, bnEddx, bnEddxAmount);
            }
        }

        if (_shouldClaimWeth) {
            if (_shouldConvertWethToEth) {
                uint256 weth0 = IRewardTracker(feeEddxTracker).claimForAccount(account, address(this));
                uint256 weth1 = IRewardTracker(feeElpTracker).claimForAccount(account, address(this));

                uint256 wethAmount = weth0.add(weth1);
                IWETH(weth).withdraw(wethAmount);

                payable(account).sendValue(wethAmount);
            } else {
                IRewardTracker(feeEddxTracker).claimForAccount(account, account);
                IRewardTracker(feeElpTracker).claimForAccount(account, account);
            }
        }
    }

    function batchCompoundForAccounts(address[] memory _accounts) external nonReentrant onlyGov {
        for (uint256 i = 0; i < _accounts.length; i++) {
            _compound(_accounts[i]);
        }
    }

    // the _validateReceiver function checks that the averageStakedAmounts and cumulativeRewards
    // values of an account are zero, this is to help ensure that vesting calculations can be
    // done correctly
    // averageStakedAmounts and cumulativeRewards are updated if the claimable reward for an account
    // is more than zero
    // it is possible for multiple transfers to be sent into a single account, using signalTransfer and
    // acceptTransfer, if those values have not been updated yet
    // for ELP transfers it is also possible to transfer ELP into an account using the StakedElp contract
    function signalTransfer(address _receiver) external nonReentrant {
        require(IERC20(eddxVester).balanceOf(msg.sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(elpVester).balanceOf(msg.sender) == 0, "RewardRouter: sender has vested tokens");

        _validateReceiver(_receiver);
        pendingReceivers[msg.sender] = _receiver;
    }

    function acceptTransfer(address _sender) external nonReentrant {
        require(IERC20(eddxVester).balanceOf(_sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(elpVester).balanceOf(_sender) == 0, "RewardRouter: sender has vested tokens");

        address receiver = msg.sender;
        require(pendingReceivers[_sender] == receiver, "RewardRouter: transfer not signalled");
        delete pendingReceivers[_sender];

        _validateReceiver(receiver);
        _compound(_sender);

        uint256 stakedEddx = IRewardTracker(stakedEddxTracker).depositBalances(_sender, eddx);
        if (stakedEddx > 0) {
            _unstakeEddx(_sender, eddx, stakedEddx, false);
            _stakeEddx(_sender, receiver, eddx, stakedEddx);
        }

        uint256 stakedEsEddx = IRewardTracker(stakedEddxTracker).depositBalances(_sender, esEddx);
        if (stakedEsEddx > 0) {
            _unstakeEddx(_sender, esEddx, stakedEsEddx, false);
            _stakeEddx(_sender, receiver, esEddx, stakedEsEddx);
        }

        uint256 stakedBnEddx = IRewardTracker(feeEddxTracker).depositBalances(_sender, bnEddx);
        if (stakedBnEddx > 0) {
            IRewardTracker(feeEddxTracker).unstakeForAccount(_sender, bnEddx, stakedBnEddx, _sender);
            IRewardTracker(feeEddxTracker).stakeForAccount(_sender, receiver, bnEddx, stakedBnEddx);
        }

        uint256 esEddxBalance = IERC20(esEddx).balanceOf(_sender);
        if (esEddxBalance > 0) {
            IERC20(esEddx).transferFrom(_sender, receiver, esEddxBalance);
        }

        uint256 elpAmount = IRewardTracker(feeElpTracker).depositBalances(_sender, elp);
        if (elpAmount > 0) {
            IRewardTracker(stakedElpTracker).unstakeForAccount(_sender, feeElpTracker, elpAmount, _sender);
            IRewardTracker(feeElpTracker).unstakeForAccount(_sender, elp, elpAmount, _sender);

            IRewardTracker(feeElpTracker).stakeForAccount(_sender, receiver, elp, elpAmount);
            IRewardTracker(stakedElpTracker).stakeForAccount(receiver, receiver, feeElpTracker, elpAmount);
        }

        IVester(eddxVester).transferStakeValues(_sender, receiver);
        IVester(elpVester).transferStakeValues(_sender, receiver);
    }

    function _validateReceiver(address _receiver) private view {
        require(IRewardTracker(stakedEddxTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: stakedEddxTracker.averageStakedAmounts > 0");
        require(IRewardTracker(stakedEddxTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: stakedEddxTracker.cumulativeRewards > 0");

        require(IRewardTracker(bonusEddxTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: bonusEddxTracker.averageStakedAmounts > 0");
        require(IRewardTracker(bonusEddxTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: bonusEddxTracker.cumulativeRewards > 0");

        require(IRewardTracker(feeEddxTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: feeEddxTracker.averageStakedAmounts > 0");
        require(IRewardTracker(feeEddxTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: feeEddxTracker.cumulativeRewards > 0");

        require(IVester(eddxVester).transferredAverageStakedAmounts(_receiver) == 0, "RewardRouter: eddxVester.transferredAverageStakedAmounts > 0");
        require(IVester(eddxVester).transferredCumulativeRewards(_receiver) == 0, "RewardRouter: eddxVester.transferredCumulativeRewards > 0");

        require(IRewardTracker(stakedElpTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: stakedElpTracker.averageStakedAmounts > 0");
        require(IRewardTracker(stakedElpTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: stakedElpTracker.cumulativeRewards > 0");

        require(IRewardTracker(feeElpTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: feeElpTracker.averageStakedAmounts > 0");
        require(IRewardTracker(feeElpTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: feeElpTracker.cumulativeRewards > 0");

        require(IVester(elpVester).transferredAverageStakedAmounts(_receiver) == 0, "RewardRouter: eddxVester.transferredAverageStakedAmounts > 0");
        require(IVester(elpVester).transferredCumulativeRewards(_receiver) == 0, "RewardRouter: eddxVester.transferredCumulativeRewards > 0");

        require(IERC20(eddxVester).balanceOf(_receiver) == 0, "RewardRouter: eddxVester.balance > 0");
        require(IERC20(elpVester).balanceOf(_receiver) == 0, "RewardRouter: elpVester.balance > 0");
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

        emit StakeEddx(_account, _token, _amount);
    }

    function _unstakeEddx(address _account, address _token, uint256 _amount, bool _shouldReduceBnEddx) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        uint256 balance = IRewardTracker(stakedEddxTracker).stakedAmounts(_account);

        IRewardTracker(feeEddxTracker).unstakeForAccount(_account, bonusEddxTracker, _amount, _account);
        IRewardTracker(bonusEddxTracker).unstakeForAccount(_account, stakedEddxTracker, _amount, _account);
        IRewardTracker(stakedEddxTracker).unstakeForAccount(_account, _token, _amount, _account);

        if (_shouldReduceBnEddx) {
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
        }

        emit UnstakeEddx(_account, _token, _amount);
    }
}
