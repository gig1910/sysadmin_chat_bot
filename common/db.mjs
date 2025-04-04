import * as logger from './logger.mjs';
import * as pg     from 'pg';

let pool;

const db_user = (process.env.DB_USER);
const db_pass = (process.env.DB_PASS);
const db_host = (process.env.DB_HOST || '127.0.0.1');
const db_port = parseInt(process.env.DB_PORT, 10) || 5432;
const db_name = (process.env.DB_NAME);

if(!db_user){ throw new Error('Not defined ENV DB_USER'); }
if(!db_pass){ throw new Error('Not defined ENV DB_PASS'); }
if(!db_name){ throw new Error('Not defined ENV DB_NAME'); }

export async function open_db(){
	pool = new pg.default.Pool({
		statement_timeout: 100000,
		user:              db_user,
		host:              db_host,
		database:          db_name,
		password:          db_pass,
		port:              db_port,
	});
}

export async function close_db(){
	return pool.end();
}

export async function query(SQL, params){
	let client;
	try{
		client = await pool.connect();
		return await client.query(SQL, params);

	}catch(err){
		console.error(err);
		await logger.err(err);
		return null;

	}finally{
		client?.release();
	}
}
