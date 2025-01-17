import * as enums from '../enums.js'
import PriceAggregator from '../price-aggregator.js'
import { createLogger, BaseService } from '../utils/index.js'
import { AssetGroup, AssetQuery, AssetSnapshot, AssetScannerConfig } from '../models/index.js'

/**
 * @typedef {import('rate-limiter').RateLimiterOpts} RateLimiterOpts
 * @typedef {import('../utils').ServiceParamDict} ServiceParamDict
 */

const logger = createLogger('AssetScanner')

export default class BaseAssetScanner extends BaseService {

	/** @protected @type {string[]} */							static requiredQueryKeys = [ 'addr' ]
	/** @type {enums.Chain} */									chain
	/** @protected @type {PriceAggregator} */					priceAggregator
	/** @protected @type {AssetScannerConfig} */				config

	/**
	 * @param {PriceAggregator} priceAggregator
	 * @param {AssetScannerConfig} config
	 */
	constructor(priceAggregator, config) {
		const rateLimitOpts = {}
		if (config?.rateLimiterKey) {
			rateLimitOpts.instanceKey = config.rateLimiterKey
		} else if (config?.endpoint) {
			rateLimitOpts.instanceKey = config.endpoint
		} else if (config?.apiKey) {
			rateLimitOpts.instanceKey = config.apiKey
		}
		super(config, rateLimitOpts)
		this.chain = config.chain
		this.priceAggregator = priceAggregator
		this.config = config

		logger.debug(`Asset scanner created - scanner: ${this.constructor.name}, chain: ${this.chain}`)
	}

	/**
	 * @public
	 * @param {AssetQuery} query
	 * @returns {Promise<AssetSnapshot[]>}
	 */
	async query(query) {
		await this.initPromise

		// check if all required query keys are present
		if (!Array.isArray(this.constructor.requiredQueryKeys)) {
			logger.warn(`Missing requiredQueryKeys or requiredQueryKeys is not an array - scannerClass: ${this.constructor.name}`)
		} else {
			this.constructor.requiredQueryKeys.forEach(key => {
				if (query[key] === undefined || query[key] === null) throw new Error(`Missing query field: ${key} - scannerClass: ${this.constructor.name}`)
			})
		}

		// Do query
		const startTime = new Date().getTime()
		logger.debug(`Start querying asset - scanner: ${this.constructor.name}, queryId: ${query.id}`)
		const checkStuckLogInterval = setInterval(() => {
			logger.info(`Still querying asset - scanner: ${this.constructor.name}, timeUsed: ${(new Date).getTime() - startTime}ms, queryId: ${query.id}`)
		}, 10000)
		/** @type {AssetSnapshot[]} */
		let snapshots = await Promise
			.race([
				this._query(query),
				new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000 * 60 * 1)), // 1 minute. TODO: put this in config
			])
			.catch(err => { throw new Error(`Failed querying asset - scanner: ${this.constructor.name}, queryId: ${query.id}, error: ${err.message}`) })
			.finally(() => clearInterval(checkStuckLogInterval))

		// Patch results
		snapshots = await Promise.all(snapshots.map(async snapshot => {
			const apiSecret = query.apiSecret? query.apiSecret.substring(0, 3) + '*'.repeat(query.apiSecret.length - 3) : undefined

			// inject extra tags
			snapshot.tag_map = { ...(query.extra_tag_map ?? {}), ...(snapshot.tagMap ?? {}) }
			// patch chain
			snapshot.chain = snapshot.chain ?? this.chain
			// patch account_id
			snapshot.account_id = snapshot.account_id ?? query.addr ?? query.apiKey ?? apiSecret
			// patch group_id
			snapshot.group_id = snapshot.group_id ?? query.group_id ?? await AssetGroup.getDefault()?.id
			// patch query_id
			snapshot.query_id = snapshot.query_id ?? query.id

			return snapshot
		}))

		logger.debug(`Finished querying asset - scanner: ${this.constructor.name}, timeUsed: ${(new Date).getTime() - startTime}ms, queryId: ${query.id}`)
		return snapshots
	}

	/**
	 * @protected
	 * @abstract
	 * @param {AssetQuery} assetQuery
	 * @returns {Promise<AssetSnapshot[]>}
	 */
	async _query(assetQuery) {
		throw new Error('not implemented')
	}
}