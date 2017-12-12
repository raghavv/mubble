/*------------------------------------------------------------------------------
   About      : <Write about the file here>
   
   Created on : Mon Jun 26 2017
   Author     : Raghvendra Varma
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

import { 
  Mubble,
  ConnectionInfo,
  WireObject,
  Leader,
  Encoder
} from '@mubble/core'

import {  RunContextBrowser} from '../rc-browser'

const IV                    = new Uint8Array(16),
      SYM_ALGO              = {name: "AES-CBC", iv: IV, length: 256},
      ASYM_ALGO             = {name: 'RSA-OAEP', hash: {name: 'SHA-1'}}

let arShortCode
let arUniqueId
let pwc: PakoWorkerClient

export class EncryptionBrowser {

  constructor(rc: RunContextBrowser, private ci: ConnectionInfo, private syncKey: Uint8Array) {

    rc.setupLogger(this, 'EncryptionBrowser')
    

    if (!arShortCode) this.extractShortCode(rc, ci.shortName)
    if (!arUniqueId)  this.extractUniqueId(rc, ci.uniqueId)
    if (!pwc)         pwc = new PakoWorkerClient(rc)
  }

  // Should return binary buffer
  async encodeHeader(rc: RunContextBrowser) {

    await this.ensureSyncKey()
    
    const buffer = await crypto.subtle.exportKey('raw', this.ci.syncKey),
          key    = await crypto.subtle.importKey('spki', this.syncKey, ASYM_ALGO , false, ['encrypt']),
          encKey = await crypto.subtle.encrypt(ASYM_ALGO, key, buffer),
          obj    = {
            networkType : this.ci.networkType,
            location    : this.ci.location,
            now         : Date.now()
          }

    Object.assign(obj, this.ci.clientIdentity)

    const header    = this.strToUnit8Ar(JSON.stringify(obj)),
          encHeader =  await crypto.subtle.encrypt(SYM_ALGO, this.ci.syncKey, header)

    const arOut = new Uint8Array(arShortCode.length + arUniqueId.length + encKey.byteLength + encHeader.byteLength)
    let copied = 0

    arOut.set(arShortCode)
    copied += arShortCode.length

    arOut.set(arUniqueId, copied)
    copied += arUniqueId.length

    arOut.set(new Uint8Array(encKey), copied)
    copied += encKey.byteLength
    
    arOut.set(new Uint8Array(encHeader), copied)
    copied += encHeader.byteLength
    
    return arOut
  }

  async encodeBody(rc: RunContextBrowser, data: WireObject[]): Promise<Uint8Array> {

    const str = this.stringifyWireObjects(data)
    let   firstPassArray,
          leader

    if (str.length > Encoder.MIN_SIZE_TO_COMPRESS) {
      const ar = await pwc.deflate(str)
      if (ar.length < str.length) {
        firstPassArray = ar
        leader         = Leader.DEF_JSON
      }
    }

    if (!firstPassArray) {
      firstPassArray = this.strToUnit8Ar(str)
      leader         = Leader.JSON
    }

    await this.ensureSyncKey()
    const secondPassArray = new Uint8Array(await crypto.subtle.encrypt(SYM_ALGO, this.ci.syncKey, firstPassArray)),
          arOut = new Uint8Array(secondPassArray.byteLength + 1)

    arOut.set([leader.charCodeAt(0)])
    arOut.set(secondPassArray, 1)

    rc.isDebug() && rc.debug(rc.getName(this), 'encodeBody', {
      first       : data[0].name,
      messages    : data.length, 
      json        : str.length, 
      wire        : arOut.byteLength,
      compressed  : leader === Leader.DEF_JSON,
    })
    return arOut
  }

  private stringifyWireObjects(objects: WireObject[]) {

    const strArray = objects.map(wm => wm.stringify())
    return `[${strArray.join(', ')}]`
  }

  async decodeBody(rc: RunContextBrowser, data: ArrayBuffer): Promise<[WireObject]> {

    await this.ensureSyncKey()

    const inAr    = new Uint8Array(data, 1),
          ar      = new Uint8Array(data, 0, 1),
          leader  = String.fromCharCode(ar[0]),
          temp    = new Uint8Array(await crypto.subtle.decrypt(SYM_ALGO, this.ci.syncKey, inAr))

    let arData, index, decLen

    if (leader === Leader.BIN) {

      const newLineCode = '\n'.charCodeAt(0)
      for (index = 0; index < temp.length; index++) if (temp[index] === newLineCode) break

      const jsonStr = String.fromCharCode(...temp.slice(0, index) as any),
            wo      = WireObject.getWireObject(JSON.parse(jsonStr)),
            outAr   = temp.slice(index + 1)
            
      wo.data = outAr
      arData  = [wo]
      decLen  = outAr.byteLength

    } else {

      const inJsonStr = leader === Leader.DEF_JSON ? await pwc.inflate(temp)
                                                   : this.uint8ArToStr(temp),
            inJson    = JSON.parse(inJsonStr)

      arData = Array.isArray(inJson) ? inJson : [inJson]
      decLen = inJsonStr.length
      
      for (index = 0; index < arData.length; index++) {
        arData[index] = WireObject.getWireObject(arData[index])
      }

    }
  
    rc.isDebug() && rc.debug(rc.getName(this), 'decodeBody', {
      first       : arData[0].name, 
      messages    : arData.length, 
      wire        : data.byteLength, 
      message     : decLen,
      compressed  : leader === Leader.BIN ? 'binary' : leader === Leader.DEF_JSON
    })

    return arData as [WireObject]
  }

  public async setNewKey(syncKey: string) {
    const arEncNewKey = this.binToUnit8Ar(atob(syncKey)),
          arNewKey    = new Uint8Array(await crypto.subtle.decrypt(SYM_ALGO, this.ci.syncKey, arEncNewKey))

    this.ci.syncKey = await crypto.subtle.importKey('raw', arNewKey, SYM_ALGO, true, ['encrypt', 'decrypt'])
  }

  private async ensureSyncKey() {

    if (!this.ci.syncKey) {
      this.ci.syncKey = await crypto.subtle.generateKey(SYM_ALGO, true, ['encrypt', 'decrypt'])
    // } else if (typeof this.ci.syncKey === 'string') {
    //   await this.decryptNewKey(this.ci.syncKey)
    }
  }

  binToUnit8Ar(binStr): Uint8Array {
    const cls:any     = Uint8Array
    return cls.from(binStr, c => c.charCodeAt(0))
  }

  strToUnit8Ar(str): Uint8Array {
    const TextEncoder = window['TextEncoder']
    return new TextEncoder('utf-8').encode(str)
  }

  uint8ArToStr(uar): string {
    const TextDecoder = window['TextDecoder']
    return new TextDecoder('utf-8').decode(uar)
  }

  private extractShortCode(rc: RunContextBrowser, code: string) {

    rc.isAssert() && rc.assert(rc.getName(this), code.length <= 4)
    arShortCode = new Uint8Array(4)
    
    for (let index = 0; index < code.length; index++) {
      const str = code.charAt(index)
      rc.isAssert() && rc.assert(rc.getName(this), str.match(/[a-zA-Z0-9]/))
      arShortCode[index] = str.charCodeAt(0) - 40
    }
  }
      
  
  private extractUniqueId(rc: RunContextBrowser, id: string) {

    let ar = id.split('.').map(i => Number(i))

    if (ar.length > 1) {

      rc.isAssert() && rc.assert(rc.getName(this), ar.length === 3 && 
        !isNaN(ar[0]) && !isNaN(ar[1])  && !isNaN(ar[2]))

    } else {

      let num = Number(ar[0])
      rc.isAssert() && rc.assert(rc.getName(this), !isNaN(num) && num <= 999999)

      ar[2] = num % 100
      num   = Math.floor(num / 100)

      ar[1] = num % 100
      ar[0] = Math.floor(num / 100)

    }
    arUniqueId = Uint8Array.from(ar)
  }
}

class AsyncRequest {

  static nextRequestId: number = 1

  requestId       : number
  promise         : Promise<any>
  resolve         : () => void
  reject          : () => void

  constructor(public apiName: string) {

    this.requestId  = AsyncRequest.nextRequestId++

    this.promise    = new Promise((resolve, reject) => {
      this.resolve  = resolve
      this.reject   = reject
    })
  }
}

class PakoWorkerClient {

  private worker: Worker
  private reqMap: Mubble.uObject<AsyncRequest> = {}

  constructor(private rc: RunContextBrowser) {
    const worker = this.worker = new Worker('assets/js/pwc.js')
    worker.onmessage = this.onMessage.bind(this)
  }

  async inflate(inU8Array: Uint8Array): Promise<string> {
    return await this.sendMessage('inflate', inU8Array, {to: 'string'}) as string
  }

  async deflate(str: string): Promise<Uint8Array> {
    return await this.sendMessage('deflate', str) as Uint8Array
  }

  private sendMessage(apiName, ...params) {
    const asyncRequest = new AsyncRequest(apiName)
    this.reqMap[asyncRequest.requestId] = asyncRequest
    this.worker.postMessage([asyncRequest.requestId, apiName, ...params])
    return asyncRequest.promise
  }

  onMessage(event) {
    const [reqId, ...resp] = event.data
    const asyncRequest = this.reqMap[reqId]
    this.rc.isAssert() && this.rc.assert(this.rc.getName(this), asyncRequest)
    delete this.reqMap[reqId]
    asyncRequest.resolve(...resp)
  }

}

