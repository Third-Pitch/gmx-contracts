const { deployContract, contractAt, sendTxn, sendEther, writeTmpAddresses} = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const network = (process.env.HARDHAT_NETWORK || 'mainnet');
async function main() {
  const btc = await deployContract("FaucetToken", ["btc","btc",18,expandDecimals(1,18)])
  writeTmpAddresses({btc: btc.address})
  const link = await deployContract("FaucetToken", ["link","link",18,expandDecimals(3000,18)])
  writeTmpAddresses({link: link.address})
  const usdc = await deployContract("FaucetToken", ["usdc","usdc",18,expandDecimals(20000,18)])
  writeTmpAddresses({usdc: usdc.address})
  const usdt = await deployContract("FaucetToken", ["usdt","usdt",18,expandDecimals(20000,18)])
  writeTmpAddresses({usdt: usdt.address})
  const dai = await deployContract("FaucetToken", ["dai","dai",18,expandDecimals(20000,18)])
  writeTmpAddresses({dai: dai.address})

  await sendTxn(btc.enableFaucet(), "(btc.enableFaucet")
  await sendTxn(link.enableFaucet(), "link.enableFaucet")
  await sendTxn(usdc.enableFaucet(), "usdc.enableFaucet")
  await sendTxn(usdt.enableFaucet(), "usdt.enableFaucet")
  await sendTxn(dai.enableFaucet(), "dai.enableFaucet")

  await sendTxn(btc.claimDroplet(), "(btc.claimDroplet")
  await sendTxn(link.claimDroplet(), "link.claimDroplet")
  await sendTxn(usdc.claimDroplet(), "usdc.claimDroplet")
  await sendTxn(usdt.claimDroplet(), "usdt.claimDroplet")
  await sendTxn(dai.claimDroplet(), "dai.claimDroplet")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
