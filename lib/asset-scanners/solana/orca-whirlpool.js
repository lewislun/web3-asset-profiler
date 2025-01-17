/**
 * @typedef {import('@orca-so/whirlpools-sdk').WhirlpoolClient} WhirlpoolClient
 * @typedef {import('@orca-so/whirlpools-sdk').CollectFeesQuoteParam} CollectFeesQuoteParam
 * @typedef {import('@orca-so/whirlpools-sdk').CollectRewardsQuoteParam} CollectRewardsQuoteParam
 */

// TODO: require fixing

import * as solanaWeb3 from '@solana/web3.js'
import { Wallet } from '@project-serum/anchor'
import { AccountFetcher, PDAUtil, ORCA_WHIRLPOOL_PROGRAM_ID, WhirlpoolContext, buildWhirlpoolClient, PriceMath, PoolUtil, collectRewardsQuote, collectFeesQuote } from '@orca-so/whirlpools-sdk'

import BaseSolanaAssetScanner, { TOKEN_PROGRAM_ID } from './base.js'
import * as enums from '../../enums.js'
import { parseDecimal } from '../../utils/common.js'
import Decimal from 'decimal.js'
import { AssetQuery, AssetSnapshot, AssetInfo } from '../../models/index.js'

export default class OrcaWhirlpoolScanner extends BaseSolanaAssetScanner {

	/** @type {WhirlpoolContext} */				ctx
	/** @type {WhirlpoolClient} */				client
	/** @type {AccountFetcher} */				accFetcher
	/** @type {AssetInfo[]} */					assetInfos
	/** @type {Map.<string, AssetInfo>} */		assetInfoByAddr

	/**
	 * @protected
	 */
	async _init() {
		await super._init()
		
		const wallet = new Wallet()
		this.accFetcher = new AccountFetcher(this.connection)
		this.ctx = new WhirlpoolContext(this.connection, wallet, ORCA_WHIRLPOOL_PROGRAM_ID, this.accFetcher)
		this.client = buildWhirlpoolClient(this.ctx)
		this.client.getContext().program.programId = ORCA_WHIRLPOOL_PROGRAM_ID // weird fix of the sdk
		this.assetInfos = await AssetInfo.getSecondaryTokens(this.chain)
		this.assetInfoByAddr = new Map()
		for (const assetInfo of this.assetInfos) {
			this.assetInfoByAddr.set(assetInfo.address, assetInfo)
		}
	}

	/**
	 * @protected
	 * @param {AssetQuery} assetQuery
	 * @returns {Promise<AssetSnapshot[]>}
	 */
	async _query(assetQuery) {
		// get all tokens in account, then filter out non-whirlpool ones
		const pubkey = new solanaWeb3.PublicKey(assetQuery.addr)
		const { context, value: accResults } = await this.rateLimiter.exec(() => this.connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }))
		const capturedAt = await this.rateLimiter.exec(() => this.getDatetimeFromContext(context))

		/** @type {AssetSnapshot[]} */
		const snapshots = []
		for (let accResult of accResults) {
			// get PDA
			const mintStr = accResult.account?.data?.parsed?.info?.mint
			if (!mintStr) continue
			const mint = new solanaWeb3.PublicKey(mintStr)
			const pda = PDAUtil.getPosition(ORCA_WHIRLPOOL_PROGRAM_ID, mint)

			// get position (since this.client.getPosition throws error when fed with a non whirlpool address, we use account fetcher directly to check if the address is a whirlpool position)
			const positionData = await this.rateLimiter.exec(() => this.accFetcher.getPosition(pda.publicKey, true))
			if (!positionData) continue
			const position = await this.rateLimiter.exec(() => this.client.getPosition(pda.publicKey, true))

			// get whirlpool and token data
			const pool = await this.rateLimiter.exec(() => this.client.getPool(positionData.whirlpool, true))
			const poolData = pool.getData()
			const tokenInfos = [ pool.getTokenAInfo(), pool.getTokenBInfo() ]

			// get token amount from liquidity
			const lowerPrice = PriceMath.tickIndexToPrice(positionData.tickLowerIndex, tokenInfos[0].decimals, tokenInfos[1].decimals)
			const upperPrice = PriceMath.tickIndexToPrice(positionData.tickUpperIndex, tokenInfos[0].decimals, tokenInfos[1].decimals)
			const lowerSqrtPrice = PriceMath.priceToSqrtPriceX64(lowerPrice, tokenInfos[0].decimals, tokenInfos[1].decimals)
			const upperSqrtPrice = PriceMath.priceToSqrtPriceX64(upperPrice, tokenInfos[0].decimals, tokenInfos[1].decimals)
			const tokenAmountResult = PoolUtil.getTokenAmountsFromLiquidity(
				positionData.liquidity,
				poolData.sqrtPrice,
				lowerSqrtPrice,
				upperSqrtPrice,
			)

			// process token infos
			const tokenAmountU64s = [ tokenAmountResult.tokenA, tokenAmountResult.tokenB ]
			/** @type {Decimal[]} */
			const tokenAmounts = []
			/** @type {enums.AssetCode[]} */
			const tokenCodes = []
			/** @type {number[]} */
			const tokenPrices = []
			for (let i = 0; i < 2; i++) {
				tokenAmounts.push(parseDecimal(tokenAmountU64s[i], tokenInfos[i].decimals))
				const assetInfo = this.assetInfoByAddr.get(tokenInfos[i]?.mint?.toBase58())
				if (!assetInfo)
					throw new Error(`AssetCode not found for address - ${tokenInfos[i]?.mint}`)
				tokenCodes.push(assetInfo.code)
				tokenPrices.push(await this.priceAggregator.getPrice(tokenCodes[i]))
			}

			// append liquidity assets
			const assetName = `Orca Whirlpool Liquidity ${tokenCodes[0]}+${tokenCodes[1]}`
			for (const i in tokenAmountU64s) {
				if (tokenAmounts[i].cmp(0) == 0) continue

				snapshots.push(AssetSnapshot.fromJson({
					name: assetName,
					code: tokenCodes[i],
					chain: this.chain,
					type: assetInfo.type,
					state: enums.AssetState.CLAIMABLE,
					quantity: tokenAmounts[i],
					usd_value: tokenAmounts[i].mul(tokenPrices[i]),
					usd_value_per_quantity: tokenPrices[i],
					captured_at: capturedAt,
				}))
			}

			// get reward amount
			/** @type {CollectFeesQuoteParam & CollectRewardsQuoteParam} */
			const quoteParams = { whirlpool: poolData, position: positionData, tickLower: position.getLowerTickData(), tickUpper: position.getUpperTickData() }
			const rewardsQuote = collectRewardsQuote(quoteParams)
			const feesQuote = collectFeesQuote(quoteParams)

			// compose reward assets
			for (const i in rewardsQuote) {
				const rewardAmountBN = rewardsQuote[i]
				if (!rewardAmountBN) continue
				const tokenInfo = poolData.rewardInfos[i]
				if (!tokenInfo) throw new Error('Reward info not found')

				const decimals = await this.getSplTokenDecimals(tokenInfo.mint)
				const rewardAmount = parseDecimal(rewardAmountBN, decimals)
				if (rewardAmount.cmp(0) == 0) continue
				const assetInfo = this.assetInfoByAddr.get(tokenInfos[i]?.mint?.toBase58())
				if (!assetInfo)
					throw new Error(`AssetCode not found for address - ${tokenInfos[i]?.mint}`)
				const price = await this.priceAggregator.getPrice(assetInfo.code)

				snapshots.push(AssetSnapshot.fromJson({
					name: `Orca Whirlpool Reward ${tokenCodes[0]}+${tokenCodes[1]}`,
					code: assetInfo.code,
					chain: this.chain,
					type: assetInfo.type,
					state: enums.AssetState.CLAIMABLE,
					quantity: rewardAmount,
					usd_value: rewardAmount.mul(price),
					usd_value_per_quantity: price,
					captured_at: capturedAt,
				}))
			}

			// compose fee assets
			const feeAmountBNs = [ feesQuote.feeOwedA, feesQuote.feeOwedB ]
			for (const i in feeAmountBNs) {
				const feeAmountBN = feeAmountBNs[i]
				if (!feeAmountBN) continue
				const feeAmount = parseDecimal(feeAmountBN, tokenInfos[i].decimals)
				if (feeAmount.cmp(0) == 0) continue

				snapshots.push(AssetSnapshot.fromJson({
					name: `Orca Whirlpool Reward ${tokenCodes[0]}+${tokenCodes[1]}`,
					code: tokenCodes[i],
					chain: this.chain,
					type: enums.AssetType.SECONDARY_TOKEN,
					state: enums.AssetState.CLAIMABLE,
					quantity: feeAmount,
					usd_value: feeAmount.mul(tokenPrices[i]),
					usd_value_per_quantity: tokenPrices[i],
					captured_at: capturedAt,
				}))
			}

			// tags
			snapshots.forEach(result => result.tagMap = {
				[enums.DefaultAssetTagCategory.DAPP]: 'orca',
			})
		}

		return snapshots
	}
}