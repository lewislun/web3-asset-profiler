import BaseNearAssetScanner from './base.js'
import { AssetQuery, AssetSnapshot, AssetInfo } from '../../models/index.js'
import { parseDecimal, humanize } from '../../utils/index.js'
import * as enums from '../../enums.js'

export default class NearNativeTokenScanner extends BaseNearAssetScanner {

	/** @type {number} */					static assetDecimals = 24
	/** @protected @type {AssetInfo} */		nativeAssetInfo

	/**
	 * @protected
	 */
	async _init() {
		await super._init()
		this.nativeAssetInfo = await AssetInfo.getNativeToken(this.chain)
	}

	/**
	 * @protected
	 * @param {AssetQuery} assetQuery
	 * @returns {Promise<AssetSnapshot[]>}
	 */
	async _query(assetQuery) {
		const [ acc, price ] = await Promise.all([
			this.rateLimiter.exec(() => this.client.account(assetQuery.addr)),
			this.priceAggregator.getPrice(this.nativeAssetInfo.code),
		])
		const balance = await acc.getAccountBalance()
		const liquidAmount = parseDecimal(balance.available, NearNativeTokenScanner.assetDecimals)

		/** @type {AssetSnapshot[]} */
		const results = []

		// Liquid amount
		if (balance.available) {
			results.push(AssetSnapshot.fromJson({
				name: `${humanize(this.chain)} Native Token`,
				code: this.nativeAssetInfo.code,
				chain: this.chain,
				type: enums.AssetType.NATIVE_TOKEN,
				state: enums.AssetState.LIQUID,
				quantity: liquidAmount,
				usd_value: liquidAmount.mul(price),
				usd_value_per_quantity: price,
			}))
		}

		return results
	}
}