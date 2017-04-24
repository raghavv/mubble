/*------------------------------------------------------------------------------
   About      : <Write about the file here>
   
   Created on : Mon Apr 17 2017
   Author     : Raghvendra Varma
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/



/*------------------------------------------------------------------------------
Websocket communication is essentially about following types:

  - A client (or server) event
  - A client (or server) request

Some events may need acknowledgement from the other party, These can essentially be 
assumed to be of type request / response. We will not use the term event for them.

The underlying architecture can work on promises for request/response, which is 
logically same as what we will have for http based request response.

The event mechanism will be just like send it and forget it, this will actually be 
like request with no response, leading to simpler apis and less network communication

It may be possible that large message has not been flushed out on the websocket when 
the next message arrives. We will need to ensure that we handle this.

It will also be possible to reuse the code between client and server. More importantly
we will just need to abstract out ws node library.

Following steps are followed during setup and communication:
- connect (sends app version and key)
- upgrade (sends new key as cookie)
- Connected (req/resp or events can flow now)

Request:
{type:request api:name clientTs:curTime seq:uniqSequenceId data:{} }

http side note: If some third party is sending us json array, we should translate that
to {array: []}

Response:
{type:response seq:uniqSequenceId error:null data:{} }

Errors like invalid_uid_pwd will not be sent in the error fields anymore. Error essentially
should be at the level of communication layer to indicate that request has failed

Event:
{type: event, name:eventName, eventTs:eventCreateTs  data:{} }

Special event for upgrade (server to client): 
Open another websocket to receive product version upgrade. This protocol
will be defined later.


------------------------------------------------------------------------------*/
import {XmnRouter} from './xmn-router'
import {RunContextBase} from '../rc-base'

enum REQUEST_OR_EVENT {
  REQUEST, EVENT
}

interface WsRequest {
  type  : 'request'
  api   : string
  seq   : number
  data  : object
}

interface WsResponse {
  type  : 'response'
  seq   : number
  error : string | null
  data  : object
}

interface WsEvent {
  type    : 'event'
  name    : string
  eventTs : number
  data    : object
}

export enum STATUS {
  CONNECTING, OPEN, CLOSED
}

const CONST = {
  APP: 'APP',
  VER: 'VER'
}

export const ERROR = {
  NOT_CONNECTED: 'NOT_CONNECTED'
}

// export abstract class BaseWs {

//   abstract mapEvents(mws: MubbleWebSocket)    : void
//   abstract getStatus()                        : STATUS
//   abstract bufferedAmount                 : number
//   abstract sendRequest(request: WsRequest)   : void
//   abstract sendResponse(request: WsResponse) : void
//   abstract sendEvent(event: WsEvent)         : void
//   abstract close(msg: any)                    : void

// }

enum REQUEST_STATUS {
  TO_BE_SENT, SENT, ROUTED
}

declare const setInterval: any, clearInterval: any, console : any

class Pending {

  static nextSendRequestId : number = 1
  static nextSendEventId   : number = Number.MAX_SAFE_INTEGER

  constructor(public reqOrEvent: REQUEST_OR_EVENT, public name: string, 
              public data : object | undefined, public status: REQUEST_STATUS, 
              public seq: number, public resolve: any, public reject: any) {

  }
}

export class MubbleWebSocket {

  static getWsUrl(appName: string, version: string, host: string, port ?: number) {

    return `ws://${host}${port ? ':' + port : ''}/socket.io?${MubbleWebSocket.encodeParams({
      [CONST.APP] : appName,
      [CONST.VER] : version
    })}`

  }

  static encodeParams(params: object) {
    return Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent((params as any)[k]))
    .join('&');    
  }

  private mapPending: Map<number, Pending> = new Map()
  private timer: any

  constructor(private refRc: RunContextBase, private platformWs : any, private router : XmnRouter) {
    try {
      platformWs.onopen     = this.onOpen.bind(this)
      platformWs.onmessage  = this.onMessage.bind(this)
      platformWs.onclose    = this.onClose.bind(this)
      platformWs.onerror    = this.onError.bind(this)
    } catch (err) {
      refRc.isError() && refRc.error(refRc.getName(this), 'Error while constructing websocket', err)
    }
  }

  onOpen() {
    // need to move this to system timer
    try {
      const rc: RunContextBase = this.refRc.copyConstruct('', 'WsOnOpen')
      rc.isDebug() && rc.debug(rc.getName(this), `Websocket is now open`)
      this.timer = setInterval(this.housekeep.bind(this), 1000)
    } catch (err) {
      this.refRc.isError() && this.refRc.error(this.refRc.getName(this), 'Error while constructing websocket', err)
    }
  }

  onMessage(messageEvent: any) {

    const rc: RunContextBase = this.refRc.copyConstruct('', 'WsOnMsg')

    try {

      const msg         = messageEvent.data
      rc.isDebug() && rc.debug(rc.getName(this), `Websocket onMessage ${msg}`)

      const incomingMsg = JSON.parse(msg)

      if (incomingMsg.type === 'request') {

        const irb = this.router.getNewInRequest()
        irb.setApi(incomingMsg.api)
        irb.setParam(incomingMsg.data)

        this.router.routeRequest(rc, irb).then(obj => {
          this._send(rc, {
            type  : 'response',
            error : null,
            data  : obj,
            seq   : incomingMsg.seq
          })
          
        }, err => {
          rc.isError() && rc.error(rc.getName(this), 'Bombed while processing request', err)
          this._send(rc, {
            type  : 'response',
            error : err.name || 'Error',
            data  : err.message || err.name,
            seq   : incomingMsg.seq
          })
        })
        // TODO: this request is to be added to pending list
      } else if (incomingMsg.type === 'response') {

        const pending = this.mapPending.get(incomingMsg.seq)
        if (!pending) {
          rc.isError() && rc.error(rc.getName(this), 'Could not find pending item for message', incomingMsg)
          return
        }

        this.mapPending.delete(incomingMsg.seq)
        if (incomingMsg.error) {
          return pending.reject(new Error(incomingMsg.data))
        } else {
          return pending.resolve(incomingMsg.data)
        }

      } else if (incomingMsg.type === 'event') {

        const ieb = this.router.getNewInEvent()
        ieb.setName(incomingMsg.name)
        ieb.setParam(incomingMsg.data)
        
        this.router.routeEvent(rc, ieb)
      }
    } catch (err) {
      return console.error('got invalid message', err, messageEvent)
    }
  }

  onClose() {
    const rc: RunContextBase = this.refRc.copyConstruct('', 'WsOnClose')
    rc.isDebug() && rc.debug(rc.getName(this), `Websocket is now closed`)
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  onError(err: any) {


  }

  getStatus() {
    switch (this.platformWs.readyState) {

    case this.platformWs.CONNECTING:
      return STATUS.CONNECTING

    case this.platformWs.OPEN:
      return STATUS.OPEN
    }
    // case this.platformWs.CLOSING:
    // case this.platformWs.CLOSED:
    return STATUS.CLOSED
  }

  sendRequest(rc: RunContextBase, apiName: string, data: object) {

    return new Promise((resolve, reject) => {
      const status = this.getStatus()
      if (status === STATUS.CLOSED) {
        return reject(new Error(ERROR.NOT_CONNECTED))
      }

      const reqId = Pending.nextSendRequestId

      if (status === STATUS.CONNECTING || this.platformWs.bufferedAmount > 0) {
        rc.isDebug() && rc.debug(rc.getName(this), `Queueing request for ${apiName} status ${status}`)

        this.mapPending.set(reqId, 
          new Pending(REQUEST_OR_EVENT.REQUEST, apiName, data, REQUEST_STATUS.TO_BE_SENT, 
                      Pending.nextSendRequestId++, resolve, reject))

      } else {

        this._send(rc, {
          type  : 'request',
          api   : apiName,
          data  : data,
          seq   : reqId
        })

        // TODO: Set the start time for cleanup
        this.mapPending.set(reqId, 
          new Pending(REQUEST_OR_EVENT.REQUEST, apiName, undefined, REQUEST_STATUS.SENT, 
                      Pending.nextSendRequestId++, resolve, reject))

      }
    })

  }

  sendEvent(rc: RunContextBase, name: string, eventTs: number, data: object) {

    return new Promise((resolve, reject) => {
      
      const status = this.getStatus()
      if (this.getStatus() === STATUS.CLOSED) {
        return reject(new Error(ERROR.NOT_CONNECTED))
      }

      if (status === STATUS.CONNECTING || this.platformWs.bufferedAmount > 0) {

        this.mapPending.set(Pending.nextSendEventId, 
          new Pending(REQUEST_OR_EVENT.EVENT, name, data, REQUEST_STATUS.TO_BE_SENT, 
          Pending.nextSendEventId--, resolve, reject))

      } else {

        this._send(rc, {
          type    : 'event',
          name    : name,
          eventTs : eventTs,
          data    : data
        })
      }
    })
  }

  private housekeep() {

    const rc: RunContextBase = this.refRc.copyConstruct('', 'WsTimer')
    const status = this.getStatus()

    this.mapPending.forEach((pending, key) => {

      if (status === STATUS.CLOSED) {
        if (pending.status === REQUEST_STATUS.SENT || pending.status === REQUEST_STATUS.TO_BE_SENT) {
          pending.reject(new Error(ERROR.NOT_CONNECTED))
        }
        this.mapPending.delete(key)
      } else if (status === STATUS.OPEN && this.platformWs.bufferedAmount === 0) {

        if (pending.status === REQUEST_STATUS.TO_BE_SENT) {
          if (pending.reqOrEvent === REQUEST_OR_EVENT.REQUEST) {
            this._send(rc, {
              type  : 'request',
              api   : pending.name,
              data  : pending.data as object,
              seq   : pending.seq
            })
            pending.data   = undefined
            pending.status = REQUEST_STATUS.SENT
          } else {
            this._send(rc, {
              type    : 'event',
              name    : pending.name,
              data    : pending.data as object,
              eventTs : 0 // TODO: this is a bug!!!!!
            })
            this.mapPending.delete(key)
          }
        }
      }
    })
  }

  private _send(rc: RunContextBase, obj: any) {
    rc.isDebug() && rc.debug(rc.getName(this), `Sending msg ${obj.type} with ${obj.api || obj.name || obj.seq}`)
    this.platformWs.send(JSON.stringify(obj))
  }
}