/*------------------------------------------------------------------------------
   About      : <Write about the file here>
   
   Created on : Fri Apr 14 2017
   Author     : Raghvendra Varma
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

import * as repl from 'repl'
import * as path from 'path'
import * as fs   from 'fs'

import {RunContextServer, RUN_MODE} from '../rc-server'

// Import from external modules without types
const replHistory: any = require('repl.history') // https://github.com/ohmu/node-posix


export class Repl {
  
  promise: Promise<any>
  
  constructor(private rc: RunContextServer) {
  }

  init(context ?: any) {

    return new Promise((resolve, reject) => {
      
      if (!context) context = {}

      context.fs       = fs
      context.path     = path
      context.$        = this
      context.rc       = this.rc

      const replServer: any = repl.start({prompt: 'mubble > ', useGlobal: true})
      replHistory(replServer, process.env.HOME + '/.mubble-repl')

      Object.assign(replServer.context, context)
      replServer.on('exit', function () {
        resolve()
      })

      replServer.on('error', (err: Error) => {
        reject(err)
      })
    })
  }

  _print(...args: any[]) {
    args.forEach(function(val, index) {
      this.rc.status(val, typeof(val))
    })
  }
  
  print(pr: Promise<any>) {
    
    var _       = this,
        ts      = Date.now()
        
    return pr.then( function() {
      console.log('Success...', Date.now() - ts, 'ms')
      _._print(...arguments)
    }).catch(function() {
      console.log('Failed!', Date.now() - ts, 'ms')
      _._print(...arguments)
    })
  }

  set pr(pr: Promise<any>) {
    this.print(pr)
  }
}