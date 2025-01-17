import RateLimiter from 'rate-limiter'
import { createLogger } from './logger.js'
import * as errors from '../errors.js'

/**
 * @typedef {import('rate-limiter').RateLimiterOpts} RateLimiterOpts
 * 
 * @typedef ServiceParamDict
 * @property {string} [rateLimiterKey]
 * @property {string} [endpoint]
 * @property {string} [apiKey]
 */

const logger = createLogger('BaseService')

/**
 * @abstract
 */
export default class BaseService {

	// TODO: service name for debugging
	/** @protected @type {string[]} */			static requiredParamKeys = []
	/** @protected @type {ServiceParamDict} */	paramDict = {}
	/** @protected @type {RateLimiter} */		rateLimiter
	/** @protected @type {boolean} */			isInitialized = false
	/** @protected @type {boolean} */			isClosed = false
	/** @protected @type {Promise<void>} */		initPromise

	/**
	 * @param {ServiceParamDict} paramDict
	 * @param {RateLimiterOpts} rateLimiterOpts
	 */
	constructor(paramDict, rateLimiterOpts) {
		this.rateLimiter = RateLimiter.getInstance({
			...rateLimiterOpts,
			log: (msg) => logger.warn(msg),
		})
		this.paramDict = paramDict
	}

	/**
	 * @public
	 */
	async init() {
		if (this.isInitialized) return await this.initPromise
		this.isInitialized = true

		// init promise
		this.initPromise = new Promise(async (resolve, reject) => {
			// check if all required params exist
			for (const requiredParamKey of this.constructor.requiredParamKeys) {
				if (this.paramDict[requiredParamKey] === undefined) {
					throw new errors.MissingParamError(this.constructor.name, requiredParamKey)
				}
			}
			try {
				await this._init()
			} catch (err) {
				logger.error(`Service init failed - name: ${this.constructor.name} - error: ${err.message}`)
				this.isInitialized = false
				this.initPromise = undefined
				return reject(err)
			}
			logger.info(`Service initialized - name: ${this.constructor.name}`)

			resolve()
		})

		return await this.initPromise
	}

	/**
	 * @protected
	 * @abstract
	 */
	async _init() {}

	/**
	 * @public
	 */
	async close() {
		this.rateLimiter.stop()
		this.isClosed = true
		logger.debug(`Service closed - name: ${this.constructor.name}`)
	}
}