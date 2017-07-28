/*------------------------------------------------------------------------------
   About      : Execute an https request
   
   Created on : Tue May 23 2017
   Author     : Akash Dathan
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

import * as https            from 'https'
import * as http             from 'http'
import * as zlib             from 'zlib'
import * as url              from 'url'
import * as request          from 'request'
import {RunContextServer}    from '../rc-server'

export function executeHttpsRequest(rc: RunContextServer, urlStr: string): Promise<string> {

    return new Promise((resolve, reject) => {

      const urlObj  = url.parse(urlStr),
            httpObj: any = urlObj.protocol === 'http:' ? http : https

      const req = httpObj.request(urlObj, (outputStream: any) => {

        outputStream.setEncoding('binary')

        switch (outputStream.headers['content-encoding']) {
        case 'gzip':
          outputStream = outputStream.pipe(zlib.createGunzip())
          break
        case 'deflate':
          outputStream = outputStream.pipe(zlib.createInflate())
          break
        }

        let response = ''
        outputStream.on('data', (chunk: any) => {
          response += chunk
        })
        outputStream.on('end', () => {
          return resolve(response)
        })
      })

      req.on('response', (res: any) => {
        const hostname = url.parse(urlStr).host
        rc.isStatus () && rc.status (rc.getName (this), 'HTTP Response [' + hostname + '], Status Code: ' + res.statusCode)
      })
      req.on('error', (err: any) => {
        rc.isStatus() && rc.status (err)
        if (err.errno && err.errno === 'ENOTFOUND') return resolve (undefined) 
        return reject(err)
      })
      req.end()
    })
  }

  export function executeHttpsWithOptions(rc: RunContextServer, urlObj: any, inputData ?: string): Promise<string> {

    return new Promise((resolve, reject) => {
      const httpObj    : any    = urlObj.protocol === 'http:' ? http : https
      let   statusCode : number = 200
      
      if(inputData && !urlObj.headers['Content-Length']) 
        urlObj.headers['Content-Length'] = Buffer.byteLength(inputData)
        
      const req = httpObj.request(urlObj, (outputStream: any) => {

        switch (outputStream.headers['content-encoding']) {
        case 'gzip':
          outputStream = outputStream.pipe(zlib.createGunzip())
          break
        case 'deflate':
          outputStream = outputStream.pipe(zlib.createInflate())
          break
        }

        let response = ''
        outputStream.on('data', (chunk: any) => {
          response += chunk
        })
        outputStream.on('end', () => {
          return resolve(response)
        })
      })

      req.on('response', (res: any) => {
        rc.isStatus () && rc.status (rc.getName (this), 'HTTP Response [' + urlObj.host + '], Status Code: ' + res.statusCode)
        statusCode = res.statusCode
      })
      req.on('error', (err: any) => {
        rc.isStatus() && rc.status (err)
        if (err.errno && err.errno === 'ENOTFOUND') return resolve (undefined) 
        return reject(err)
      })
      if(inputData) req.write(inputData)
      req.end()
    })
  }

  export function expandUrl(rc: RunContextServer, shortUrl: string) : Promise<string> {
    return new Promise((resolve, reject) => {
     request( { method: "HEAD", url: shortUrl, followAllRedirects: true },
      function (error : any, response : any) {
        if(error) reject(error)
        return resolve(response.request.href)
      })
    })
  }

  /**
   * This is recommended to be used for https request.
   * returns {error: string | undefined, statusCode: number | undefined, data: any}
   * 
   * Caller has to process this result as per their need
   * 
   * Execute http and return result data as well as response code.
   * Drupal SEO server data sync request fails with # 200 status code and error msg
   */ 
  export function executeHttpResultResponse(rc: RunContextServer, options: http.RequestOptions, 
      inputData ?: string , encoding ?: string ): Promise<{error : string | undefined, response: any, data : string}> {

    let response: any
    if(inputData && options.headers && !options.headers['Content-Length']) 
        options.headers['Content-Length'] = inputData.length
      
    return new Promise<{error: string | undefined, response: any, data : string}>((resolve, reject) => {
      const httpObj: any = options.protocol === 'http:' ? http : https
      const req = httpObj.request(options, (outputStream: any) => {

        switch (outputStream.headers['content-encoding']) {
        case 'gzip':
          outputStream = outputStream.pipe(zlib.createGunzip())
          break
        case 'deflate':
          outputStream = outputStream.pipe(zlib.createInflate())
          break
        }
        
              

        let data = new Buffer('')
        outputStream.on('data', (chunk: Buffer) => {
          //data += chunk
          data = Buffer.concat([data , chunk])
        })
        outputStream.on('end', () => {
          // If encoding is not defined . default is utf8
          return resolve({error: undefined, response: response, data: data.toString(encoding)})
        })
      })

      req.on('response', (res: any) => {
        response = res
      })

      req.on('error', (err: any) => {
        rc.isStatus() && rc.status (err)
        return resolve({error: err, response: response, data: ''})
      })

      if(inputData) req.write(inputData)
      req.end()
    })
  }