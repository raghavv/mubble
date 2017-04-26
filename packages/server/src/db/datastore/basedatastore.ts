/*------------------------------------------------------------------------------
   About      : Access point from which all the _datastore functionalities are
                accessed. 
   
   Created on : Mon Apr 24 2017
   Author     : Akash Dathan
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

const datastore : any = require('@google-cloud/datastore')

import {RunContextServer} from '../../rc-server'
import {ERROR_CODES}      from './errorCodes'
import {googleInit}       from '../../gcp/googleInit'

export abstract class BaseDatastore {

  // Common fields in all the tables
  [index : string] : any
  _id              : Number | String
  createTS         : Number
  deleted          : Boolean
     
  // holds most recent values for create, modify or delete
  modTS            : Number
  modUid           : Number
  modLoc           : {lat : Number, long : Number}
    
  // Internal references
  private _datastore     : any
  private _namespace     : String       
  private _kindName      : String
  private _autoFields    : Array<String> = ['createTS', 'deleted', 'modTS', 'modUid', 'modLoc']
  private _indexedFields : Array<String> = ['createTS', 'deleted', 'modTS']
  private _childEntities : {
    [index : string] : { type : string, val : any, model : any}
  }

  //Functions that need to be over-ridden  
  abstract getChildEntities()                         : {[index : string] : { type : string, val : any, model : any}} 
  abstract getIndexedFields()                         : Array<String>
  abstract getUniqueConstraints()                     : Array<any>
  abstract setChildEntities(name : string, val : any) : void

  static async init(rc : RunContextServer) {
    let res = await googleInit(rc),
        datastoreClient
    if (res.doAuth) {
      datastoreClient = datastore ({
        projectId   : res.projectId,
        credentials : res.authKey
      })
    } else {
      datastoreClient = datastore ({
        projectId   : res.projectId
      })
    }
    return {datastoreClient : datastoreClient, namespace : res.namespace}
  }

  constructor(rc : any, kindName : String) {
    this._namespace     = rc.namespace
    this._datastore     = rc.datastore
    this._kindName      = kindName
    this._childEntities = this.getChildEntities()
    this._indexedFields = this._indexedFields.concat(this.getIndexedFields())
  }

/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                            BASIC DB OPERATIONS
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */   
 
/*------------------------------------------------------------------------------
  - Get by primary key
------------------------------------------------------------------------------*/                  
  protected async get(id : Number | String, ignoreRNF ?: Boolean, noChildren ?: Boolean) : Promise<Boolean> {
    const key = this.getDatastoreKey(id)

    let transaction : any

    try {
      if (!this._childEntities || this._childEntities === {} || noChildren) {   
        const entityRec = await this._datastore.get(key)

        if (entityRec.length === 0) {
          if (ignoreRNF) return true
          throw (ERROR_CODES.RECORD_NOT_FOUND)
        }

        this._id = this.getIdFromResult(entityRec[0])
        this.deserialize(entityRec[0])
        return true       
      } else {
        transaction = this._datastore.transaction()
        await transaction.run()
        await this.getWithTransaction (key, transaction, ignoreRNF)
        await transaction.commit()
        return true
      }
    }
    catch (err) {
      // apiInfo.log('_datastore.get [' + err.code + ']', err.message || err)
      if (transaction) await transaction.rollback()
      throw(err)
    }
  }

/*------------------------------------------------------------------------------
  - Insert to datastore 
------------------------------------------------------------------------------*/ 
  protected async insert(insertTime ?: Number, ignoreDupRec ?: Boolean, noChildren ?: Boolean) : Promise<Boolean> {
    return await this.insertInternal(null, insertTime, ignoreDupRec, noChildren)
  }

/*------------------------------------------------------------------------------
  - Insert a child, provided the parent key 
------------------------------------------------------------------------------*/ 
  protected async insertChild(parentKey : any, insertTime ?: Number, ignoreDupRec ?: Boolean, noChildren ?: Boolean) : Promise<Boolean> {
    return await this.insertInternal (parentKey, insertTime, ignoreDupRec, noChildren)
  }

/*------------------------------------------------------------------------------
  - Insert a multiple objects in a go. provided, the objects are in an array
------------------------------------------------------------------------------*/ 
  protected async bulkInsert(recs : Array<any>, noChildren ?: Boolean, insertTime ?: Number, ignoreDupRec ?: Boolean) : Promise<Boolean> {
    const transaction = this._datastore.transaction()

    try {
      await transaction.run()

      for( let i in recs) {
        this.deserialize(recs[i])
        await this.setUnique ()
        await this.insertWithTransaction(null, transaction, insertTime, ignoreDupRec )
      }
      await transaction.commit()
      return true
    }
    catch(err) {
      // apiInfo.log ('datastore.bulkInsert [' + err.code + ']', err.message || err)
      await transaction.rollback()
      for (let i in recs) { 
        this.deserialize(recs[i])
        await this.deleteUnique() 
      }
      throw(ERROR_CODES.GCP_ERROR)
    }
  }

/*------------------------------------------------------------------------------
  - Update
------------------------------------------------------------------------------*/ 
  protected async update(id : Number | String, updRec : any, ignoreRNF ?: Boolean) : Promise<Boolean> {
    const transaction = this._datastore.transaction()

    try {
      await transaction.run()
      await this.updateWithTransaction(id, updRec, transaction, ignoreRNF )
      await transaction.commit()
      return true
    } 
    catch (err) {
      await transaction.rollback()
      throw(new Error(ERROR_CODES.GCP_ERROR))
    }
  }

/*------------------------------------------------------------------------------
  - Update a multiple objects in a go
  - Input should be an an array of objects to be updated
  - The object should contain its ID in the "_id" parameter
------------------------------------------------------------------------------*/ 
  protected async bulkUpdate(updRecs : Array<any>, insertTime ?: Number, ignoreRNF ?: Boolean) : Promise<Boolean>{
    const transaction = this._datastore.transaction()

    try {
      await transaction.run()
      for(let rec of updRecs) {
        await this.updateWithTransaction(rec._id, rec, transaction, ignoreRNF)
      } 
      await transaction.commit()
      return true
    }
    catch (err) {
      // apiInfo.log ('datastore.bulkUpdate [' + err.code + ']', err.message || err)
      await transaction.rollback()
      throw(ERROR_CODES.GCP_ERROR)
    }   
  }

/*------------------------------------------------------------------------------
  - Soft Delete
  - The 'deleted' param will be set as true
  - The unique param is deleted, if set
  - Optional params to be modified can be provided
------------------------------------------------------------------------------*/ 
  protected async softDelete(id : Number | String, params : any) : Promise<Boolean> {
    const transaction = this._datastore.transaction()
  
    if(!params) params = {}   
    params.deleted = true
    try {
      await transaction.run()
      await this.updateWithTransaction (id, params, false, transaction)
      await this.deleteUnique()
      await transaction.commit()
      return true
    } 
    catch (err) {
      // apiInfo.log ('_datastore.softDelete [' + err.code + ']', err.message || err)
      await transaction.rollback()
      throw(ERROR_CODES.GCP_ERROR)
    }
  }
  
/*------------------------------------------------------------------------------
  - Get ID from result
  - ID is not returned while getting object or while querying
------------------------------------------------------------------------------*/
  protected getIdFromResult(res : any) : Number | string {
    const key = res[this._datastore.KEY].path
          
    return key[key.length - 1]
  }




/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                            UTILITY FUNCTIONS
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */   
  // A quick way to get auto columns to ignore when listing records
  // toString() {
  //   const obj = {}
    
  //   mu(_).some((val, key) => {
  //     if (key.substr(0, 1) === '_') return
  //     if (this.__autoFields.indexOf(key) !== -1) return
  //     obj[key] = val
  //   })
    
  //   return this._kindName + '#' + this._id + '==>' + mu(obj).toString()
  // }
  


/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                            INTERNAL FUNCTIONS
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

  private async getWithTransaction(key : Array<any>, transaction : any, ignoreRNF ?: Boolean) : Promise<void> {
    const entityRec  = await transaction.get(key)

    if (!entityRec.length) {
      if (!ignoreRNF) throw(ERROR_CODES.RECORD_NOT_FOUND)
      return
    }

    this._id = this.getIdFromResult(entityRec[0])
    this.deserialize(entityRec[0])
    
    for (const childEntity  in this._childEntities) {
      const model = this._childEntities[childEntity].model,
            query = this._datastore.createQuery(this._namespace, model._kindName).hasAncestor(key),
            val   = await this._datastore.runQuery(query)

      if (this._childEntities[childEntity].type === 'object') {
        const dataModel = new model.constructor()
        
        dataModel.getWithTransaction(val[0][0][this._datastore.KEY], ignoreRNF, transaction)
        this.setChildEntities(childEntity, dataModel.serialize())
      } else {
        const resArr    = [],
              dataModel = new model.constructor()

        for (let i in val[0]) {
          dataModel.getWithTransaction(val[0][i][this._datastore.KEY], ignoreRNF, transaction)
          resArr.push(dataModel.serialize())
        }
        this.setChildEntities(childEntity, resArr)
      }
    }
  }

  private async insertInternal(parentKey : any, insertTime ?: Number, ignoreDupRec ?: Boolean, noChildren ?: Boolean) : Promise<Boolean> {
    const transaction  = this._datastore.transaction(),
          _datastoreKey = (parentKey) ? this.getDatastoreKey('', this._kindName, parentKey.path) : this.getDatastoreKey()  

    try {
      await this.setUnique ()
      if ((!this._childEntities || this._childEntities === {} || noChildren)) { 
        const newRec = this.getInsertRec(insertTime)

        await this._datastore.insert({key: _datastoreKey, data: newRec})
        this._id = _datastoreKey.path[_datastoreKey.path.length - 1]
        return true
      } else {
        await transaction.run()
        await this.insertWithTransaction(parentKey, transaction, insertTime, ignoreDupRec)
        await transaction.commit()
        return true
      }
    } catch (err) {
      // apiInfo.log ('_datastore.insert [' + err.code + ']', err.message, err)
      if (transaction) await transaction.rollback()
      await this.deleteUnique ()
      if (err.toString().split(':')[1] !== ' entity already exists') {
        throw(ERROR_CODES.GCP_ERROR)
      } else {
        if (ignoreDupRec) {
          // apiInfo.log('_datastore.insert: Duplicate record exists, ignoring error; Key = ' + JSON.stringify(_datastoreKey))
          return true
        }
        throw(ERROR_CODES.RECORD_ALREADY_EXISTS)
      }
    }
  }

  private async insertWithTransaction(parentKey : any, transaction : any, insertTime ?: Number, ignoreDupRec ?: Boolean) : Promise<Boolean>{
    const newRec = this.getInsertRec(insertTime)
          
    let datastoreKey = (parentKey) ? this.getDatastoreKey(null, this._kindName, parentKey.path) : this.getDatastoreKey()

    if (!this._id) { // If we already have a key, no need to allocate
      const key = await transaction.allocateIds(datastoreKey, 1) 

      this._id        = key[0][0].path[key[0][0].path.length - 1]
      datastoreKey = key[0][0]
    }

    transaction.save({key: datastoreKey, data: newRec})

    // Check for Child Entities
    for (let childEntity in this._childEntities) {
      const type       = this._childEntities[childEntity].type,
            val        = this._childEntities[childEntity].val,
            dsObjArray = (type === 'array') ? val : [val] // Put in an array if 'object'

      for( let dsObj of dsObjArray) {
        if(!(dsObj instanceof BaseDatastore)) {
          const model = this._childEntities[childEntity].model,
                obj   = new model.constructor()

          dsObj = obj.deserialize(dsObj)
        }
        await dsObj.insertWithTransaction(insertTime, ignoreDupRec, datastoreKey, transaction)
      }
    }
    return true
  }

  private async updateWithTransaction (id : Number | String, updRec : any, transaction : any, ignoreRNF ?: Boolean) : Promise<void>{
    const key = this.getDatastoreKey(id)

    await this.getWithTransaction(key, transaction, ignoreRNF)
    Object.assign(this, updRec)
    const newRec = this.getUpdateRec()
    transaction.save({key: key, data:newRec})
  }

/*------------------------------------------------------------------------------
  - Serialize is towards Datastore. Need to convert it to Data format
------------------------------------------------------------------------------*/
  private serialize(value : any) : Array<any> { 
    const rec = []

    for (let k in value) { 
      let val = value[k]
      if (k.substr(0, 1) === '_' || val === undefined || val instanceof Function) continue
      if (val && typeof(val) === 'object' && val.serialize instanceof Function) {
        val = val.serialize()
      }
      
      if(!(k in this._childEntities)){
        rec.push ({ name: k, value: val, excludeFromIndexes: (this._indexedFields.indexOf(k) === -1) })
      }
    }
    return rec
  }

/*------------------------------------------------------------------------------
  - Assign the values of the object passed to the respective fields
------------------------------------------------------------------------------*/
  private deserialize(value : any) : void {
    
    for (let prop in value) { 
      let val     = value[prop],
          dVal    = this[prop]
      
      if (prop.substr(0, 1) === '_' || val === undefined || val instanceof Function) continue
      
      if (dVal && typeof(dVal) === 'object' && dVal.deserialize instanceof Function) {
        this[prop] = dVal.deserialize(val)
      } else {
        this[prop] = val
      }
    }
  }
  
/*------------------------------------------------------------------------------
  - Records are to be converted to a format accepted by datastore
  - 'insertRec' can be a model rec or a normal object
  - The whole model class along with fixed params defined in datastore is
    taken if 'insertRec' is not provided 
------------------------------------------------------------------------------*/
  private getInsertRec(insertTime ?: Number, insertRec ?: any) : Array<any> {
    let retArr : Array<any> = []
        
    insertRec  = insertRec  || this
    insertTime = insertTime || Date.now()
    
    if(Array.isArray(insertRec)) {
      for(let rec of insertRec) {
        rec.createTS = insertTime
        rec.modTS    = insertTime
        retArr       = retArr.concat(this.serialize(rec))
      }
      return retArr
    } else {
      insertRec.createTS = insertTime
      insertRec.modTS    = insertTime
      return this.serialize(insertRec) 
    }
  }

/*------------------------------------------------------------------------------
  - Records are to be converted to a format accepted by datastore
------------------------------------------------------------------------------*/
  private getUpdateRec(updateRec ?: any, updateTime ?: Number) : Array<any> {
    let retArr : Array<any> = []
        
    if (!updateRec) updateRec = this
    
    if(Array.isArray(updateRec)) {
      for(let rec of updateRec) {
        rec.modTS     = updateTime || Date.now()
        retArr        = retArr.concat(this.serialize(rec))
      }
      return retArr
    } else {
      updateRec.modTS    = updateTime || Date.now()
      return this.serialize(updateRec) 
    }
  }
  
/*------------------------------------------------------------------------------
  - Create the datastore key from the id, kindName and parent key path
  - Key should be in the format
    {
      namespace : 'namespace',
      path      : [The complete path]
    }
------------------------------------------------------------------------------*/
  private getDatastoreKey(id ?: Number | String | null , _kindName ?: String, parentPath ?: Array<any>) {
    let datastoreKey

    if (!_kindName) _kindName = this._kindName
    
    if(!parentPath) {
      datastoreKey = this._datastore.key({
        namespace: this._namespace,
        path: ([_kindName, id]) 
      })
    } else {
      datastoreKey = this._datastore.key({
        namespace: this._namespace,
        path: (parentPath.concat([_kindName, id]))
      })
    }
    return datastoreKey
  }

/*------------------------------------------------------------------------------
  - Unique params are identified and set as a primary key in a different
    collection to avoid duplication
  - Unique params are defined in the model
------------------------------------------------------------------------------*/
  private async setUnique() : Promise<Boolean> {
    const uniqueConstraints = this.getUniqueConstraints() || []

    for( let constraint of uniqueConstraints) {
      let uniqueEntityKey = this.getDatastoreKey(constraint, this._kindName + '_unique')
      try {
        await this._datastore.insert({key: uniqueEntityKey, data: ''})
      }
      catch (err) {
        // apiInfo.warn('_datastore.setUnique: Error setting Unique; Key = ' + JSON.stringify(uniqueEntityKey))
        throw (err)
      }
    }
    for(let child in this._childEntities) {
      if (this._childEntities[child].model.prototype instanceof BaseDatastore)
        await this._childEntities[child].model.setUnique()
    }
    return true
  }

/*------------------------------------------------------------------------------
  - The unique keys are to be deleted when the corresponding entity is deleted
------------------------------------------------------------------------------*/
  private async deleteUnique() : Promise<Boolean> {
    const uniqueConstraints = this.getUniqueConstraints() || []

    for( let constraint of uniqueConstraints) {
      let uniqueEntityKey = this.getDatastoreKey(constraint, this._kindName + '_unique')
      try {
        await this._datastore.delete(uniqueEntityKey)
      } catch (err) {
        // apiInfo.error('_datastore.deleteUnique: Error deleting Unique; Key = ' + JSON.stringify(uniqueEntityKey))
        throw err
      }
    }
    for (let child in this._childEntities) {
      if (this._childEntities[child].model.prototype instanceof BaseDatastore)
        await this._childEntities[child].model.deleteUnique()
    }
    return true
  } 
}                   
