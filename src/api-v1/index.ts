// by: Leo Pawel 	<https://github.com/galaxy126>
// web router / rest & socket / RPC interface / session management

require("dotenv").config()
import * as express from 'express'
// import { parse as uuidParse } from 'uuid'
// import { now } from '@src/utils/helper'
// import cache from '../utils/cache'
// import { isValidCode } from '@src/utils/crc32'
import setlog from '../setlog'
import { BigNumber, ethers } from 'ethers'
import { now } from '../utils/helper'
import axios from 'axios'
import { block_blockNumber, block_setBlockNumber, Prices } from '../Model'
import { MAXGASLIMIT, PRIVKEY, SYMBOL, TESTNET, ZEROADDRESS } from '../constants'

const router = express.Router()
const testnet = TESTNET
const networks = require(__dirname + '/../../../bridge/src/config/networks' + (testnet ? '.testnet' : '') + '.json')
const prices = {} as {[coin: string]: number}

const I = (n:string|number|BigNumber) => BigNumber.from(String(n))

const bridgeAbi = [
	"event Deposit(address token, address from, uint amount, uint targetChain)",
	"function transfer(uint[][] memory args) external payable"
]

const chainIds = {} as {[id:number]:string}
const gasPrices = {} as {[chain:string]:number}
const tokens = {} as {[chain:string]:{[contract:string]:string}}

for (let k in networks) {
	chainIds[networks[k].chainId] = k
	tokens[k] = {}
	for (let m in networks[k].tokens) {
		const t = networks[k].tokens[m]
		tokens[k][t.contract || ZEROADDRESS] = m
	}
}

export const initApp = async () => {
	try {
		setlog("initialized Application")
		const rows = await Prices.find().toArray()
		for (let i of rows) {
			prices[i.coin] = i.price
		}
		cron()
	} catch (error) {
		setTimeout(cron, 60000)
	}
}

const cron = async () => {
	try {
		await checkSessions()
		await checkPrices()
		const cs = [SYMBOL, 'ETH', 'BNB']
		const txs = {} as {[chain:string]:TxObject[]}
		for (let i of cs) {
			await checkChain(i, txs)
		}
		for (let k in txs) {
			if (txs[k].length>0) await processTxs(k, txs[k])
		}
	} catch (error) {
		setlog('cron', error)
	}
	setTimeout(cron, 60000)
}

const checkSessions = async ():Promise<void> => {
	
}

// native coin price
const getBasePrice = async () => {
	return 10
}

export const checkPrices = async () => {
	const pairs:{[key:string]:string} = {
		ETH: 'ETHUSDT',
		BNB: 'BNBUSDT',
	}
	try {
		for(let coin in pairs) {
			const result:any = await axios('https://api.binance.com/api/v3/ticker/price?symbol='+pairs[coin])
			if (result!==null && result.data && result.data.price) {
				const updated = now()
				const price = Number(result.data.price)
				await Prices.updateOne({coin}, {$set: {coin, price, updated}}, {upsert:true})
				prices.ETH = price
			}
			
			await new Promise(resolve=>setTimeout(resolve,500))
		}
		prices[SYMBOL] = await getBasePrice()
		const json = {
			"jsonrpc": "2.0",
			"method": "eth_gasPrice",
			"params": [] as string[],
			"id": 0
		}
		const gas = await axios.post(networks[SYMBOL].rpc, json, {headers: {'Content-Type': 'application/json'}})
		if (gas?.data && gas?.data?.result) gasPrices[SYMBOL] = Math.ceil(Number(gas.data.result)/1e9)

		const ethGas = await axios.post(networks.ETH.rpc, json, {headers: {'Content-Type': 'application/json'}})
		if (ethGas?.data && ethGas?.data?.result) gasPrices.ETH = Math.ceil(Number(ethGas.data.result)/1e9)

		const bnbGas = await axios.post(networks.BNB.rpc, json, {headers: {'Content-Type': 'application/json'}})
		if (bnbGas?.data && bnbGas?.data?.result) gasPrices.BNB = Math.ceil(Number(bnbGas.data.result)/1e9)
	} catch (error) {
		setlog('checkPrices', error)
	}
}

const checkChain = async (chain:string, txs:{[chain:string]:TxObject[]}) => {
	try {
		const provider = new ethers.providers.JsonRpcProvider(networks[chain].rpc)
		const bridge = new ethers.Contract(networks[chain].bridge, bridgeAbi, provider)
		const depositEvent = bridge.filters.Deposit()
		const latest = await provider.getBlockNumber()
		const height = await block_blockNumber(chain)
		const limit = 1000
		let start = height || latest - 1
		while(start<latest) {
			let end = start + limit
			if (end > latest) end = latest
			setlog("scan " + chain, start + '-' + end, true)
			let events = await bridge.queryFilter(depositEvent, start, end)
			for (let i of events) {
				const target = Number(i.args[3].toHexString())
				const targetChain = chainIds[target]
				txs[targetChain] ??= []
				txs[targetChain].push({
					tx: i.transactionHash,
					chain,
					token: i.args[0],
					from: i.args[1],
					value: i.args[2].toHexString(),
				})
			}
			if (events.length>0) setlog('bridge-' + chain, 'events: ' + events.length)
			start = end
			await block_setBlockNumber(chain, end + 1)
		}
	} catch (error) {
		setlog("checkChain " + chain, error)
	}
}

const processTxs = async (chain:string, txs:TxObject[]) => {
	try {
		const provider = new ethers.providers.JsonRpcProvider(networks[chain].rpc)
		const wallet = new ethers.Wallet(PRIVKEY, provider)
		const bridge = new ethers.Contract(networks[chain].bridge, bridgeAbi, wallet)

		const gasPrice = I(Math.round(gasPrices[chain] * 1e9))
		const feeEther = Number(gasPrice.mul(I(MAXGASLIMIT))) / 1e18
		const priceEth = prices[chain]
		const count = txs.length
		const limit = 100
		let start = 0
		while (start < count) {
			let end = start + limit
			if (end > count) end = count
			const params = [] as Array<[token:string, to:string, amount:string, tx:string]>
			for (let k=start; k<end; k++) {
				const token = tokens[txs[k].chain]?.[txs[k].token]
				const targetToken = networks[chain].tokens[token]
				if (token && targetToken && prices[token]) {
					const decimals = targetToken.decimals
					const fee = I(Math.round(feeEther * priceEth * 10 ** decimals / prices[token]))
					const value = I(txs[k].value)
					if (value.gt(fee)) {
						params.push([
							targetToken.contract || ZEROADDRESS,
							txs[k].from,
							value.sub(fee).toHexString(),
							txs[k].tx
						])
					}
				}
			}
			if (params.length) {
				const gasLimit = await bridge.estimateGas.transfer(params)
				const response = await bridge.transfer(params, {gasPrice , gasLimit})
				if (response && response.hash) {
					setlog('bridge-' + chain, response.hash)
				} else {
					setlog('bridge-' + chain, JSON.stringify(response))
				}
			}
			start = end
		}
	} catch (error) {
		setlog("processTxs " + chain, error)
	}
}

router.post('/', async (req:express.Request, res:express.Response) => {
	try {
		const { jsonrpc, method, params, id } = req.body as RpcRequestType
		const cookie = String(req.headers["x-token"] || '')
		const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress)

		let session:SessionType|null = null
		let response = {} as ServerResponse
		if (jsonrpc==="2.0" && Array.isArray(params)) {
			if (method_list[method]!==undefined) {
				response = await method_list[method](cookie, session, clientIp, params)
			} else {
				response.error = 32601
			}
		} else {
			response.error = 32600
		}
		res.json({ jsonrpc: "2.0", id, ...response })
	} catch (error:any) {
		setlog(req.originalUrl, error)
		if (error.code===11000) {
			res.json({error:19999})
		} else {
			res.json({error:32000})
		}
	}
})

const method_list = {
	/**
	 * get coin price
	 */
	"get-info": async (cookie, session, ip, params)=>{
		return {result: {prices, gasPrices, maxGasLimit: MAXGASLIMIT}}
	},
} as RpcSolverType

export default router