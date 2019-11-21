/*------------------------------------------------------------------------------
   About      : Oracle DB client to interact with oracle DB server
   
   Created on : Thu Jun 20 2019
   Author     : Vishal Sinha
   
   Copyright (c) 2019 Obopay Mobile Technologies Pvt Ltd. All rights reserved.
------------------------------------------------------------------------------*/

import { 
				 Mubble,
				 format
			 }	               				from '@mubble/core'
import { RunContextServer }  	 	from '../../../rc-server'
import { ObmopBaseClient }      from '../obmop-base'
import { DB_ERROR_CODE }        from '../obmop-util'
import * as oracledb            from 'oracledb'

const STRING_TYPE 			 = 'string',
			DATE_FORMAT_STRING = '%yyyy%-%mm%-%dd% %hh%:%nn%:%ss%.%ms%'

/*------------------------------------------------------------------------------
   OracleDb Config
------------------------------------------------------------------------------*/

export type OracleDbConfig = oracledb.PoolAttributes

/*------------------------------------------------------------------------------
   OracleDb Client
------------------------------------------------------------------------------*/

export class OracleDbClient implements ObmopBaseClient {

	private clientPool  : oracledb.Pool
  private initialized : boolean		              = false
  private poolConfig  : oracledb.PoolAttributes

	constructor(rc : RunContextServer, config : OracleDbConfig) {
		rc.isDebug() && rc.debug(rc.getName(this), 'Constructing new OracleDbClient.', config)

		this.poolConfig = config
	}

	public async init(rc : RunContextServer) {
		rc.isDebug() && rc.debug(rc.getName(this), 'Initializing OracleDbClient.', this.poolConfig)

		this.clientPool = await new Promise<oracledb.Pool>((resolve, reject) => {
      oracledb.createPool(this.poolConfig, (err : oracledb.DBError, pool : oracledb.Pool) => {
        if(err) reject(err)
        resolve(pool)
      })
    })

		this.initialized = true
	}

	public async close(rc : RunContextServer) {
		if(!this.initialized) return

		rc.isDebug() && rc.debug(rc.getName(this), 'Closing OracleDbClient.')

		await this.clientPool.close()
		this.initialized = false
	}

	public async queryAll(rc : RunContextServer, table : string, fields : Array<string>) : Promise<Array<any>> {

		rc.isDebug() && rc.debug(rc.getName(this), 'Fetching everything from table, ' + table + '.')

		const fieldString = fields.join(', '),
					queryString = `SELECT ${fieldString} FROM ${table}`,
					result      = await this.queryInternal(rc, queryString)

		return this.convertResultArray(result)
	}

	public async query(rc       : RunContextServer,
										 table    : string,
										 fields   : Array<string>,
										 key      : string,
										 value    : any,
										 operator : string = '=') : Promise<Array<any>> {

		rc.isDebug() && rc.debug(rc.getName(this), 'Fetching from table, ' + table + ' with condition : ',
														 key, operator, value)

		const fieldString = fields.join(', '),
					queryString = `SELECT ${fieldString} FROM ${table} WHERE ${this.getConditionString(key, value, operator)}`,
					result      = await this.queryInternal(rc, queryString)

		return this.convertResultArray(result)
	}

	public async queryAnd(rc 				 : RunContextServer,
												table 		 : string,
												fields     : Array<string>,
												conditions : Array<{key : string, value : any, operator ?: string}>) : Promise<Array<any>> {

		rc.isDebug() && rc.debug(rc.getName(this), 'Fetching from table, ' + table + ' with conditions :', conditions)

		const fieldString	 		 = fields.join(', '),
					conditionStrings = conditions.map((condition) =>
															 this.getConditionString(condition.key, condition.value, condition.operator)),
					condition        = conditionStrings.join(' AND '),
					queryString      = `SELECT ${fieldString} FROM ${table} WHERE ${condition}`,
					result      		 = await this.queryInternal(rc, queryString)

		return this.convertResultArray(result)
	}

	public async insert(rc : RunContextServer, table : string, entity : Mubble.uObject<any>) {

		rc.isDebug() && rc.debug(rc.getName(this), 'Inserting into table, ' + table + '.', entity)

		const keys        = Object.keys(entity),
					values      = Object.values(entity),
					keysStr     = keys.join(', '),
					valuesStr   = (values.map((value) => this.getStringValue(value))).join(', '),
					queryString = `INSERT INTO ${table} (${keysStr}) VALUES (${valuesStr})`

		await this.queryInternal(rc, queryString)
	}

	public async update(rc 				 : RunContextServer,
											table 		 : string,
											updates    : Mubble.uObject<any>,
											queryKey   : string,
											queryValue : any) {

		rc.isDebug() && rc.debug(rc.getName(this),
														 `Updating ${table} with updates : ${updates} for ${queryKey} : ${queryValue}.`)

		const updateKeys = Object.keys(updates),
					changes    = [] as Array<string>,
					binds      = [] as Array<any>

		let c = 1

		for(const key of updateKeys) {
			changes.push(`${key} = :${c++}`)
			binds.push(updates[key])
		}

		const queryString = `UPDATE ${table} `
												+ `SET ${changes.join(', ')} `
												+ `WHERE ${queryKey} = :${c}`

		binds.push(queryValue)

		await this.bindsQuery(rc, queryString, binds)
	}

	public async delete(rc : RunContextServer, table : string, queryKey : string, queryValue : any) {
		rc.isDebug() && rc.debug(rc.getName(this), `Deleting from ${table}, ${queryKey} : ${queryValue}.`)

		const queryString = `DELETE FROM ${table} WHERE ${queryKey} = ${this.getStringValue(queryValue)}`

		await this.queryInternal(rc, queryString)
	}

/*------------------------------------------------------------------------------
	 PRIVATE METHODS
------------------------------------------------------------------------------*/
	
	private async queryInternal(rc : RunContextServer, queryString : string) : Promise<oracledb.Result<any>> {

		rc.isDebug() && rc.debug(rc.getName(this), 'queryInternal', queryString)

    if(!this.initialized) await this.init(rc)
    
    const connection = await this.clientPool.getConnection()

		try {
			const result = await new Promise<oracledb.Result<any>>((resolve, reject) => {

        connection.execute(queryString, (err : oracledb.DBError, result : oracledb.Result<any>) => {
          if(err) reject(err)
          resolve(result)
        })
			})
			
			return result
		} catch(e) {

			rc.isError() && rc.error(rc.getName(this), 'Error in executing query.', queryString, e)
			throw new Mubble.uError(DB_ERROR_CODE, e.message)
		} finally {
			await connection.close()
		}
	}

	private async bindsQuery(rc : RunContextServer, queryString : string, binds : oracledb.BindParameters) {

		rc.isDebug() && rc.debug(rc.getName(this), 'bindQuery', queryString, binds)

		if(!this.initialized) await this.init(rc)
    
		const connection = await this.clientPool.getConnection(),
					options    = { autoCommit : true }

		try {
			const result = await new Promise<oracledb.Result<any>>((resolve, reject) => {

				connection.execute(queryString, binds, options, (err : oracledb.DBError, result : oracledb.Result<any>) => {
          if(err) reject(err)
          resolve(result)
        })
			})
			
			return result
		} catch(e) {

			rc.isError() && rc.error(rc.getName(this), 'Error in executing query.', queryString, e)
			throw new Mubble.uError(DB_ERROR_CODE, e.message)
		} finally {
			await connection.close()
		}
	}

	private getStringValue(value : any) : string {
		if(value instanceof Date) {
			return `'${format(value, DATE_FORMAT_STRING)}'`
		}

		return `${typeof(value) == STRING_TYPE ? '\'' + value + '\'' : value}`
	}

	private convertResultArray(result : oracledb.Result<any>) : Array<any> {

		const metadata = result.metaData || [],
					rows     = result.rows || [],
					finArr   = []

		for(const row of rows) {
			const elem = {} as any

			for(const index in metadata) {
				elem[metadata[index].name.toLowerCase()] = row[index]
			}

			finArr.push(elem)
		}

		return finArr
	}

	private getConditionString(key : string, value : any, operator : string = '=') : string {
		return `${key} ${operator} ${this.getStringValue(value)}`
	}
}