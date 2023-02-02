'use strict'

import Decimal from 'decimal.js'

import { startOrInheritTransaction, schema } from '../utils/index.js'
import * as types from '../types.js'
import BaseModel from './base.js'

/**
 * @typedef {import('objection').Transaction} Transaction
 */

export default class AssetFlow extends BaseModel {
	static tableName = 'asset_flows'

	/** @type {import('objection').JSONSchema} */
	static get jsonSchema() {
		return {
			type: 'object',
			required: [
				'usd_value',
			],
			properties: {
				id: schema.primaryIndex,
				from_group_id: schema.refId,
				to_group_id: schema.refId,
				usd_value: schema.decimal,
				executed_at: schema.datetime,
			}
		}
	}

	/** @type {import('objection').RelationMappings} */
	static get relationMappings() {
		return {
			toGroup: {
				relation: BaseModel.BelongsToOneRelation,
				modelClass: BaseModel.AssetGroup,
				join: {
					from: `${this.tableName}.to_group_id`,
					to: `${BaseModel.AssetGroup.tableName}.id`,
				},
			},
			fromGroup: {
				relation: BaseModel.BelongsToOneRelation,
				modelClass: BaseModel.AssetGroup,
				join: {
					from: `${this.tableName}.from_group_id`,
					to: `${BaseModel.AssetGroup.tableName}.id`,
				},
			},
		}
	}

	/**
	 * @public
	 * @param {types.AssetGroupSpecifier} fromGroupSpecifier
	 * @param {types.AssetGroupSpecifier} toGroupSpecifier
	 * @param {Decimal.Value} usdValue
	 * @param {object} [opts={}]
	 * @param {Date} [opts.time]
	 * @param {Transaction} [opts.trx]
	 * @returns {Promise<AssetFlow>}
	 */
	static async recordFlow(fromGroupSpecifier, toGroupSpecifier, usdValue, opts = {}) {
		return await startOrInheritTransaction(async (trx) => {
			const [ fromGroupId, toGroupId ] = await Promise.all([
				await BaseModel.AssetGroup.getGroupId(fromGroupSpecifier, { trx }),
				await BaseModel.AssetGroup.getGroupId(toGroupSpecifier, { trx }),
			])

			if (!fromGroupId && !toGroupId) throw new Error('Must provide either fromGroup or toGroup.')

			return await AssetFlow.query(opts?.trx).insert({
				from_group_id: fromGroupId,
				to_group_id: toGroupId,
				usd_value: new Decimal(usdValue).toString(),
				executed_at: opts?.time?.toISOString(),
			})

		}, opts?.trx)
	}
}

BaseModel.AssetFlow = AssetFlow