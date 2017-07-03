/*------------------------------------------------------------------------------
   About      : Redis Instance wrapper
   
   Created on : Wed May 24 2017
   Author     : Gaurav Kulshreshtha
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

import * as lo                          from 'lodash'
import {RedisClient , createClient , 
        ResCallbackT , Multi}           from 'redis'
import {log , concat}                   from '../master/ma-util' 
import {RunContextServer}               from '../rc-server'



function redisLog(rc : RunContextServer , ...args : any[] ) : void {
  if(rc){
    rc && rc.isStatus() && rc.status(rc.getName(this), LOG_ID , ...args)
  }else{
    log(LOG_ID , ...args)
  }
}
const LOG_ID = 'RedisWrapper'

export type redis_command = 'del' | 'expire' | 'get' | 'incr' | 'mget' | 'mset' | 'psetex' | 'set' | 'setex' | 'ttl' | 'quit' | 'info' |
                            'hdel' | 'hget' | 'hgetall' | 'hmget' | 'hmset' | 'hset' | 'hincrby' | 'exists' |
                            'lpush' | 'rpush' | 'lrange' |
                            'zadd' | 'zrange' | 'zrevrange' | 'zrangebyscore' | 'zrem' |
                            'publish' | 'unsubscribe' | 
                            'watch' | 'unwatch' |
                            'scan' | 'sscan' | 'hscan' | 'zscan' |
                            'exists'

export const redis_commands : string[] =  
['del' , 'expire' , 'get' , 
 'hdel', 'hget',  'hgetall' , 'hmget', 'hmset' , 'hset' , 'hincrby' ,
 'zadd' , 'zrange' , 'zrevrange', 'zrangebyscore' , 'zrem',
 'exists'
 ]                            
                             
export type redis_async_func        = (...args : string[]) => void
export type redis_async_func_str    = (...args : string[]) => string[]
export type redis_async_func_arr    = (key: string , ...args : string[]) => string []
export type redis_async_func_map    = (key : string) => {[key:string] : string}  //Map<string , string>

export interface RedisCmds {
  
  del       : (...args : string[]) => void
  expire    : redis_async_func // check
  get       : (key: string ) => string
  incr      : redis_async_func // check
  mget      : (...args : string[]) => string []
  mset      : redis_async_func

  hdel      : (args : string[]) => void
  hget      : (key : string , field : string) => string 
  hgetall   : (key : string) => {[key:string] : string}
  hmget     : (key: string , ...args : string[]) => string []
  hmset     : (key: string , ...args : string[] ) => void
  hset      : (key: string , field : string , value : string ) => void
  hincrby   : (key : string , field : string, incr: number) => number 
  
  // z sorted set apis 
  zadd            : (key: string , option : string , ...scoreValuePairs : any[]  ) => number
  zrange          : (key: string , start : number , end : number , withscore ?: string ) => string[]
  zrem            : (key: string , ...keys : string[]  ) => void // check

  exists          : (key: string , ...keys : string[]  ) => void
  
}

export type RedisMulti = RedisCmds

function add(name : string)  {
  
  name = name.toLowerCase()
  
  const rw : any = RedisWrapper.prototype
  rw[name] = function(...params: any[]) {
    const _ : RedisWrapper  = this
    return _._execute(name as redis_command , params)
  }

  const rdMulti : any = RedisMultiWrapper.prototype
  rdMulti[name] = function(...params : any[]) {
    const _ : RedisMultiWrapper = this
    _.buff.push({cmdName : name , params : params})
    return (_.multi as any)[name](params)
  }  

  return add
}


export class RedisWrapper {

  public redis       : RedisClient
  public monitoring  : boolean = false
  public info        : { [index : string] : string } = {}
  static inited      : boolean = false
  constructor(private name : string, private rc : RunContextServer ){
    
  }
  // Unfortunately there is no static initializer like java in ts/js
  static init(rc : RunContextServer) : void {
    if(RedisWrapper.inited) return
    for(const cmd of redis_commands){
      // we can find all the function (name) of RedisClient from reflection . check signature type
      add(cmd)
    }
    RedisWrapper.inited = true
  }

  static async connect(rc : RunContextServer , name : string , url : string , options ?: {max_attempts ?: number , connect_timeout ?: number} ) : Promise<RedisWrapper>{
    
    const redisWrapper : RedisWrapper = new RedisWrapper(name , rc)
    await redisWrapper._connect(url , options)
    return redisWrapper
    
  }

  private async _connect (url : string , options ?: {max_attempts ?: number , connect_timeout ?: number}) {
    
    await new Promise ((resolve : any , reject : any) => {
      
      this.redis = createClient(url , options)
      this.redis.on("connect" , ()=>{
        redisLog(this.rc , this.name , 'connected to redis', url)
        resolve()
      })

      this.redis.on("error" , (error : any)=>{
        redisLog(this.rc , this.name , 'Could not connect to redis ',url , error)
        reject(error)
      })
    })
    await this._info()
  }

  async getRedisVersion() : Promise<string> {
    if(lo.size(this.info)){
      return this.info['redis_version']
    }
    
    redisLog(this.rc , 'checking redis version')
    await this._info()
    return this.info['redis_version']
  }

  async subscribe(events : string[] , callback : (channel : string , message : string) => void ) {
    
    return new Promise ((resolve : any , reject : any) => {
      
      this.redis.on('subscribe' , (channel : string , count : number)=>{
        redisLog(this.rc , this.name , ' subscribed to channel ' , channel , count)
        // resolve when ? all events are subscribed
        resolve()
      })

      this.redis.on('message' , (channel : string , message : string) => {
        callback(channel , message)
      })

      redisLog(this.rc , 'redis ',this.name , 'subscribing to channels ',events)
      this.redis.subscribe(events)

    })
  }
  

  async _info() {
    const _             = this,
          info : string = await this._execute('info'),
          ar : string[] = info.split('\n')

    ar.forEach(function(str) {
      const strParts : string[] = str.split(':')
      if (strParts.length !== 2) return
      _.info[strParts[0]] = strParts[1].trim()
    })
  }

  async _execute(cmd : redis_command , args ?: any[]) {
    const redisw = this.redis as any
    if(!redisw[cmd] || typeof redisw[cmd]!== 'function' ) throw Error('redis command '+cmd + ' invalid')
    
    return new Promise<any> ((resolve : any , reject : any) =>{
      
      redisw[cmd](args , (err : Error , res : any) =>{
        if(err){
          if(this.monitoring) redisLog(this.rc , this.name , cmd  , args , 'failed ',err)
          reject(err)
        }
        if(this.monitoring) redisLog(this.rc , this.name , cmd  , args , 'success ', res)
        resolve(res)
      })
    })

  }

  isMaster() : boolean {
    return this.info['role'] === 'master'
  }

  isSlave() : boolean {
    return this.info['role'] === 'slave'
  }

  async rwScan (pattern ?: string   , count ?: number) : Promise<Set<string>> {
    
    return this._scan('scan' , '' , 0 , pattern , count)
  }

  async rwSscan (key : string , pattern ?: string , count ?: number) : Promise<Set<string>> {
    
    return this._scan('sscan' , key , 0 , pattern , count)
  }

  async rwHscan(key : string , pattern ?: string , count ?: number) : Promise<Map<string , object >> {
    return this._hscan('hscan' , key , 0 , pattern , count)
  }
  
  async rwZscan(key : string , pattern ?: string , count ?: number) : Promise<Map<string , object>> {
    return this._hscan('zscan' , key , 0 , pattern , count)
  }

  async rwZrevrange (key: string , start : string|number  , end : string|number , withscore : boolean , offset ?: number, limit ?: number ) : Promise<Array<any>> {
    let redis_cmd = [key, start, end] as Array<any>
    if (withscore) redis_cmd.push ('WITHSCORES')
    if (limit) redis_cmd = redis_cmd.concat (['LIMIT', offset, limit])
    return this._execute ('zrevrange', redis_cmd) 
  }

  async rwZrangebyscore (key: string , start : string|number , end : string|number , withscore : boolean , offset ?: number, limit ?: number ) : Promise<Array<any>> {
    let redis_cmd = [key, start, end] as Array<any>
    if (withscore) redis_cmd.push ('WITHSCORES')
    if (limit) redis_cmd = redis_cmd.concat (['LIMIT', offset, limit])
    return this._execute ('zrangebyscore', redis_cmd) 
  }

  async _scan(cmd : redis_command , key : string , cursor : number ,  pattern ?: string , count ?: number , out ?: Set<string>) : Promise<Set<string> > {
    const args : any[] = cmd === 'scan' ? [cursor] : [key , cursor]
    if(pattern) args.push('MATCH' , pattern)
    if(count) args.push('COUNT' , count)

    const res : any[] = await this._execute(cmd , args)
    cursor  = Number(res[0])
    if(!out) out = new Set<string>()
    for (const mem of <string[]> res[1]) out.add(mem)
    if(cursor === 0) return out

    return this._scan(cmd , key , cursor , pattern , count , out)
  }

  async _hscan(cmd : redis_command , key : string , cursor : number ,  pattern ?: string , count ?: number , out ?: Map<string , object > ) : Promise<Map<string , object> > {
    const args : any[] = [key , cursor]
    if(pattern) args.push('MATCH' , pattern)
    if(count) args.push('COUNT' , count)

    const res : any[] = await this._execute(cmd , args)
    cursor  = Number(res[0])
    if(!out) out = new Map<string , object>()
    const resMapArr : string [] =  <string[]> res[1]
    for(let i=0 ; i<resMapArr.length ; i = i+2){
      out.set(resMapArr[i] , JSON.parse(resMapArr[i+1]))
    }
    if(cursor === 0) return out

    return this._hscan(cmd , key , cursor , pattern , count , out)
  }

  private async execMulti(batchOrMulti : Multi) : Promise<any[]> {
    const _ = this
          
    return new Promise<any[]>(function(resolve, reject) {
      
      batchOrMulti.exec(function(err, results : any[]) {
        if (_.monitoring)  redisLog (this.rc , 'multi/batch', {err}, 'results', results)
        if (err) return reject(err)
        resolve(results)
      })
    })
  }

  // This is not an async api
  publish(channel : string , data : any) {
    this.redis.publish(channel , data)
  }

  redisCommand() : RedisCmds {

    return (this as any as RedisCmds)
  }

  redisMulti() : RedisMulti {

    return (new RedisMultiWrapper(this) as any as RedisMulti)
  }

  async execRedisMulti(redisMulti : RedisMulti) : Promise<any[]> {
    
    this.rc.isAssert() && this.rc.assert(this.rc.getName(this), redisMulti instanceof RedisMultiWrapper , 'execRedisMulti can only exec redisMulti cmds')
    return this.execMulti( (redisMulti as any as RedisMultiWrapper).multi )
  }

  async close() {
    await this.redis.quit()
    redisLog(this.rc , 'closed redis connection ',this.name)
  }

}

class RedisMultiWrapper {
  public multi : Multi 
  public buff : any[] = []
  
  public constructor(private rw : RedisWrapper) {
    this.multi = rw.redis.multi()
  }

  public toString() : string {
    let tempBuf : string = ''
    this.buff.forEach(x=>{
      tempBuf += JSON.stringify(x) + '\n'
    })
    return tempBuf
  }
}


