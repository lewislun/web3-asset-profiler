import { RestClientV5 } from 'bybit-api'

import BaseAssetScanner from '../base.js'
import { humanize } from '../../utils/index.js'
import * as enums from '../../enums.js'
import Decimal from 'decimal.js'
import { AssetQuery, AssetSnapshot, AssetInfo } from '../../models/index.js'

export default class BybitSpotAssetScanner extends BaseAssetScanner {

	/** @protected @type {string[]} */							static requiredQueryKeys = ['apiKey', 'apiSecret']
	/** @protected @type {AssetInfo[]} */						assetInfos
	/** @protected @type {Map.<string, AssetInfo>} */			assetInfoByBybitSymbol

	async _init() {
		await super._init()
		this.assetInfos = await AssetInfo.getCexTokens(this.chain)
		this.assetInfoByBybitSymbol = new Map()
		for (const assetInfo of this.assetInfos) {
			this.assetInfoByBybitSymbol.set(assetInfo.address, assetInfo)
		}
	}

	/**
	 * Currently only SPOT account is supported.
	 * 
	 * @protected
	 * @param {AssetQuery} assetQuery
	 * @returns {Promise<AssetSnapshot[]>}
	 */
	async _query(assetQuery) {
		const client = new RestClientV5({
			key: assetQuery.apiKey,
			secret: assetQuery.apiSecret,
		})
		const assetInfoRes = await this.rateLimiter.exec(() => client.getAssetInfo())
		if (!assetInfoRes?.result?.spot?.assets) throw new Error('Result does not contain assets. result: ' + JSON.stringify(assetInfoRes))

		/** @type {Promise<AssetSnapshot>[]} */
		const promises = []
		for (const asset of assetInfoRes.result.spot.assets) {
			// skip if coin is not watched or amount is 0
			const assetInfo = this.assetInfoByBybitSymbol.get(asset.asset)
			if (!assetInfo || !asset?.free || asset?.free === '0') continue

			promises.push(new Promise(async resolve => {
				const price = await this.priceAggregator.getPrice(assetInfo.code)
				const amount = new Decimal(asset.free)
				resolve(AssetSnapshot.fromJson({
					name: `${humanize(this.chain)} ${humanize(assetInfo.code)} Token`,
					code: assetInfo.code,
					chain: this.chain,
					type: assetInfo.type,
					state: enums.AssetState.LIQUID,
					quantity: amount,
					usd_value: amount.mul(price),
					usd_value_per_quantity: price,
				}))
			}))
		}

		return await Promise.all(promises)
	}
}