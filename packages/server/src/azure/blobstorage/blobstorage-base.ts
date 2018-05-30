/*------------------------------------------------------------------------------
   About      : Azure Blob Storage Base
   
   Created on : Wed May 16 2018
   Author     : Vishal Sinha
   
   Copyright (c) 2018 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

import {RunContextServer}   from '../../rc-server'
import {Mubble}             from '@mubble/core'
import * as storage         from 'azure-storage'
import * as mime            from 'mime-types'
import * as stream          from 'stream'
import * as path            from 'path'   

export class BlobStorageBase {
  static _blobstorage : storage.BlobService

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                      INITIALIZATION FUNCTION
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/
  static init(rc : RunContextServer, connString : string) {
    rc.isDebug() && rc.debug(rc.getName(this), 'Initializing Azure Blob Storage Service.')
    this._blobstorage = storage.createBlobService(connString)
  }

/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                            FUNCTIONS
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/
  static async uploadDataToBlobStorage(rc : RunContextServer, dataStream : stream.Readable, 
                                       fullPath: string, fileName: string, mimeType: string) {

    const traceId   = `uploadDataToBlobStorage : ${fileName}`,
          ack       = rc.startTraceSpan(traceId),
          pathArr   = fullPath.split('/'),
          container = pathArr.shift() as string,
          filePath  = `${pathArr.join('/')}/${fileName}`

    try {
      await new Promise((resolve, reject) => {

        rc.isDebug() && rc.debug(rc.getName(this), `createWriteStreamToBlockBlob ${container}/${filePath}`)
    
        dataStream.pipe(this._blobstorage.createWriteStreamToBlockBlob(container, filePath, (error : Error, result : any, response : storage.ServiceResponse) => {
          if(error) {
            rc.isError() && rc.error(rc.getName(this), `Error in createWriteStreamToBlockBlob ${container}/${filePath}`, error)
            reject(error)
          }
          if(response.isSuccessful) {
            rc.isStatus() && rc.status(rc.getName(this), `Succesfully uploaded ${container}/${filePath}`, result, response)
            resolve(true)
          }
          resolve(false)
        }))
      })
    } finally {
      rc.endTraceSpan(traceId, ack)
    }

    return filePath
  }

  static getWriteStream(rc: RunContextServer, container: string, file: string) {
    return this._blobstorage.createWriteStreamToBlockBlob(container, file)
    //   (err : Error, result : any, response : storage.ServiceResponse) => {
    //     if(err) {
    //       rc.isDebug() && rc.debug(rc.getName(this), 'Error response', response)
    //       rc.isError() && rc.error(rc.getName(this), `Error in Azure write stream (${file})`, err)
    //     }
    //   }
    // )
  }

  static getReadStream(rc: RunContextServer, container: string, file: string) {
    return this._blobstorage.createReadStream(container, file, {}, 
      (err : Error, result : any, response : storage.ServiceResponse) => {
        if(err) {
          rc.isDebug() && rc.debug(rc.getName(this), 'Error in Azure getReadStream response', response)
          rc.isError() && rc.error(rc.getName(this), `Error in Azure getReadStream (${file})`, err)
        }
      }
    )
  }
  

  static async listFiles(rc: RunContextServer, container: string, prefix ?: string) {

    const BS = this._blobstorage,
          fn = prefix ? BS.listBlobsSegmentedWithPrefix.bind(BS, container, prefix)
                      : BS.listBlobsSegmented.bind(BS, container),
          list: Array<storage.BlobService.BlobResult> = []
    
    let token = null
    do  {
      token = await this.listFilesInternal(fn, list, token)
      token && rc.isDebug() && rc.debug(rc.getName(this), 'Continuing... Current length', list.length)
    } while (token)

    return list
  }

  private static async listFilesInternal(fn: any, list: Array<storage.BlobService.BlobResult>, token : any) {
    const result = await Mubble.uPromise.execFn(fn, null, token, {
      maxResults: 5000
    })
    list.push(...result.entries)
    return result.continuationToken
  }

  static async setMetadata(rc : RunContextServer, container : string, fileName : string, metaKey : string, metaValue : string) {
    const traceId                                = `setMetadata : ${fileName} | ${metaKey} : ${metaValue}`,
          ack                                    = rc.startTraceSpan(traceId),
          metadata : {[index : string] : string} = {}

    metadata[metaKey] = metaValue

    try {
      const newMetadata = await new Promise((resolve, reject) => {
        this._blobstorage.setBlobMetadata(container, fileName, metadata, (error : Error, result : storage.BlobService.BlobResult, response : storage.ServiceResponse) => {
          if(error) {
            rc.isError() && rc.error(rc.getName(this), `Error in setting blob ${fileName} metadata (${metaKey} : ${metaValue}) : ${error.message}.`)
            reject(error)
          }
  
          if(response.isSuccessful) rc.isStatus() && rc.status(rc.getName(this), `Succesfully set blob ${fileName} metadata.`)
  
          resolve(result.metadata)
        })
      })

      return newMetadata
    } catch(err) {
      rc.isError() && rc.error(rc.getName(this), `Error in setMetadata : ${err}.`)
      return null
    } finally {
      rc.endTraceSpan(traceId, ack)
    }
  }

  static async getMetadata(rc : RunContextServer, container : string, fileName : string) {
    const traceId = `getMetadata : ${fileName}`,
          ack     = rc.startTraceSpan(traceId)

    try {
      const metadata = await new Promise((resolve, reject) => {
        this._blobstorage.getBlobMetadata(container, fileName, (error : Error, result : storage.BlobService.BlobResult, response : storage.ServiceResponse) => {
          if(error) {
            rc.isError() && rc.error(rc.getName(this), `Error in getting blob ${fileName} metadata : ${error.message}.`)
            reject(error)
          }

          resolve(result.metadata)
        })
      })

      return metadata
    } catch(err) {
      rc.isError() && rc.error(rc.getName(this), `Error in getMetadata : ${err}.`)
      return {}
    } finally {
      rc.endTraceSpan(traceId, ack)
    }
  }

  static async getFileBuffer(rc : RunContextServer, container : string, fileName : string) {
    const traceId   = `downloadDataFromBlobStorage : ${fileName}`,
          ack       = rc.startTraceSpan(traceId)

    try {
      const readableStream = this._blobstorage.createReadStream(container, fileName, (error : Error, result : storage.BlobService.BlobResult, response : storage.ServiceResponse) => {
        if(error) {
          rc.isError() && rc.error(rc.getName(this), `Error in creating Azure Blob Service write stream (${fileName}) : ${error.message}.`)
          throw(error) 
        }
      })

      const chunks   : Array<any> = [],
            response : Buffer     = await new Promise((resolve, reject) => {
        readableStream
        .on('error', (error : Error) => { 
          rc.isError() && rc.error (rc.getName(this), `ABS Read Stream : ${container}/${fileName}, Error : ${error.message}.`)
          reject(error) 
        })
        .on('data', (chunk : any) => {
            chunks.push(chunk)
        })
        .on('end', () => { 
          rc.isStatus() && rc.status(rc.getName(this), `Downloaded ${fileName} from Azure Blob Storage.`)
          resolve(Buffer.concat(chunks))
        })
      }) as Buffer

      return response
    } finally { 
      rc.endTraceSpan(traceId, ack)
    }
  }

}