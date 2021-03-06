/*------------------------------------------------------------------------------
   About      : Class maintaing all the registry information (through decorators) of all masterbase models
   
   Created on : Wed May 31 2017
   Author     : Gaurav Kulshreshtha
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

import * as lo                from 'lodash'

import {RunContextServer}     from '../rc-server'
import {Master , MasterBase,
        MasterBaseFields }    from './ma-base'
import {MasterRegistry , 
        MASTERBASE , 
        FieldInfo }           from './ma-registry'  
import {ModelConfig , 
  MasterValidationRule}       from './ma-model-config'  
import {SourceSyncData}       from './ma-manager'
import {masterDesc , assert , 
        concat , log ,
        FuncUtil}             from './ma-util' 
import {MasterCache}          from './ma-types' 

import {Mubble}               from '@mubble/core'

          

const LOG_ID : string = 'MasterRegistryMgr'
function MaRegMgrLog(rc : RunContextServer | null , ...args : any[] ) : void {
  if(rc){
    rc.isStatus() && rc.status(LOG_ID , ...args )
  }else{
    //log(LOG_ID , ...args)
  }
}
function debug(rc : RunContextServer | null , ...args : any[] ) : void {
  if(rc){
    rc.isDebug && rc.debug(LOG_ID , ...args )
  }else{
    //log(LOG_ID , ...args)
  }
}


/**
 * Class Maintaining the Registry of all masters & their field types
 * All Methods are static 
 */
export class MasterRegistryMgr {

  static regMap : Mubble.uObject<MasterRegistry> = {}

  public static masterList() : string[] {
    return lo.keysIn(this.regMap).filter((mas : string)=> {
      return mas !== MASTERBASE
    })
  }
  
  static masterField (target : any , propKey : string , maType : Master.FieldType) : void {
    
    const master : string = target.constructor.name.toLowerCase() ,
          maReg : MasterRegistry = MasterRegistryMgr.getMasterRegistry(master , true)

    MaRegMgrLog(null , 'masterField ',master , propKey , Master.FieldType[maType])
    maReg.addField(propKey , maType ,target)

    if(maType === Master.FieldType.PRIMARY){
      assert(maReg.pkFields.indexOf(propKey) === -1 , 'pk added twice')
      maReg.pkFields.push(propKey)
    }
  }

  static addMaster (constructor : any , config : ModelConfig) : void {
    
    const master : string = constructor.name.toLowerCase() ,
          maReg : MasterRegistry = MasterRegistryMgr.getMasterRegistry(master)

    //MaRegMgrLog('addMaster ',master , constructor)
    MaRegMgrLog(null , 'addMaster config ',master , config)

    assert(maReg.config == null && maReg.masterInstance == null  , 'master ',master , 'registered twice')
    
    maReg.config    = config
    
    maReg.verifyInternal(constructor)
  }

  static fieldValidationRule (target : any , propKey : string , rule : (obj : any) => void ) : void {
    
    const master : string = target.constructor.name.toLowerCase() ,
          maReg : MasterRegistry = MasterRegistryMgr.getMasterRegistry(master , true)

    //MaRegMgrLog('fieldValidationRule ',master , propKey , rule)
    //maReg.rules.push(rule)
    maReg.addFieldRule(propKey , target , rule)

  }

  static getMasterRegistry(master : string , create : boolean = false) : MasterRegistry {
    
    if(MasterRegistryMgr.regMap[master]) return MasterRegistryMgr.regMap[master]
    
    if(create){
      MasterRegistryMgr.regMap[master] = new MasterRegistry(master)
    }

    return MasterRegistryMgr.regMap[master]
  }
  
  // Verify all the MasterRegistry for data sanity
  public static init (rc : RunContextServer ) : void {
    
    MaRegMgrLog(rc , '....Done....')
    
    // check masterbase registry exists
    const masterbaseReg : MasterRegistry =  MasterRegistryMgr.regMap[MASTERBASE]
    assert(masterbaseReg!=null , MASTERBASE , 'Registry missing')
    const masterbaseFields : string [] =  lo.keysIn(masterbaseReg.fieldsMap)
    
    const customMasters : MasterRegistry[] = lo.filter(MasterRegistryMgr.regMap , (maReg : MasterRegistry , master : string)=>{
      return master !== MASTERBASE
    })

    customMasters.forEach((maReg : MasterRegistry)=>{
      
      const maFields : string[] = lo.keysIn(maReg.fieldsMap)
      assert( lo.isEmpty (lo.intersection(masterbaseFields , maFields)) , maReg.mastername , 'has masterbase fields ',maFields , masterbaseFields)
      maReg.fieldsMap = lo.assignIn(maReg.fieldsMap , masterbaseReg.fieldsMap)
    })
    
    // verify all custom masters
    customMasters.forEach((maReg : MasterRegistry)=>{
      maReg.verify(rc)
    })
    
  }


  public static validateBeforeSourceSync (rc : RunContextServer , mastername : string , source : Array<object> , redisData : Mubble.uObject<object> , now : number ) : Promise<SourceSyncData> {
    
    const registry : MasterRegistry = this.getMasterRegistry(mastername)
    this.verifySourceRecords(rc , registry , source )

    //todo : accompny master check
    const sourceIdsMap : Mubble.uObject<object> = FuncUtil.maArrayMap<any>(source , (rec : any)=>{
      return {key : registry.getIdStr(rec) , value : rec}
    })
    

    return this.verifyModifications(rc , this.getMasterRegistry(mastername) , sourceIdsMap  , redisData , now)
  }

  public static verifyAllDependency (rc : RunContextServer , mastername : string , masterCache : MasterCache ) {
    
    MaRegMgrLog(rc , 'verifyAllDependency for master' , mastername )
    //if(lo.stubTrue()) return
    const registry : MasterRegistry = this.getMasterRegistry(mastername) ,
          fkConst  : Master.ForeignKeys = registry.config.getForeignKeys() ,
          selfData : Mubble.uObject<object> = masterCache[mastername] 
    //debug('fk for master',mastername , fkConst)

    lo.forEach(fkConst , (props : Mubble.uObject<string> , parent : string)=> {

      assert(lo.hasIn(masterCache , parent) , 'parent mastercache', parent , 'is missing for master',mastername)
      const parentData : Mubble.uObject<object> = masterCache[parent] 
      
      //debug('parent size ',lo.size(parentData))
      lo.forEach(props , (selfField : string , parentField : string)=>{
        //debug('selfField',selfField , 'parent', parentField , selfData)
      
        // verify self data field with parent data
        lo.forEach(selfData , (selfRec : any , pk : string)=>{
          //debug('selfRec',selfRec , 'pk',pk)
          const selfVal : any =  selfRec[selfField]
          assert(selfVal!=null , 'dependency field data null', selfRec , pk , selfField)

          const found : boolean = lo.some(parentData, (parentRec : any , parentPk : string)=>{
            return lo.isEqual(selfVal , parentRec[parentField])
          })
          assert(found , 'dependency field ',selfField ,'value:',selfVal, 'for master:',mastername, 'pk:',pk , 'not found in parent master:',parent , 'field:',parentField)
        })

      })

    }) 
  }
  
  // Private methods
  private static verifySourceRecords (rc : RunContextServer , maReg : MasterRegistry ,  source : Array<any>) {
    
    const mastername : string = maReg.mastername
    // remove deleted recoreds
    source  = source.filter((src)=>{
      
      if(src[MasterBaseFields.Deleted]) MaRegMgrLog(rc , 'master',mastername , 'verifySourceRecords', 'removed from src',maReg.getIdStr(src))
      return !(src[MasterBaseFields.Deleted] === true)
    })

    // Field Type sanity validation rules
    maReg.config.getSrcValidationrules().forEach( (srcValidationRule : MasterValidationRule)=>{
      MaRegMgrLog(rc , 'applying SrcValidation Rule rule ', srcValidationRule.name , 'on master', maReg.mastername)
      srcValidationRule(rc , maReg , source)
    })

    // class level Config Rules Check
    /*
    maReg.rules.forEach(  (configRule : (obj : any) => void ) => {
      MaRegMgrLog('applying Config rule ', configRule.constructor.name , 'on master', maReg.mastername)
      source.forEach((rec:any)=>{
        configRule(rec)
      })
    } )*/

    lo.valuesIn(maReg.fieldsMap).forEach((finfo : FieldInfo) => {

      finfo.rules.forEach((fieldRule : (obj : any) => void ) => {
        MaRegMgrLog(rc , 'applying Field rule ', fieldRule.name , 'on field', finfo.name, ' master', maReg.mastername)
        source.forEach((rec:any)=>{
          fieldRule(rec)
        })

      })

    })

  }
  
  private static async verifyModifications (rc : RunContextServer , registry : MasterRegistry , sourceIds : Mubble.uObject<object> , targetMap : Mubble.uObject<object> , now : number ) : Promise<SourceSyncData> {
    
    MaRegMgrLog(rc , 'verifyModifications' , registry.mastername ,'source size:' , lo.size(sourceIds) , 'target size:', lo.size(targetMap) )

    const config : ModelConfig = registry.config , 
          masTsField : string  = config.getMasterTsField() ,
          fldMap : Mubble.uObject<FieldInfo> = registry.fieldsMap ,
          ssd : SourceSyncData = new SourceSyncData(registry.mastername , sourceIds , targetMap , now) ,
          instanceObj : MasterBase = registry.masterInstance

    for(const pk in sourceIds){
      const srcRec : any = sourceIds[pk],
            ref : any   = targetMap[pk]
      
      if(!ref) {
        // this is an new record
        // check allow insert . allow all
        
        await instanceObj.verifyRecord(rc , srcRec )
        
        //if(lo.hasIn(fldMap , MasterBaseFields.Deleted )) srcRec[MasterBaseFields.Deleted] = false
        srcRec[MasterBaseFields.Deleted] = false
        srcRec[MasterBaseFields.CreateTs] = srcRec[masTsField] = now
        ssd.inserts[pk] = srcRec

      }else if (ref[MasterBaseFields.Deleted] || this.isModified(rc , registry , masTsField , ref , srcRec ) ){
        
        await instanceObj.verifyRecord(rc , srcRec , ref)

        //if(lo.hasIn(fldMap , MasterBaseFields.Deleted)) srcRec[MasterBaseFields.Deleted] = false
        srcRec[MasterBaseFields.Deleted] = false
        srcRec[masTsField] = now
        srcRec[MasterBaseFields.CreateTs] = ref[MasterBaseFields.CreateTs]

        ssd.updates[pk] = srcRec
      }
      
    }  
    
    // Check if there are any records deleted
    lo.forEach(targetMap , (ref : any , id : string)=>{
      // Ignore already deleted
      if(ref[MasterBaseFields.Deleted]) return
      
      const src : any = sourceIds[id]
      if(!src) {
        // This record is deleted
        const delRec : any = lo.cloneDeep(ref)
        
        delRec[MasterBaseFields.Deleted] = true
        delRec[masTsField] = now
        ssd.deletes[id] = delRec
      }
    } )
    
    return ssd
  }

  public static async verifySingleModification (rc : RunContextServer , registry : MasterRegistry , source : object , target : object | null , now : number ) : Promise<SourceSyncData> {
    
    MaRegMgrLog(rc , 'verifySingleModification' , registry.mastername ,'source' , source , 'target', target )

    const config : ModelConfig = registry.config , 
          masTsField : string  = config.getMasterTsField() ,
          fldMap : Mubble.uObject<FieldInfo> = registry.fieldsMap ,
          ssd : SourceSyncData = new SourceSyncData(registry.mastername , {} , {} , now) ,
          instanceObj : MasterBase = registry.masterInstance , 
          pk          : string  = registry.getIdStr(source) 

      const srcRec : any = source ,
            ref : any   = target
      
      if(!ref) {
        // this is an new record
        // check allow insert . allow all
        
        await instanceObj.verifyRecord(rc , srcRec)
        
        //if(lo.hasIn(fldMap , MasterBaseFields.Deleted )) srcRec[MasterBaseFields.Deleted] = false
        srcRec[MasterBaseFields.Deleted] = false
        srcRec[MasterBaseFields.CreateTs] = srcRec[masTsField] = now
        ssd.inserts[pk] = srcRec

      }else if (ref[MasterBaseFields.Deleted] || this.isModified(rc , registry , masTsField , ref , srcRec ) ){
        
        await instanceObj.verifyRecord(rc , srcRec , ref)

        //if(lo.hasIn(fldMap , MasterBaseFields.Deleted)) srcRec[MasterBaseFields.Deleted] = false
        srcRec[MasterBaseFields.Deleted] = false
        srcRec[masTsField] = now
        srcRec[MasterBaseFields.CreateTs] = ref[MasterBaseFields.CreateTs]

        ssd.updates[pk] = srcRec
      }
    
    return ssd
  }
  public static async deleteSingleMaster (rc : RunContextServer , registry : MasterRegistry , pk : string , target : object , now : number ) : Promise<SourceSyncData> {
    
    MaRegMgrLog(rc , 'deleteSingleModification' , registry.mastername , 'target', target )

    const config : ModelConfig = registry.config , 
          masTsField : string  = config.getMasterTsField() ,
          fldMap : Mubble.uObject<FieldInfo> = registry.fieldsMap ,
          ssd : SourceSyncData = new SourceSyncData(registry.mastername , {} , {} , now) ,
          instanceObj : MasterBase = registry.masterInstance 

    const delRec : any = lo.cloneDeep(target)
    
    delRec[MasterBaseFields.Deleted] = true
    delRec[masTsField] = now
    ssd.deletes[pk] = delRec

    return ssd
  }

  public static verifyRedisDataWithJson(rc : RunContextServer , registry : MasterRegistry , jsonSourceIds : Mubble.uObject<object> , redisDataMap : Mubble.uObject<object> ) : SourceSyncData {

    function getJsonRecFromRedisData(redisRec : any) : any {
      const redisRecClone = lo.cloneDeep(redisRec)
      
      delete redisRecClone[MasterBaseFields.Deleted]
      delete redisRecClone[MasterBaseFields.CreateTs]
      delete redisRecClone[masTsField]
      return redisRecClone
    }

    const ssd : SourceSyncData = new SourceSyncData(registry.mastername , jsonSourceIds , redisDataMap , Date.now()) ,
          config : ModelConfig = registry.config , 
          masTsField : string  = config.getMasterTsField()
    
    
    lo.forEach(redisDataMap , (redisRec : any , pk : string )=>{

      const jRef : any = jsonSourceIds[pk]
      if(!jRef) {
        // record not present in json
        if(redisRec[MasterBaseFields.Deleted]) return // record is deleted
        ssd.inserts[pk] = getJsonRecFromRedisData(redisRec)
      }else{
        if(redisRec[MasterBaseFields.Deleted]){
          if(!jRef[MasterBaseFields.Deleted]) ssd.deletes[pk] = jRef
        }else{
          if(this.isModified(rc , registry , masTsField , redisRec , jRef)) ssd.updates[pk] = getJsonRecFromRedisData(redisRec)
        }
      }

    })

    lo.forEach(jsonSourceIds , (jRef : any , pk: string)=>{
      const redisRec : any = redisDataMap[pk]
      if(!redisRec) ssd.deletes[pk] = jRef
    })
    return ssd
  }

  private static isModified(rc : RunContextServer , registry : MasterRegistry , masterTs : string , ref : any , src : any ) : boolean {
    
    //debug('isModified', 'all:',allFields , 'own:',ownFields , 'masterTs:',masterTs)
    let res : boolean = registry.ownFields.some((key : string) : boolean => {
      if(key === masterTs) return false 
      const val = src[key] , refVal = ref[key] 
      if(registry.optionalFields.indexOf(key ) == -1 && lo.isUndefined(val)) return true

      return !lo.isEqual(val , refVal)

    } )
    //if(res) debug('isModified results 1',src , ref)
    if(res) return true

    res = lo.some(ref , (refval : any , refKey : string)=>{
      return registry.allFields.indexOf(refKey) === -1
    })
    //if(res) debug('isModified results 2',src , ref)
    
    return res
  }

}
