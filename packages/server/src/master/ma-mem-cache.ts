/*------------------------------------------------------------------------------
   About      : Master In Memory cache class required for destination sync
   
   Created on : Mon Jun 12 2017
   Author     : Gaurav Kulshreshtha
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/
import * as lo                from 'lodash'

import {RunContextServer}     from '../rc-server'

import {MaMap, StringValMap , 
        GenValMap , 
       MasterCache }          from './ma-types'
import {MasterBase , 
        MasterBaseFields }    from './ma-base'
import {MasterRegistry}       from './ma-registry'             
import {MasterRegistryMgr}    from './ma-reg-manager'
import {masterDesc , assert , 
        concat , log ,
        MaType ,
        FuncUtil }            from './ma-util'
             

const LOG_ID : string = 'MasterInMemCache'
function MaInMemCacheLog(rc : RunContextServer | null , ...args : any[] ) : void {
  if(rc){
    rc.isStatus() && rc.status(LOG_ID , ...args )
  }else{
    log(LOG_ID , ...args)
  }
}
function debug(rc : RunContextServer | null , ...args : any[] ) : void {
  if(rc){
    rc.isDebug && rc.debug(LOG_ID , ...args )
  }else{
    log(LOG_ID , ...args)
  }
}


export class SyncInfo  {
  
  ts            : number 
  seg           : object 
  dataDigest    : string
  modelDigest   : string

}


export class DigestInfo {
  
  fileDigest      : string
  modelDigest     : string 
  modTs           : number
  dataDigest      : string
  segDigestMap    : StringValMap  = {}

  public constructor(fDigest : string , modeldigest : string , ts : number , dDigest : string , segMap : StringValMap ) {
    this.fileDigest   = fDigest
    this.modelDigest  = modeldigest
    this.modTs        = ts 
    this.dataDigest   = dDigest
    this.segDigestMap = segMap
  }

  public static getDigest(val : any , masterKey : string) : DigestInfo {
    
    assert(lo.hasIn(val , 'fileDigest') && lo.hasIn(val , 'modelDigest') && lo.hasIn(val , 'modTs') && lo.hasIn(val , 'dataDigest') && lo.hasIn(val , 'segDigestMap') , 'DigestInfo ',val , 'is corrupt for master ',masterKey)
    assert( MaType.isString(val['fileDigest'])  && 
            MaType.isString(val['modelDigest'])  && 
            MaType.isNumber(val['modTs']) &&
            MaType.isString(val['dataDigest']) , 'DigestInfo ', val , 'is corrupt for master ',masterKey)

    return new DigestInfo(val['fileDigest'] , val['modelDigest'] , val['modTs'] , val['dataDigest'] , val['segDigestMap'])      
  }
}

export class MasterInMemCache {
  
  public cache               : boolean = false
  
  // records in sorted order
  public records             : any [] = []
  
  // hash key / record
  public hash                : GenValMap = {} 
  
  public modTSField          : string = MasterBaseFields.ModTs
  
  public digestInfo          : DigestInfo = new DigestInfo('','',0 , '' , {})
  //public lastUpdateTS        : number = lo.now()

  private getMaxTS() : number {
    return this.records.length ?  lo.nth(this.records , 0)[this.modTSField] : 0
  } 
  
  // This has to be saved for non -cache data
  public getMinTS() : number {
    return this.records.length ?  lo.nth(this.records , -1)[this.modTSField] : 0
  }

  public hasRecords() : boolean {
    return (this.records.length > 0)
  }

  public latestRecTs() : number {
    return this.digestInfo.modTs
  }

  public constructor(rc : RunContextServer , public mastername : string , data : GenValMap , dInfo : DigestInfo) {
    
    MaInMemCacheLog(rc , 'MasterInMemCache ',mastername)
    const registry : MasterRegistry = MasterRegistryMgr.getMasterRegistry(mastername)

    this.cache          = registry.config.getCached()
    this.modTSField     = registry.config.getMasterTsField()
    
    if(this.cache){
      const size : number = lo.size(data)
      if(size) assert(dInfo!=null , 'Digest Info Missing for master with data',mastername, size)
      else assert(dInfo==null , 'Digest Info present for master without data', dInfo, mastername)

      if(!size) {
        MaInMemCacheLog(rc , 'Nothing to populate in memory cache for master',mastername)
        return
      }
      this.digestInfo = dInfo
    }else{
      MaInMemCacheLog(rc , 'caching is disabled for master ',mastername)
      if(dInfo!=null) this.digestInfo = dInfo
      return
    }

    // Populate cache
    // Fields which needs to be cached
    const allCachedFields : string[] = lo.uniq(registry.cachedFields.concat(registry.autoFields)) 
    MaInMemCacheLog(rc , 'allCachedFields ', allCachedFields , 'destiSynFields', registry.destSyncFields )
    
    this.hash =  lo.mapValues(data , (val : any , key : string)=>{
      return lo.pick(val , allCachedFields)
    })
    
    // sort them by modTs field decending order
    this.records = lo.sortBy(lo.valuesIn(this.hash) , [this.modTSField]).reverse()
    assert(this.getMaxTS() === this.digestInfo.modTs , mastername, 'Digest Info data inconsistency ',this.getMaxTS() , this.digestInfo)

    // Freez the records
    this.records.forEach((rec : any)=>{ Object.freeze(rec)})
    
    MaInMemCacheLog(rc , 'MasterInMemCache loading finished',mastername, this.records)
  }

  public update(rc : RunContextServer , newData : GenValMap , dinfo : DigestInfo) : {inserts : number , updates : number} {
    
    MaInMemCacheLog(rc , 'update ',this.mastername , lo.size(newData) , dinfo , lo.size(this.hash))
    const registry : MasterRegistry = MasterRegistryMgr.getMasterRegistry(this.mastername)

    this.digestInfo = dinfo
    
    const result = {inserts : 0 , updates : 0 , cache : this.cache}
    if(!this.cache) return result
    
    // Fields which needs to be cached
    const allCachedFields : string[] = lo.uniq(registry.cachedFields.concat(registry.autoFields)) 
    
    const cacheNewdata : GenValMap = lo.mapValues(newData , (val : any , key : string)=>{

      return lo.pick(val , allCachedFields)
    })
    
    // Ensure that all the data available is modified
    lo.forEach(cacheNewdata , (newData : any , newPk : string) => {
      
      if(!lo.hasIn(this.hash , newPk)) {
        // new data
        result.inserts++
        return 
      } 
      assert(!lo.isEqual(cacheNewdata , this.hash[newPk]) , 'same data given for memory cache update ',newPk , newData)
      result.updates++
    })

    this.hash = lo.assign({} , this.hash , cacheNewdata)
    
    // sort them by modTs field decending order
    this.records = lo.sortBy(lo.valuesIn(this.hash) , [this.modTSField]).reverse()
    assert(this.getMaxTS() === this.digestInfo.modTs , this.mastername, 'Digest Info data inconsistency ',this.getMaxTS() , this.digestInfo)

    this.records.forEach((rec : any)=>{ Object.freeze(rec)})

    MaInMemCacheLog(rc , 'MasterInMemCache update finished', this.mastername , this.records)
    return result
  }

  public syncCachedData(rc : RunContextServer , syncHash : GenValMap , syncData : GenValMap , syncInfo : SyncInfo , purge : boolean ) {
    
    MaInMemCacheLog(rc , 'syncCachedData', syncHash , syncData , syncInfo , purge)
    const registry : MasterRegistry = MasterRegistryMgr.getMasterRegistry(this.mastername)
    
    // Get all the items >= syncInfo.ts
    const updates : any [] = [] ,
          deletes : any [] = [] ,
          data    : {mod : any [] , del : any []}    = {mod : updates , del : deletes}
    
    // Todo : Seg Impl
    this.records.forEach((rec : any)=>{
      // should this be just < . let = comparison be there to be on safe side
      if(rec[this.modTSField] <= syncInfo.ts) return

      if(rec[MasterBaseFields.Deleted] === true){
        deletes.push(registry.getIdObject(rec))
      }else{
        const destRec : any = lo.pick(rec , registry.destSyncFields )
        updates.push(destRec)
      }

    })

    assert( deletes.length!==0  || updates.length!==0 , 'syncData Invalid results', this.mastername , syncInfo , this.digestInfo )

    syncHash[this.mastername] = {purge : purge , ts : this.digestInfo.modTs , 
                                 seg : syncInfo.seg , dataDigest : this.digestInfo.dataDigest , 
                                 modelDigest : this.digestInfo.modelDigest  }
    
    syncData[this.mastername] = registry.masterInstance.syncGetModifications( rc , data )
    
    MaInMemCacheLog(rc , 'syncCachedData' , syncHash[this.mastername] , updates.length , deletes.length , updates , deletes  )
  }

  public syncNonCachedData(rc : RunContextServer , masterData : GenValMap , syncHash : GenValMap , syncData : GenValMap , syncInfo : SyncInfo , purge : boolean ) {
    
    MaInMemCacheLog(rc , 'syncNonCachedData', syncHash , syncData , syncInfo , purge)
    
    const registry : MasterRegistry = MasterRegistryMgr.getMasterRegistry(this.mastername)
    
    // Get all the items >= syncInfo.ts
    const updates : any [] = [] ,
          deletes : any [] = [] ,
          data    : {mod : any [] , del : any []}    = {mod : updates , del : deletes}
    
    lo.forEach(masterData , (pk : string , rec : any) => {
      
      // should this be just < . let = comparison be there to be on safe side
      if(rec[this.modTSField] <= syncInfo.ts) return

      if(rec[MasterBaseFields.Deleted] === true){
        deletes.push(registry.getIdObject(rec))
      }else{
        const destRec  : any = lo.pick(rec , registry.destSyncFields )
        updates.push(destRec)
      }

    })

    assert( deletes.length!==0  || updates.length!==0 , 'syncData Invalid results', this.mastername , syncInfo , this.digestInfo )

    syncHash[this.mastername] = {purge : purge , ts : this.digestInfo.modTs , 
                                 seg : syncInfo.seg , dataDigest : this.digestInfo.dataDigest , 
                                 modelDigest : this.digestInfo.modelDigest  }
    
    syncData[this.mastername] = registry.masterInstance.syncGetModifications( rc , data )

    MaInMemCacheLog(rc , 'syncNonCachedData' , syncHash[this.mastername] , updates.length , deletes.length , updates , deletes  )
  }

}