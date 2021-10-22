import axiosInstance from '../../config/axios-config'
import { DateTime } from 'luxon'
import groupby from 'lodash.groupby'
import tokenListMarginSwap from '../../constants/tokenLists/marginswap-default.tokenlist.json'
import { AVALANCHE_TOKENS_LIST } from '../../constants'
import { TokenAmount, Token } from '@marginswap/sdk'
import transform from 'lodash.transform'
import legacyAvalancheData from '../../data/legacy-data/avalanche-aug-2021.json'
import {
  AggregateBalance,
  ChartData,
  GetAggregateBalances,
  GetDailyVolume,
  Swap,
  SwapVolume,
  TokensMap,
  Trader,
  VolumeSwaps
} from './types'
import moment from 'moment'

export async function lowerCaseObjectKey(object: any) {
  return transform(object, (result: any, val, key: string): any => (result[key.toLowerCase()] = val))
}

export async function adjustTokenValue(token: AggregateBalance | SwapVolume) {
  const info = [...AVALANCHE_TOKENS_LIST, ...tokenListMarginSwap.tokens].filter(
    value => value.address.toLowerCase() === token.token.toLowerCase()
  )[0]

  return {
    ...token,
    info: {
      ...info
    }
  }
}

export async function adjustTokenValueForTraders(token: Swap) {
  const info = [...AVALANCHE_TOKENS_LIST, ...tokenListMarginSwap.tokens].filter(
    value => value.address.toLowerCase() === token.fromToken.toLowerCase()
  )[0]

  return {
    ...token,
    info: {
      ...info
    }
  }
}

//polygon-pos - avalanche - binance-smart-chain
export async function getBscTokenUSDPrice(tokenAddress: string[]): Promise<TokensMap | void> {
  if (tokenAddress.length > 0) {
    const bscPrices = await axiosInstance.get(`/simple/token_price/binance-smart-chain`, {
      params: {
        contract_addresses: tokenAddress.join(','),
        vs_currencies: 'usd'
      }
    })

    const transformKeys = await Promise.all(
      Object.keys(bscPrices.data).map(pp => lowerCaseObjectKey({ [pp]: bscPrices.data[pp] }))
    )

    return Object.assign({}, ...transformKeys)
  }
}

export async function getPolygonTokenUSDPrice(tokenAddress: string[]): Promise<TokensMap | void> {
  if (tokenAddress.length > 0) {
    const polygonPrices = await axiosInstance.get(`/simple/token_price/polygon-pos`, {
      params: {
        contract_addresses: tokenAddress.join(','),
        vs_currencies: 'usd'
      }
    })

    const transformKeys = await Promise.all(
      Object.keys(polygonPrices.data).map(pp => lowerCaseObjectKey({ [pp]: polygonPrices.data[pp] }))
    )

    return Object.assign({}, ...transformKeys)
  }
}

export async function getAvalancheTokenUSDPrice(): Promise<TokensMap> {
  const legacyTokens: any[] = []
  tokenListMarginSwap.tokens.forEach((info: any) => {
    if (info.chainId === 43114) legacyTokens.push({ ...info, address: info.address.toLowerCase() })
  })

  const allAvalancheTokens = [...AVALANCHE_TOKENS_LIST, ...legacyTokens]
  const tokenTypes = allAvalancheTokens.map(token => token?.coingeckoId)

  const prices = await axiosInstance.get(`/simple/price`, {
    params: {
      ids: tokenTypes.join(','),
      vs_currencies: 'usd'
    }
  })

  const avalancheTokens: TokensMap = {}

  await allAvalancheTokens.forEach(avax => {
    const newObj = { [avax.address.toLowerCase()]: prices.data[avax.coingeckoId] }
    Object.assign(avalancheTokens, newObj)
  })

  const transformKeys = await Promise.all(
    Object.keys(avalancheTokens).map(pp => lowerCaseObjectKey({ [pp]: avalancheTokens[pp] }))
  )

  return Object.assign({}, ...transformKeys)
}

export async function getEthTokenUSDPrice(tokenAddress: string[]) {
  if (tokenAddress.length > 0) {
    const ethPrices = await axiosInstance.get(`/simple/token_price/ethereum`, {
      params: {
        contract_addresses: tokenAddress.join(','),
        vs_currencies: 'usd'
      }
    })

    const transformKeys = await Promise.all(
      Object.keys(ethPrices.data).map(pp => lowerCaseObjectKey({ [pp]: ethPrices.data[pp] }))
    )

    return Object.assign({}, ...transformKeys)
  }
}

export async function getTopTraders({ polygonData, avalancheData, bscData, ethData }: VolumeSwaps): Promise<Trader[]> {
  const polygonTokenAddresses = await Promise.all(polygonData.map(swap => swap.fromToken))
  const bscTokenAddresses = await Promise.all(bscData.map((swap: { fromToken: string }) => swap.fromToken))
  const ethTokenAddresses = await Promise.all(ethData.map((swap: { fromToken: string }) => swap.fromToken))

  const filterPolygonTokenAddresses: string[] = []
  const filterEthTokenAddresses: string[] = []
  const filterbscTokenAddresses: string[] = []

  ethTokenAddresses.map(address => {
    if (filterEthTokenAddresses.includes(address)) {
      return
    }

    filterEthTokenAddresses.push(address)
  })

  bscTokenAddresses.map(address => {
    if (filterbscTokenAddresses.includes(address)) {
      return
    }
    filterbscTokenAddresses.push(address)
  })

  polygonTokenAddresses.map(address => {
    if (filterPolygonTokenAddresses.includes(address)) {
      return
    }

    filterPolygonTokenAddresses.push(address)
  })

  const polygonTokensPrice = await getPolygonTokenUSDPrice(filterPolygonTokenAddresses)
  const avalancheTokensPrice = await getAvalancheTokenUSDPrice()
  const bscTokensPrice = await getBscTokenUSDPrice(filterbscTokenAddresses)
  const ethTokensPrice = await getEthTokenUSDPrice(filterEthTokenAddresses)

  let swaps = []
  swaps = await Promise.all(
    [...polygonData, ...avalancheData, ...bscData, ...ethData].map(t => adjustTokenValueForTraders(t))
  )

  const tokensPrice = { ...polygonTokensPrice, ...avalancheTokensPrice, ...bscTokensPrice, ...ethTokensPrice }

  const swapWithTokensUsdValue = swaps.map(swap => {
    const mult = tokensPrice[swap.fromToken]?.usd || 0

    return {
      ...swap,
      usdTokenValue:
        Number(
          new TokenAmount(
            new Token(swap.info.chainId, swap.fromToken, swap.info.decimals),
            swap.fromAmount
          ).toSignificant(3)
        ) * mult
    }
  })

  const tradersInfo = await groupby(swapWithTokensUsdValue, (swap: { trader: string }) => swap.trader)

  return await Object.keys(tradersInfo).map(address => {
    const infos = tradersInfo[address]
    let weeklyDays: string[] = []

    for (let i = 0; i < 7; i++) {
      weeklyDays = [...weeklyDays, moment().subtract(i, 'days').format('DD-MM-YYYY')]
    }

    const monthlyVolume = infos
      .map(traderInfo => traderInfo.usdTokenValue)
      .reduce((previousValue, currentValue) => previousValue + currentValue)

    const weeklyVolume = infos
      .map(traderInfo => {
        if (weeklyDays.includes(moment.unix(Number(traderInfo.createdAt)).utc().format('DD-MM-YYYY'))) {
          return traderInfo.usdTokenValue
        }

        return 0
      })
      .reduce((previousValue, currentValue) => previousValue + currentValue)

    const dailyVolume = infos
      .map(traderInfo => {
        if (moment.unix(Number(traderInfo.createdAt)).isAfter(moment().subtract(1, 'days'))) {
          return traderInfo.usdTokenValue
        }

        return 0
      })
      .reduce((previousValue, currentValue) => previousValue + currentValue)

    return {
      address: address,
      dailyVolume,
      weeklyVolume,
      monthlyVolume
    }
  })
}

export async function getVolume({
  dailyPolygonSwapVolumes,
  dailyAvalancheSwapVolumes,
  dailyBscSwapVolumes,
  dailyEthSwapVolumes
}: GetDailyVolume) {
  // avalancheTokenAddresses ->  WE ARE GETTING THIS FROM A STATIC FILE
  const polygonTokenAddresses = dailyPolygonSwapVolumes.map(dsv => dsv.token)
  const bscTokenAddresses = dailyBscSwapVolumes.map(dsv => dsv.token)
  const ethTokenAddresses = dailyEthSwapVolumes.map(dsv => dsv.token)

  const filterPolygonTokenAddresses: string[] = []
  const filterEthTokenAddresses: string[] = []
  const filterbscTokenAddresses: string[] = []

  ethTokenAddresses.map(address => {
    if (filterEthTokenAddresses.includes(address)) {
      return
    }

    filterEthTokenAddresses.push(address)
  })

  bscTokenAddresses.map(address => {
    if (filterbscTokenAddresses.includes(address)) {
      return
    }
    filterbscTokenAddresses.push(address)
  })

  polygonTokenAddresses.map(address => {
    if (filterPolygonTokenAddresses.includes(address)) {
      return
    }

    filterPolygonTokenAddresses.push(address)
  })

  const tokensAvalanchePrice = await getAvalancheTokenUSDPrice()
  const tokensPolygonPrice = await getPolygonTokenUSDPrice(filterPolygonTokenAddresses)
  const tokensBscPrice = await getBscTokenUSDPrice(filterbscTokenAddresses)
  const tokensEthPrice = await getEthTokenUSDPrice(filterEthTokenAddresses)

  const tokensPrice = { ...tokensAvalanchePrice, ...tokensPolygonPrice, ...tokensBscPrice, ...tokensEthPrice }

  let dailyVolume = 0
  const legacyAvalanche = await Promise.all(legacyAvalancheData.dailySwapVolumes.filter(la => la.type === 'MARGIN'))
  const swapVolumes = await Promise.all(
    [
      ...dailyPolygonSwapVolumes,
      ...dailyAvalancheSwapVolumes,
      ...legacyAvalanche,
      ...dailyBscSwapVolumes,
      ...dailyEthSwapVolumes
    ].map(t => adjustTokenValue(t))
  )

  const dailySwap = swapVolumes.map((token: any) => {
    let formattedVolume = 0
    try {
      formattedVolume =
        Number(
          new TokenAmount(new Token(token.info.chainId, token.token, token.info.decimals), token.volume).toSignificant(
            3
          )
        ) * tokensPrice[token.token.toLowerCase()].usd
    } catch (err) {
      formattedVolume = 0
      console.log('Not found :::', token)
    }

    dailyVolume += formattedVolume
    return {
      time: DateTime.fromSeconds(Number(token.createdAt)).toISO().toString(),
      value: Number(formattedVolume)
    }
  })

  //Consolidating dates
  const swapResult = new Map()
  dailySwap.forEach(swap => {
    if (swapResult.get(swap.time)) swapResult.set(swap.time, swapResult.get(swap.time) + swap.value)
    else swapResult.set(swap.time, swap.value)
  })

  return {
    totalDailyVolume: Number(dailyVolume.toFixed(2)),
    dailySwap: Array.from(swapResult, ([key, value]) => ({ time: key, value: value.toFixed(6) })).sort(
      (a, b) => DateTime.fromISO(a.time).toMillis() - DateTime.fromISO(b.time).toMillis()
    )
  }
}

export async function getAggregateBalances({
  aggregateBalancesPolygon,
  aggregateBalancesAvalanche,
  aggregateBalancesBsc,
  aggregateBalancesEth
}: GetAggregateBalances) {
  // avalancheTokenAddresses ->  WE ARE GETTING THIS FROM A STATIC FILE
  const polygonTokenAddresses = aggregateBalancesPolygon.map(dsv => dsv.token)
  const bscTokenAddresses = aggregateBalancesBsc.map(dsv => dsv.token)
  const ethTokenAddresses = aggregateBalancesEth.map(dsv => dsv.token)

  const filterPolygonTokenAddresses: string[] = []
  const filterEthTokenAddresses: string[] = []
  const filterbscTokenAddresses: string[] = []

  ethTokenAddresses.map(address => {
    if (filterEthTokenAddresses.includes(address)) {
      return
    }

    filterEthTokenAddresses.push(address)
  })

  bscTokenAddresses.map(address => {
    if (filterbscTokenAddresses.includes(address)) {
      return
    }
    filterbscTokenAddresses.push(address)
  })

  polygonTokenAddresses.map(address => {
    if (filterPolygonTokenAddresses.includes(address)) {
      return
    }

    filterPolygonTokenAddresses.push(address)
  })

  const tokensAvalanchePrice = await getAvalancheTokenUSDPrice()
  const tokensPolygonPrice = await getPolygonTokenUSDPrice(filterPolygonTokenAddresses)
  const tokensBscPrice = await getBscTokenUSDPrice(filterbscTokenAddresses)
  const tokensEthPrice = await getEthTokenUSDPrice(filterEthTokenAddresses)

  const tokensPrice = { ...tokensAvalanchePrice, ...tokensPolygonPrice, ...tokensBscPrice, ...tokensEthPrice }

  let tvl = 0
  let totalBorrowed = 0
  let totalLending = 0
  const tvlChart: ChartData[] = []
  const aggregateBalances: any[] = await Promise.all(
    [
      ...aggregateBalancesPolygon,
      ...aggregateBalancesAvalanche,
      ...legacyAvalancheData.aggregatedBalances,
      ...aggregateBalancesBsc,
      ...aggregateBalancesEth
    ].map(t => adjustTokenValue(t))
  )

  aggregateBalances.forEach((aggBal: any) => {
    const formatedTime = DateTime.fromSeconds(Number(aggBal.createdAt)).toISO().toString()

    try {
      const formattedBalance =
        Number(
          new TokenAmount(
            new Token(aggBal.info.chainId, aggBal.token, aggBal.info.decimals),
            aggBal.balance
          ).toSignificant(3)
        ) * tokensPrice[aggBal.token.toLowerCase()].usd

      tvlChart.push({ time: formatedTime, value: Number(formattedBalance) })

      tvl += formattedBalance

      if (aggBal.balanceType === 'BOND_DEPOSIT') {
        totalLending += formattedBalance
      }

      if (aggBal.balanceType === 'CROSS_MARGIN_DEBT') {
        totalBorrowed += formattedBalance
      }
    } catch (err) {
      console.log('Token not found ::', aggBal.token)
    }
  })

  const swapResult = new Map()
  tvlChart.forEach(swap => {
    if (swapResult.get(swap.time)) swapResult.set(swap.time, swapResult.get(swap.time) + swap.value)
    else swapResult.set(swap.time, swap.value)
  })

  return {
    tvl,
    totalBorrowed,
    totalLending,
    tvlChart: Array.from(swapResult, ([key, value]) => ({ time: key, value: value.toFixed(6) })).sort(
      (a, b) => DateTime.fromISO(a.time).toMillis() - DateTime.fromISO(b.time).toMillis()
    )
  }
}
