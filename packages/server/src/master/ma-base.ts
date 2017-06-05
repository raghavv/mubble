/*------------------------------------------------------------------------------
   About      : Base class to be used to persist data in redis and master data verification
   
   Created on : Thu May 25 2017
   Author     : Gaurav Kulshreshtha
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

//import {RedisWrapper}       from './redis-wrapper'
import * as lo                from 'lodash'
import * as semver            from 'semver'

import {RunContextServer}     from '../rc-server'
import {ModelConfig,MasterModelConfig}          from './ma-model-config'  
import {MasterRegistryMgr}    from './ma-reg-manager'
import {assert , masterDesc,
        log , concat ,
        MaType      }         from './ma-util'

const LOG_ID : string = 'MasterBase'
function mbLog(...args : any[] ) : void {
  log(LOG_ID , ...args)
}
 
export namespace Master{

  export type IDType =  object | number | string

  export function modelType(config : ModelConfig) {
    return function(target : any){
        // Make Registry of all the models here
        MasterRegistryMgr.addMaster(target , config)
    }
  }

  // Check if these are required or not
  export enum FieldType {
    PRIMARY ,
    MANDATORY ,
    OPTIONAL ,
    AUTO 
  }

  export function field(type ?: FieldType ) {
    return function(target : any , propertyKey : string) {
      if(!type) type = FieldType.MANDATORY
      MasterRegistryMgr.masterField(target , propertyKey , type)
    }
  }

  export function primaryKey() {
    return function(target: any, propertyKey: string) {
      MasterRegistryMgr.masterField(target , propertyKey , FieldType.PRIMARY)
    }
  }

  // Class level rule
  export function validityRule(validFromFld : string , validTillFld : string) {
    
    return function(target : any){
        
    }
  }
  
  // field level Rule
  export function versionField(prototype : any , propKey : string) {
    function versionFieldCheck(rec : any) {
      const mastername : string = prototype.constructor.name
      const val : any = rec[propKey]
      assert( semver.valid(val)!=null , masterDesc(mastername,propKey,val) , 'is not a version field' )
      
      /*
      if(MaType.isString(val) && semver.valid(val)) return
      throw (new Error(concat('property',propKey , 'value' , val , 'is not a version field')))
      */
    } 
    MasterRegistryMgr.fieldValidationRule(prototype , propKey , versionFieldCheck)
  }
  
  export function withinList(list : any[]) {
    return function(prototype : any , propKey : string) {
      
      function withinListCheck(rec : any) {
        const mastername : string = prototype.constructor.name
        const val : any = rec[propKey]
        assert( val!=null , masterDesc(mastername,propKey,val) , 'is null')
        assert( list.indexOf(val)!= -1 , masterDesc(mastername,propKey,val) , 'not in list', list.toString() )
      }
      MasterRegistryMgr.fieldValidationRule(prototype , propKey , withinListCheck)
    }
  }
  
  export function objPropertiesIn(list : string[]) {
    return function(prototype : any , propKey : string) {
      assert(list.length >0 ,'Object Properties is empty' )
      
      function objPropertiesInCheck(rec : any) {
        const mastername : string = prototype.constructor.name
        const val : any = rec[propKey]
        
        assert( MaType.isObject(val)!=null , masterDesc(mastername,propKey,val) , 'is not an object')
        for(const key of Object.keys(val)){
          assert(list.indexOf(key)!==-1 , masterDesc(mastername,propKey,val) , 'key:',key , 'is missing in the properties list',list)
        }
      }
      MasterRegistryMgr.fieldValidationRule(prototype , propKey , objPropertiesInCheck)
    }
  }

  export function objectStructure(struc : any) {
    return function(prototype : any , propKey : string) {
      
      function objectStructureCheck(rec : any) {
        const mastername : string = prototype.constructor.name
        const val : any = rec[propKey]
        assert( val!=null , masterDesc(mastername,propKey,val) , 'is null')
        // This is wrong. Have to check each field manually , recursively
        //assert( val instanceof struc , masterDesc(mastername,propKey,val) , 'is null')  
      } 
      MasterRegistryMgr.fieldValidationRule(prototype , propKey , objectStructureCheck)

    }
  }
  
  export function inRange(minVal : number , maxVal : number , defaultIgnoreVal ?: number) {
    return function(prototype : any , propKey : string) {
      
      function inRangeCheck(rec : any) {
        const mastername : string = prototype.constructor.name
        const val : number = rec[propKey]
        if(defaultIgnoreVal!=null && val===defaultIgnoreVal) return
        assert( val>=minVal && val<=maxVal , masterDesc(mastername,propKey,val) , 'not in range', minVal , maxVal )
      } 
      MasterRegistryMgr.fieldValidationRule(prototype , propKey , inRangeCheck)
    }
  }
  

  export type ForeignKeys = {[master : string] : {[masterField : string] : string }}
  

  export function getDefaultConfig (segment : object , startVersion : string , endVersion : string , fk ?: ForeignKeys )  : ModelConfig {
    //const masConfig : ModelConfig = new MasterModelConfig('Sample')
    
    const masConfig : ModelConfig = new class TestModelConfig extends MasterModelConfig {
      constructor(){
        super('Sample')
        this.segment = segment
        this.startVersion = startVersion
        this.endVersion = endVersion
        this.fkConstrains = fk
      }
    }
    //return {segment : segment , startVersion : startVersion , endVersion : endVersion , fkConstrains : fk }
    return masConfig
  }
}

export class MasterBase {

  @Master.field()
  public insertTS : number
  
  @Master.field()
  public modTS  : number
  
  /*
  @field()
  public modUid  : number
  
  @field()
  public modLoc  : number
  */
  
  @Master.field()
  public deleted : boolean
  
  public _mastername : string
  
  public _rc         : RunContextServer
  

  constructor(context : RunContextServer , masterName : string){
    // RunContextServer should have the redis instance 
    this._rc = context
    this._mastername = masterName
  }

  /**
   * Get the Id (Primary key) of this model object. 
   * Will be calculated from the id fields provided.
   */
  public getId() : Master.IDType{
    return {}
  }
  
  public getIdFromObj(src : object) : Master.IDType {
    return {}
  }

  /**
   * Get (Hash) key for staorage in Redis for this master model
   */
  public getHashKey() : string {
    // Todo : define const for keys
    return 'MASTER_REDIS_'+'DATA'+'_'+this._mastername
  }
  
  /**
   * Load the model object from redis
   */
  async get(id : Master.IDType) {
    
  }

  async insert() {

  }

  async  update(selectCrit : object ) : Promise<any> {

  }

  async remove(id ?: Master.IDType) {}

  
  async list(selectCrit : object) : Promise<Array<object>> {
    return Promise.resolve([])
  }

  async count (selectCrit : object) : Promise<number> {
    return Promise.resolve(1)
  }

  verify (rc : RunContextServer , oldObj : object , nObj : object) : boolean {
    return true
  }

    // Each master can override this
  public verifyAllDependency (context : RunContextServer , masterCache : Map<string , {[pk : string] : object}> ) : (string | undefined) {
    return 
  }
  
}






