/// <reference types="@orca-so/whirlpools-sdk/node_modules/@solana/web3.js" />
export const TOKEN_PROGRAM_ID: solanaWeb3.PublicKey;
export default class BaseSolanaAssetScanner extends BaseAssetScanner {
    /** @type {solanaWeb3.Connection} */ connection: solanaWeb3.Connection;
    /** @type {Map<string, number>} */ decimalsByAddr: Map<string, number>;
    /** @protected @type {Map.<string, splTokenRegistry.TokenInfo>} */ protected tokenRegistryByAddr: Map<string, splTokenRegistry.TokenInfo>;
    allTokenList: splTokenRegistry.TokenInfo[];
    /**
     * @protected
     * @param {solanaWeb3.Context} context
     * @returns {Promise<Date>}
     */
    protected getDatetimeFromContext(context: solanaWeb3.Context): Promise<Date>;
    /**
     * Get SPL token decimals from cache. On miss, retrieve from chain by getTokenSupply().
     *
     * @protected
     * @param {solanaWeb3.PublicKey | string} mintOrAddr
     * @returns {Promise<number>}
     */
    protected getSplTokenDecimals(mintOrAddr: solanaWeb3.PublicKey | string): Promise<number>;
}
import * as solanaWeb3 from "@solana/web3.js";
import BaseAssetScanner from "../base.js";
import * as splTokenRegistry from "@solana/spl-token-registry";
