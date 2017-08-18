/*------------------------------------------------------------------------------
   About      : Google Trace Apis
   
   Created on : Tue Aug 08 2017
   Author     : Gaurav Kulshreshtha
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/
import * as lo                      from 'lodash'  
import {
        format,
        Mubble
       }                            from '@mubble/core'

import {GcloudEnv}                  from '../gcloud-env'
import {RunContextServer,
        RCServerLogger}             from '../../rc-server'

const hashMap : Mubble.uObject<number> = {}

function hash(str : string) : number {
  var hash = 0, i, chr;
  if (str.length === 0) return hash;
  for (i = 0; i < str.length; i++) {
    chr   = str.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0
  }
  return Math.abs(hash)
}

function getHash(api : string) : number {
  if(hashMap[api]) return hashMap[api]
  const num = hash(api)
  hashMap[api] = num 
  return num 
}

let k = 0
function getCounter() : number{
  k++
  if(k>10000) k=0
  return k
}

export function getTraceId(api : string) : string {
  let str : string = ''+getHash(api)+''+Date.now()+''+getCounter() ,
      hexStr = str , 
      len = 32 - hexStr.length
  // Fill random hex-base number to make total length 32
  for(let i=0;i<len;i++){
    hexStr += lo.random(0 , 15).toString(16)
  }    
  return hexStr
}

function getDummyLabels() {
  if(Math.random()>0.5) return undefined
  return {
    gk1 : lo.random(1,10).toString(),
    gk2 : lo.random(11,20).toString(),
    err : "err"+lo.random(0,1),
    test : Math.random()>0.5 ? "testing" : undefined
  }
}

export function createDummyTrace(rc : RunContextServer) {
    const rand = lo.random(1,5),
    name = `six-feet-under${rand}`,
    apiDur = lo.random(0 , rand*1000),
    labels : any = getDummyLabels(),
    trace  = {
      projectId : TraceBase.projectId ,
      traceId   : getTraceId(name) ,
      spans     : [
        {
          spanId    : "1" ,
          kind      : 'RPC_SERVER',
          name      : name ,
          startTime : format(new Date(Date.now()- apiDur) , '%yyyy%-%mm%-%dd%T%hh%:%MM%:%ss%.%ms%000000Z' , 0) ,
          endTime   : format(new Date() , '%yyyy%-%mm%-%dd%T%hh%:%MM%:%ss%.%ms%000000Z', 0),
          labels    : labels
        }
      ]
    }
    //if(labels) (trace.spans[0] as any)["labels"] = labels
    return trace
}


export function dummyTrace(rc : RunContextServer){
  
  for(let i=0 ; i<2 ; i++){
    const trace = createDummyTrace(rc)
    rc.isDebug() && rc.debug(rc.getName(this), trace)
    TraceBase.sendTraceInternal(rc , trace)
  }
}


export class TraceBase {
  
  private static authClient : any 
  private static cloudTrace : any
  public  static projectId  : string  
  
  public static async init(rc : RunContextServer, gcloudEnv : GcloudEnv) {
    
    this.projectId = gcloudEnv.projectId

    var google = require('googleapis')
    this.authClient =  await new Promise((resolve , reject)=>{
      
      google.auth.getApplicationDefault(function(err : any, authClient : any) {
      if (err) {
        console.error('trace authentication failed: ', err);
        reject(err)
      }
      if (authClient.createScopedRequired && authClient.createScopedRequired()) {
        var scopes = ['https://www.googleapis.com/auth/cloud-platform'];
        authClient = authClient.createScoped(scopes);
      }
      resolve(authClient)
    })

    })
    
    var google = require('googleapis')
    this.cloudTrace = google.cloudtrace('v1')
  } 

  public static sendTrace(rc : RunContextServer , logger : RCServerLogger, apiName : string){
    this.sendTraceInternal(rc , this.createTrace(rc , logger , apiName))
  }

  public static sendTraceInternal(rc : RunContextServer , trace : any) {
    var request = {
      projectId: TraceBase.projectId ,
      resource: {
        "traces": [trace]
      },
      auth: TraceBase.authClient
    }

    TraceBase.cloudTrace.projects.patchTraces(request, function(err : any) {
      if (err) {
        rc.isError() && rc.error(rc.getName(this), 'trace sending error',err)
        return
      }
    })
  }

  public static createTrace(rc : RunContextServer , logger : RCServerLogger , apiName : string) {
    const name = apiName
    const trace  = {
    projectId : TraceBase.projectId ,
    traceId   : getTraceId(name) ,
    spans     : [
      {
        spanId    : "1" ,
        kind      : 'RPC_SERVER',
        name      : name ,
        startTime : format(new Date(logger.startTs) , '%yyyy%-%mm%-%dd%T%hh%:%MM%:%ss%.%ms%000000Z' , 0) ,
        endTime   : format(new Date() , '%yyyy%-%mm%-%dd%T%hh%:%MM%:%ss%.%ms%000000Z', 0)
      }
      ]
    }
    return trace
  }


}