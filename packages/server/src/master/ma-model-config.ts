/*------------------------------------------------------------------------------
   About      : Model config interface and default Impl . Used to create master definition
   
   Created on : Mon Jun 05 2017
   Author     : Gaurav Kulshreshtha
   
   Copyright (c) 2017 Mubble Networks protected Limited. All rights reserved.
------------------------------------------------------------------------------*/
import {RunContextServer}     from '../rc-server'
import {Master}               from './ma-base'
import {MasterRegistry , 
        FieldInfo}            from './ma-registry'

import * as lo                from 'lodash'
import {concat , masterDesc , 
        assert , throwError } from './ma-util'

import {Mubble}               from '@mubble/core' 
        

export type MasterValidationRule = (rc : RunContextServer ,  reg : MasterRegistry , rec : any[]) => void
export const MasterTsField = 'modTs'

export abstract class ModelConfig {
  
  protected hasFileSource         : boolean = false
  protected cache                 : boolean = false
  protected segment              ?: {key : string , cols : string[]}
  protected fkConstrains          : Master.ForeignKeys = {}
  protected accompanyMasters      : string [] = []
  protected masterTsField         : string = MasterTsField
  protected cachedFields         ?: {fields :  string [] , cache : boolean} 
  protected destSynFields        ?: {fields :  string [] , cache : boolean} 
  protected srcValidationrules    : MasterValidationRule []

  public getMasterTsField() : string {
    return this.masterTsField
  }
  public getSrcValidationrules() : MasterValidationRule [] {
    return this.srcValidationrules
  }

  public getHasFileSource() {
    return this.hasFileSource
  }

  public getDependencyMasters() : string [] {
    let res : string[] = []
    res = res.concat(this.accompanyMasters)
          .concat(lo.keysIn(this.fkConstrains))
          .map(ma=>ma.toLowerCase())
    
    return lo.uniq(res)
  }

  public getForeignKeys() : Master.ForeignKeys {
    return lo.mapKeys(this.fkConstrains , (prop : any , parent: string)=>{
      return parent.toLowerCase()
    })
  }

  public getCached() : boolean {
    return this.cache
  }

  public getCachedFields() : {fields :  string [] , cache : boolean} {
    return this.cachedFields || {fields : [] , cache : false}
  }

  public getDestSynFields() : {fields :  string [] , cache : boolean} {
    return this.destSynFields || {fields : [] , cache : false}
  }

  public getSegment() : {key : string , cols : string[]} | undefined {
    return this.segment
  }
  
}

export class MasterModelConfig extends ModelConfig {
  
  public constructor(protected modConfigName : string){
    super()
    this.cachedFields =   {fields : [] , cache : false}
    this.destSynFields =  {fields : [] , cache : false}
    // Todo
    
    this.srcValidationrules = [fieldTypeCheck]
  }

}

function fieldTypeCheck(rc : RunContextServer ,  reg : MasterRegistry , records : any[]) {
  
  const autoCols : string [] = lo.clone(reg.autoFields) ,
        masterTsField : string = reg.config.getMasterTsField() ,
        fieldsMap : Mubble.uObject<FieldInfo> = lo.clone(reg.fieldsMap) ,
        optionalFields : string[] = lo.clone(reg.optionalFields),
        instance  : any = reg.masterInstance,
        pkeys : string [] = lo.clone(reg.pkFields),
        ids   : string [] = [],
        ownFields : string [] = lo.clone(reg.ownFields)
        

  records.forEach(rec => {
    
    // check all ids
    const idStr : string = reg.getIdStr(rec)
    assert(ids.indexOf(idStr) === -1 , reg.mastername , 'id is present more than once' , idStr , rec)
    ids.push(idStr)

    lo.forEach(rec  , (value : any , key : string  )=> {
      
      const fInfo : FieldInfo = fieldsMap[key]

      if(!fInfo) throwError (masterDesc(reg.mastername , key , value) ,'unknown field:' , key ,  'for pk',reg.getIdStr(rec))
      if(autoCols.indexOf(key) !== -1) throwError(masterDesc(reg.mastername , key , value) ,'can not set auto field' , key ,  reg.getIdStr(rec))
      

      // string , number , boolean , array check
      if(
      (typeof(value) === 'string' && fInfo.type !== 'string') ||  
      (typeof(value) === 'boolean' && fInfo.type !== 'boolean') || 
      (typeof(value) === 'number' && fInfo.type !== 'number') || 
      (Array.isArray(value) && fInfo.type !== 'array')   )
      
      throwError (reg.mastername , 'has invalid value for colum ' , key , rec , idStr , fInfo.type)
      
      // Object check
      if(!Array.isArray(value) && value && typeof(value) === 'object' && fInfo.type !== 'object') {

        throwError (reg.mastername , 'has invalid value for colum ' , key , rec , idStr , fInfo.type)

      }

      // PK Fields type can not object . Checked in verify

      // check PK and Mandatory Fields
      if(fInfo.constraint !== Master.FieldType.OPTIONAL) {
        //[null , undefined , '' , 0] check only allowed for OPTIONAL Fields
        if(fInfo.type !== 'boolean' && !value) throwError(reg.mastername , 'column ',key , 'can not be null/empty', rec , idStr)

        if(fInfo.type === 'array' && lo.isEmpty(value)) {

          throwError(reg.mastername , 'column ',key , 'can not be empty array', rec , idStr)
        
        }else if(fInfo.type === 'object' && lo.isEmpty(value)) {
          
          throwError(reg.mastername , 'column ',key , 'can not be empty object', rec , idStr)
        
        }

      }else{
        // set value of optional fields if not found
        if(value === undefined){
          
          rec[key] = value = instance[key]
          if(value === undefined) throwError(reg.mastername , 'default column value not set for column', key , rec)

        }
      }

      // todo : object field nested value can't be null or undefined
    })

    // check all the mandatory fields are present
    ownFields.forEach((field : string) =>{

      assert(optionalFields.indexOf(field)!=-1 ||  lo.hasIn(rec , field) , 'field',field , 'is missing in record ',idStr)
      
    })


  })      

  



}
