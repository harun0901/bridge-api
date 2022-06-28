// Project: umi-server-marketplace
// by: Leo Pawel 	<https://github.com/galaxy126>
//     olesatanya 	<https://github.com/olesatanya>
// Technical Stack
// TypeScript Version: 4.3.4

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
process.env.NODE_NO_WARNINGS = "1";

import express from 'express';

import cors from 'cors'
import ApiV1, { initApp } from './api-v1'
import setlog from './setlog';
// import Model from './Model'
import { PORT } from './constants';

process.on("uncaughtException", (err:Error) => setlog('exception',err));
process.on("unhandledRejection", (err:Error) => setlog('rejection',err));

export default async ()=>{
	try {
		await initApp();
		/* await Redis.connect(); */
		const app = express()
		// const httpServer  = http.createServer(app)
		// initSocket(httpServer )
		app.use(cors({
			origin: function(origin, callback){
				return callback(null, true)
			}
		}))
		app.use(express.json())
		app.use(ApiV1);
		let time = +new Date()
		await new Promise(resolve=>app.listen({ port:PORT, host:'0.0.0.0' }, ()=>resolve(true)))
		setlog(`Started HTTP service on port ${PORT}. ${+new Date()-time}ms`)
		return app
	} catch (error) {
		setlog("init", error)
		process.exit(1)
	}
}