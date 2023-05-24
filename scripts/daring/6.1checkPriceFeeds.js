const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];

async function main() {

  const { btc, eth, link, dai,usdc,usdt } = tokens
  const tokenArr = [btc, eth, link, dai,usdc,usdt]
  const now = parseInt(Date.now() / 1000)
  const priceDecimals = 8
  for (let i = 0; i < tokenArr.length; i++) {
    const { name, priceFeed } = tokenArr[i]
    const priceFeedContrct = await contractAt("PriceFeed", priceFeed)
    const latestRound = await priceFeedContrct.latestRound()

    for (let j = 0; j < 5; j++) {
      const roundData = await priceFeedContrct.getRoundData(latestRound.sub(j))
      const answer = roundData[1]
      const updatedAt = roundData[3]
      console.log(`${name} ${j}: ${ethers.utils.formatUnits(answer, priceDecimals)}, ${updatedAt}, ${updatedAt.sub(now).toString()}s, ${updatedAt.sub(now).div(60).toString()}m`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
