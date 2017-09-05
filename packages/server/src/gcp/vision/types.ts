/*------------------------------------------------------------------------------
   About      : <Write about the file here>
   
   Created on : Tue Sep 05 2017
   Author     : Akash Dathan
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

export type ProcessedReturn = {
  data   : string,
  mime   : string,
  height : number,
  width  : number
}

export type ProcessOptions = {
  returnBase64  : boolean
  crops        ?: any,
  shrink       ?: {h : number, w : number}
  quality      ?: number 
}