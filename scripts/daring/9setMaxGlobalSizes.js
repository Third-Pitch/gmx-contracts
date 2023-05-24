const { contractAt, sendTxn } = require("../shared/helpers")
const { bigNumberify, expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];

const shouldSendTxn = true;


async function main() {
  const positionContracts = [
    "0xECA4B3f2aF83367B047bbf2DeCC3BA39630CE1FC", // PositionRouter
    "0xbA641fB4B8aE011d62619B61230f7c1c17515C14" // PositionManager
  ]
  const { btc, eth, link, dai,usdc,usdt } = tokens
  const tokenArr = [btc, eth, link, dai,usdc,usdt]

  const vault = await contractAt("Vault", "0xfD22f2b0975Ff9219a635cF84F3Fd154AB78af9B");
  const positionContractOptions = {
    libraries: {
      PositionUtils: "0xB5C7f79E1eB48EE470831ED8582C1883d42a8cAB"
    }
  }
  const positionContract = await contractAt("PositionManager", positionContracts[0], undefined, positionContractOptions);
  for (const token of tokenArr) {
    const [currentLongCap, currentShortCap, currentLongSize, currentShortSize] = await Promise.all([
      positionContract.maxGlobalLongSizes(token.address),
      positionContract.maxGlobalShortSizes(token.address),
      vault.guaranteedUsd(token.address),
      vault.globalShortSizes(token.address)
    ]);
    console.log("%s longs $%sm / $%sm -> $%sm, shorts $%sm / $%sm -> $%sm",
      token.name.toUpperCase(),
      (currentLongSize.toString() / 1e36).toFixed(2),
      (currentLongCap.toString() / 1e36).toFixed(2),
      (token.maxGlobalLongSize / 1e6 || 0).toFixed(2),
      (currentShortSize.toString() / 1e36).toFixed(2),
      (currentShortCap.toString() / 1e36).toFixed(2),
      (token.maxGlobalShortSize / 1e6 || 0).toFixed(2),
    );
  }

  if (!shouldSendTxn) {
    return;
  }

  const tokenAddresses = tokenArr.map(t => t.address)
  const longSizes = tokenArr.map((token) => {
    if (!token.maxGlobalLongSize) {
      return bigNumberify(0)
    }

    return expandDecimals(token.maxGlobalLongSize, 30)
  })

  const shortSizes = tokenArr.map((token) => {
    if (!token.maxGlobalShortSize) {
      return bigNumberify(0)
    }

    return expandDecimals(token.maxGlobalShortSize, 30)
  })

  for (let i = 0; i < positionContracts.length; i++) {
    const positionContract = await contractAt("PositionManager", positionContracts[i], undefined, positionContractOptions)
    await sendTxn(positionContract.setMaxGlobalSizes(tokenAddresses, longSizes, shortSizes), "positionContract.setMaxGlobalSizes")
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
