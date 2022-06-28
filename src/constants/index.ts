require("dotenv").config()
const isDev = process.env.NODE_ENV === 'development';

import * as LangEnUS from '../locales/en-US.json'
import * as LangZhCN from '../locales/zh-CN.json'
/**
 * multilingual 
 * @type key:value pair hashmap
 */
export const locales = {
    "en-US": LangEnUS,
    // "zh-CN": LangZhCN,
} as {[lang:string]:{[key:string]:string}}

/**
 * default locale
 * @type string
 */
export const DefaultLocale = "en-US"

/**
 * http port
 * @type number
 */
export const PORT = Number(process.env.HTTP_PORT || 80)
export const REDIS_URL = process.env.REDIS_URL || ''
export const MONGO_URL = process.env.MONGO_URL || ''
export const PRIVKEY = process.env.ADMIN_PRIVKEY || ''
export const TESTNET = process.env.TESTNET==='1'
export const SYMBOL = process.env.SYMBOL || ''
export const ZEROADDRESS = '0x0000000000000000000000000000000000000000'
export const MAXGASLIMIT = 1e5
