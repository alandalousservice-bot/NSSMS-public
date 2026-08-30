import type {PoolClient} from 'pg';
import {pool} from '../../infrastructure/db.js';
import {CompetitionError,mapCompetitionError} from './errors.js';
export async function transaction<T>(work:(c:PoolClient)=>Promise<T>):Promise<T>{const c=await pool.connect();try{await c.query('BEGIN');const value=await work(c);await c.query('COMMIT');return value}catch(error){await c.query('ROLLBACK');throw error instanceof CompetitionError?error:mapCompetitionError(error)}finally{c.release()}}
export async function audit(c:PoolClient,actor:string,action:string,type:string,id:string,metadata:object={}){await c.query('insert into audit_logs(actor_user_id,action,entity_type,entity_id,result_status,metadata) values($1,$2,$3,$4,$5,$6)',[actor,action,type,id,'SUCCESS',JSON.stringify(metadata)])}
export async function one(c:PoolClient,sql:string,values:unknown[],missing='The requested governed record was not found'){const r=await c.query(sql,values);if(!r.rowCount)throw new CompetitionError('NOT_FOUND',missing);return r.rows[0]}
