/*------------------------------------------------------------------------------
   About      : Google Natural Processing - Entity Extraction
   
   Created on : Tue Sep 12 2017
   Author     : Christy George
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

const language : any = require('@google-cloud/language')

import * as lo                                    from 'lodash'
import {RunContextServer}                         from '../../rc-server'
import {GcloudEnv}                                from '../../gcp/gcloud-env'

export type GcpEntityInfo = {
  name          : string, 
  type          : string, 
  language      : string,
  wikipedia_url : string,
  salience      : number, 
  occurences    : number
}

export class GcpLanguageBase {

  static _language : any

/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                      INITIALIZATION FUNCTION
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */   
  static init(rc : RunContextServer, gcloudEnv : GcloudEnv) {
    if (gcloudEnv.authKey) {
      gcloudEnv.language = language ({
        projectId   : gcloudEnv.projectId,
        credentials : gcloudEnv.authKey
      })
    } else {
      gcloudEnv.language = language ({
        projectId   : gcloudEnv.projectId
      })
    }

    this._language = gcloudEnv.language
  }

  static async analyzeEntitiesInText (rc : RunContextServer, text: string) {
    const document = { 
      content: text, 
      type: 'PLAIN_TEXT' 
    }
    return this.analyzeEntitiesInternal (rc, document)
  }

  static async analyzeEntitiesInGcs (rc : RunContextServer, bucketName : string, fileName : string) {
    const document = {
      gcsContentUri: `gs://${bucketName}/${fileName}`,
      type: 'PLAIN_TEXT'
    }
    return this.analyzeEntitiesInternal (rc, document)
  }

  // TODO: Can support threshold as an argument.
  static async analyzeEntitiesInternal (rc : RunContextServer, document: any) : Promise<Array<GcpEntityInfo>> {
    const res      = await this._language.analyzeEntities ({document: document}) 
    rc.isDebug() && rc.debug (rc.getName (this), 'Entity Analysis [Text] => Language:', res[0].language, '/', res[0].entities.length, 'entries.')
    const entities = res[0].entities.map ((entityInfo: any) => {
      return { 
        name: entityInfo.name, type: entityInfo.type, language: res[0].language,
        wikipedia_url: entityInfo.metadata 
                    && entityInfo.metadata.wikipedia_url 
                    && entityInfo.metadata.wikipedia_url.replace ('https://en.wikipedia.org/wiki/', '') 
                    || '',
        salience: entityInfo.salience, occurences: entityInfo.mentions.length
      } as GcpEntityInfo
    })
    rc.isDebug() && this.findDuplicates (rc, entities)
    // NOTE: There are duplicates in name with different salience value.. We take the first..
    const uniqueEntities = lo.uniqBy (entities, 'name') as Array<GcpEntityInfo>
    rc.isStatus() && rc.status (rc.getName (this), 'Unique Entries:', uniqueEntities.length, '/', entities.length)
    return uniqueEntities
  }

  static findDuplicates (rc: RunContextServer, entities: Array<GcpEntityInfo>) {
    const uniq = entities.map ((eInfo: GcpEntityInfo) => {
      return { name: eInfo.name, count: 1, saliencies: [eInfo.salience], occurences: [eInfo.occurences] }
    }).reduce ((accum: any, obj: any) => { 
      const val = accum[obj.name] || { name: obj.name, count: 0, saliencies: [], occurences: []}
      val.count = val.count + obj.count
      val.saliencies.push (...obj.saliencies)
      val.occurences.push (...obj.occurences)
      accum[obj.name] = val
      return accum
    }, {})
    const dups = Object.keys (uniq).filter ((a: string) => uniq[a].count > 1)
    if (dups.length) rc.isDebug && rc.debug (rc.getName (this), '\t==>Duplicates:', JSON.stringify (dups))
  }
}