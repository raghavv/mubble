/*------------------------------------------------------------------------------
   About      : Google vision access
   
   Created on : Thu Jun 01 2017
   Author     : Akash Dathan
   
   Copyright (c) 2017 Mubble Networks Private Limited. All rights reserved.
------------------------------------------------------------------------------*/

const gVision         = require('@google-cloud/vision'),
      imagemin        = require('imagemin'),
      imageminMozjpeg = require('imagemin-mozjpeg')

import {
        VISION_ERROR_CODES,
        VisionError
       }                            from './error-codes'
import {
        CloudStorageBase,
        GcsUUIDFileInfo
       }                            from '../cloudstorage/cloudstorage-base'
import {
        BlobStorageBase,
        AbsFileInfo
       }                            from '../../azure/blobstorage/blobstorage-base'
import {
        VisionParameters,
        ProcessedReturn,
        ProcessOptions,
        ProcessedUrlReturn,
        SmartCropProcessReturn,
        ImageMeta,
        ImageInfo
       }                            from './types'
import {RunContextServer}           from '../../rc-server'
import {executeHttpsRequest}        from '../../util/https-request'
import {GcloudEnv}                  from '../gcloud-env'
import {SmartCropGM}                from './smartcrop-gm'
import * as request                 from 'request'
import * as fs                      from 'fs'
import * as uuid                    from 'uuid/v4'
import * as gm                      from 'gm'
import * as mime                    from 'mime-types'
import * as stream                  from 'stream'
import * as lo                      from 'lodash'
import * as sharp                   from 'sharp'

export class VisionBase {

  static _vision : any
  static MODEL   : string = 'SC' // 'VB'

/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                      INITIALIZATION FUNCTION
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
  static init(rc : RunContextServer, gcloudEnv : GcloudEnv) {
    if (gcloudEnv.authKey) {
      gcloudEnv.vision = gVision ({
        projectId   : gcloudEnv.projectId,
        credentials : gcloudEnv.authKey
      })
    } else {
      gcloudEnv.vision = gVision ({
        projectId   : gcloudEnv.projectId
      })
    }

    this._vision = gcloudEnv.vision
  }

/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                                FUNCTIONS
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
  static async processData(rc           : RunContextServer,
                           imageData    : Buffer,
                           imageOptions : VisionParameters,
                           resBase64    : boolean) : Promise<ProcessedReturn> {

    const func = (this.MODEL === 'VB') ? this.processDataVB : this.processDataSC
    return func (rc, imageData, imageOptions, resBase64)
  }

  static async processUrl(rc           : RunContextServer,
                          imageUrl     : string,
                          imageOptions : VisionParameters,
                          resBase64    : boolean) : Promise<ProcessedReturn> {

    const func = (this.MODEL === 'VB') ? this.processUrlVB : this.processUrlSC
    return func (rc, imageUrl, imageOptions, resBase64)
  }                        

  static async processDataToGcs(rc           : RunContextServer,
                                imageData    : Buffer,
                                imageOptions : VisionParameters,
                                fileInfo     : GcsUUIDFileInfo) : Promise<ProcessedUrlReturn> {

    const func = (this.MODEL === 'VB') ? this.processDataToGcsVB : this.processDataToGcsSC
    return func (rc, imageData, imageOptions, fileInfo)
  }

  static async processDataToAbs(rc           : RunContextServer,
                                imageData    : Buffer,
                                imageOptions : VisionParameters,
                                fileInfo     : AbsFileInfo) : Promise<ProcessedUrlReturn> {

    return this.processDataToAbsSC(rc, imageData, imageOptions, fileInfo)
  }

  static async getImageInfo(rc        : RunContextServer,
                            imageData : Buffer) : Promise<ImageInfo> {

    const imageMeta : ImageMeta = await this.getImageMeta(rc, imageData),
          imageInfo : ImageInfo = {
            size : imageMeta
          }

    return imageInfo
  }

/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                               GM & SMARTCROP FUNCTIONS
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
  private static async processDataSC(rc           : RunContextServer,
                                     imageData    : Buffer,
                                     imageOptions : VisionParameters,
                                     resBase64    : boolean) : Promise<ProcessedReturn> {

    const processedReturnVal  = await VisionBase.smartcropProcess(rc, imageData, imageOptions),
          retVal              = {} as ProcessedReturn

    Object.assign(retVal, processedReturnVal)
    retVal.data = resBase64 ? (await VisionBase.getGmBuffer(processedReturnVal.gmImage)).toString('base64') : await VisionBase.getGmBuffer(processedReturnVal.gmImage)

    return retVal
  }

  private static async processUrlSC(rc           : RunContextServer,
                                    imageUrl     : string,
                                    imageOptions : VisionParameters,
                                    resBase64    : boolean) : Promise<ProcessedReturn> {
    
    const imageData           = new Buffer(await executeHttpsRequest(rc, imageUrl, {'User-Agent': 'Newschat/1.0'}), 'binary'),
          processedReturnVal  = await VisionBase.smartcropProcess(rc, imageData, imageOptions),
          retVal              = {} as ProcessedReturn

    Object.assign(retVal, processedReturnVal)
    retVal.data = resBase64 ? (await VisionBase.getGmBuffer(processedReturnVal.gmImage)).toString('base64') : await VisionBase.getGmBuffer(processedReturnVal.gmImage)

    return retVal
  }

  private static async processDataToGcsSC(rc           : RunContextServer,
                                          imageData    : Buffer,
                                          imageOptions : VisionParameters,
                                          fileInfo     : GcsUUIDFileInfo) : Promise<ProcessedUrlReturn> {
                      
    const retVal = {} as ProcessedUrlReturn
    
    rc.isDebug() && rc.debug(rc.getName(this), `Image Data: ${imageData.length} bytes`)

    const processedReturnVal = await VisionBase.smartcropProcess(rc, imageData, imageOptions)

    Object.assign(retVal, processedReturnVal)
    fileInfo.mimeVal = processedReturnVal.mime
    retVal.url = await CloudStorageBase.uploadDataToCloudStorage(rc, processedReturnVal.gmImage.stream(), fileInfo)

    return retVal
  }

  private static async processDataToAbsSC(rc           : RunContextServer,
                                          imageData    : Buffer,
                                          imageOptions : VisionParameters,
                                          fileInfo     : AbsFileInfo) : Promise<ProcessedUrlReturn> {

    const retVal = {} as ProcessedUrlReturn

    rc.isDebug() && rc.debug(rc.getName(this), `Image Data: ${imageData.length} bytes`)

    const processedReturnVal = await VisionBase.smartcropProcess(rc, imageData, imageOptions)

    Object.assign(retVal, processedReturnVal)
    fileInfo.mimeVal = processedReturnVal.mime
    retVal.url = await BlobStorageBase.uploadDataToBlobStorage(rc, processedReturnVal.gmImage.stream(), fileInfo)

    return retVal
  }

  private static async smartcropProcess(rc : RunContextServer, imageData : Buffer, imageOptions : VisionParameters) : Promise<SmartCropProcessReturn> {
    const traceId = rc.getName(this) + '_smartcropProcess',
          ack     = rc.startTraceSpan(traceId),
          retVal  = {} as SmartCropProcessReturn
    try {
      const bufferImage = await new Promise((resolve, reject) => {
        gm(imageData)
        .borderColor('black')
        .border(1, 1)
        .fuzz(16, true)
        .trim()
        .toBuffer((err, buff) => {
          if(err) {
            rc.isError() && rc.error(rc.getName(this), `Error in converting image to buffer : ${err.message}`)
            reject(err)
          }
          resolve(buff)
        })
      }) as Buffer

      const ratio    = (imageOptions.ratio) ? imageOptions.ratio : 0,
            newImage = await this.changeImageFormat(rc, bufferImage)
            
      let gmImage = await gm(newImage)

      if(ratio) {
        let w    : number = 0, 
            h    : number = 0,
            maxW : number = 0,
            maxH : number = 0

        await new Promise((resolve, reject) => {
          gmImage.identify((err : any, data : any) => {
            if(err) {
              rc.isError() && rc.error(rc.getName(this), `Error in identifying image buffer : ${err.message}`)
              reject(err)
            }
              
            w    = data.size.width
            h    = data.size.height
            maxW = (w / ratio > h) ? h * ratio : w
            maxH = (w / ratio < h) ? w / ratio : h

            resolve()
          })
        })

        const result = await SmartCropGM.crop(newImage, {width : 100, height : 100}),
              crop   = result.topCrop,
              x      = (maxW + crop.x > w) ? (crop.x - ((maxW + crop.x) - w)) : crop.x,
              y      = (maxH + crop.y > h) ? (crop.y - ((maxH + crop.y) - h)) : crop.y

        if(w / h <= 1.05 && w / h >= 0.7) {                                   // Portrait Image
          const desiredW = h * ratio
          let finalImage = new Buffer('')

          const logoColors = await this.checkLogoBorders(rc, newImage, w, h)

          if(logoColors.length > 1) {                                         // Image is a logo
            const bgbuffer = await new Promise((resolve, reject) => {
              gm(newImage)
              .resize(Math.round(desiredW), h, '!')
              .stroke(logoColors[0], 0)
              .fill(logoColors[0])
              .drawRectangle(0, 0, Math.round(desiredW) / 2, h)
              .stroke(logoColors[1], 0)
              .fill(logoColors[1])
              .drawRectangle(Math.round(desiredW) / 2, 0, Math.round(desiredW), h)
              .toBuffer((err : any, buff : any) => {
                if(err) {
                  rc.isError() && rc.error(rc.getName(this), `Error in converting image to buffer : ${err.message}`)
                  reject(err)
                }
                resolve(buff)
              })
            }) as Buffer
    
            finalImage = await new Promise((resolve, reject) => {
              sharp(bgbuffer)
              .overlayWith(newImage)
              .toBuffer((err : any, buff : Buffer) => {
                if(err) {
                  rc.isError() && rc.error(rc.getName(this), `Error in converting overlay image to buffer : ${err.message}`)
                  reject(err)
                }
                resolve(buff)
              })
            }) as Buffer
          } else {                                                            // Image is not a logo
            if(h <= 200) {                                                    // Less blur for smaller images
              const bgbuffer = await new Promise((resolve, reject) => {
                gm(newImage)
                .crop(maxW, maxH, x, y)
                .resize(desiredW, h, '!')
                .blur(0, 10)
                .toBuffer((err : any, buff : any) => {
                  if(err) {
                    rc.isError() && rc.error(rc.getName(this), `Error in converting blurred image to buffer : ${err.message}`)
                    reject(err)
                  }
                  resolve(buff)
                })
              }) as Buffer
              
              finalImage = await new Promise((resolve, reject) => {
                sharp(bgbuffer)
                .overlayWith(newImage)
                .toBuffer((err : any, buff : Buffer) => {
                  if(err) {
                    rc.isError() && rc.error(rc.getName(this), `Error in converting overlay image to buffer : ${err.message}`)
                    reject(err)
                  }
                  resolve(buff)
                })
              }) as Buffer
            } else {                                                          // More blur for larger images
              const bgbuffer = await new Promise((resolve, reject) => {
                gm(newImage)
                .crop(maxW, maxH, x, y)
                .resize(desiredW, h, '!')
                .blur(0, 15)
                .toBuffer((err : any, buff : any) => {
                  if(err) {
                    rc.isError() && rc.error(rc.getName(this), `Error in converting blurred image to buffer : ${err.message}`)
                    reject(err)
                  }
                  resolve(buff)
                })
              }) as Buffer
              
              finalImage = await new Promise((resolve, reject) => {
                sharp(bgbuffer)
                .overlayWith(newImage)
                .toBuffer((err : any, buff : Buffer) => {
                  if(err) {
                    rc.isError() && rc.error(rc.getName(this), `Error in converting overlay image to buffer : ${err.message}`)
                    reject(err)
                  }
                  resolve(buff)
                })
              }) as Buffer
            }
          }
          gmImage = await gm(finalImage)
        } else {                                                              // Landscape Image
          gmImage.crop(maxW, maxH, x, y)
        }
        retVal.width  = (imageOptions.shrink) ? imageOptions.shrink.w : maxW
        retVal.height = (imageOptions.shrink) ? imageOptions.shrink.h : maxH
      }

      const progressive = imageOptions.progressive ? true : false,
            quality     = imageOptions.quality ? imageOptions.quality : 100

      if(imageOptions.shrink) gmImage.resize(imageOptions.shrink.w, imageOptions.shrink.h, '!')
      if(imageOptions.quality || imageOptions.progressive) {
        const gmImageBuffer = await new Promise((resolve, reject) => {
          gmImage.toBuffer((err : Error, buff : Buffer) => {
            if(err) {
              rc.isError() && rc.error(rc.getName(this), `Error in converting final gmImage to buffer : ${err.message}`)
              reject(err)
            }
            resolve(buff)
          })
        }) as Buffer

        const progressiveBuffer = await imagemin.buffer(gmImageBuffer, {use : [imageminMozjpeg({quality : quality, progressive : progressive})]})
        gmImage = await gm(progressiveBuffer)
      }

      const palette = await this.getTopColors(lo.cloneDeep(gmImage)),
            mime    = await this.getGmMime(gmImage)
            
      retVal.mime    = mime
      retVal.palette = palette as any
      retVal.gmImage = gmImage
      return retVal
    } catch(error) {
      rc.isError() && rc.error(rc.getName(this), `Error is ${error.message}`)
      throw(error)
    } finally {
      rc.endTraceSpan(traceId, ack)
    }
  }

  private static async changeImageFormat(rc : RunContextServer, image : Buffer) : Promise<Buffer> {
    const finalImage = await new Promise((resolve, reject) => {
      gm(image)
      .setFormat('jpeg')
      .toBuffer((err : Error, buff : Buffer) => {
        if(err) {
          rc.isError() && rc.error(rc.getName(this), `Error in converting change format image to buffer : ${err.message}`)
          reject(err)
        }
        resolve(buff)
      })
    }) as Buffer

    return finalImage
  }

  private static async checkLogoBorders(rc : RunContextServer, image : Buffer, w : number, h : number) {
    const leftBorderTrue = await new Promise((resolve, reject) => {
      gm(image)
      .crop(3, h, 0, 0)
      .toBuffer((err : any, buff : any) => {
        if(err) {
          rc.isError() && rc.error(rc.getName(this), `Error in converting left border to buffer : ${err.message}`)
          reject(err)
        }
        resolve(buff)
      })
    }) as Buffer

    const leftBorderGray = await new Promise((resolve, reject) => {
      gm(image)
      .colorspace('Gray')
      .crop(3, h, 0, 0)
      .toBuffer((err : any, buff : any) => {
        if(err) {
          rc.isError() && rc.error(rc.getName(this), `Error in converting gray left border to buffer : ${err.message}`)
          reject(err)
        }
        resolve(buff)
      })
    }) as Buffer

    const leftBorderSD = await new Promise((resolve, reject) => {
      gm(leftBorderGray)
      .identify((err : any, data : any) => {
        if(err) {
          rc.isError() && rc.error(rc.getName(this), `Error in identifying image buffer : ${err.message}`)
          reject(err)
        }

        const colorSD : {[id : string] : any} = {}
        Object.keys(data['Channel Statistics']).forEach((key) => {
          colorSD[key] = Number(((((data['Channel Statistics'])[key])['Standard Deviation']).split(' ('))[0])
        })

        const isSDLessThan1300 = Object.keys(colorSD).every((key) => {
          if(colorSD[key] < 1300) return true
          else return false
        })

        if(isSDLessThan1300)
          resolve(true)
        else
          resolve(false)
      })
    })

    const rightBorderTrue = await new Promise((resolve, reject) => {
      gm(image)
      .crop(3, h, w - 3, 0)
      .toBuffer((err : any, buff : any) => {
        if(err) {
          rc.isError() && rc.error(rc.getName(this), `Error in converting right border to buffer : ${err.message}`)
          reject(err)
        }
        resolve(buff)
      })
    }) as Buffer

    const rightBorderGray = await new Promise((resolve, reject) => {
      gm(image)
      .colorspace('Gray')
      .crop(3, h, w - 3, 0)
      .toBuffer((err : any, buff : any) => {
        if(err) {
          rc.isError() && rc.error(rc.getName(this), `Error in converting gray right border to buffer : ${err.message}`)
          reject(err)
        }
        resolve(buff)
      })
    }) as Buffer

    const rightBorderSD = await new Promise((resolve, reject) => {
      gm(leftBorderGray)
      .identify((err : any, data : any) => {
        if(err) {
          rc.isError() && rc.error(rc.getName(this), `Error in identifying image buffer : ${err.message}`)
          reject(err)
        }

        const colorSD : {[id : string] : any} = {}
        Object.keys(data['Channel Statistics']).forEach((key) => {
          colorSD[key] = Number(((((data['Channel Statistics'])[key])['Standard Deviation']).split(' ('))[0])
        })

        const isSDLessThan1300 = Object.keys(colorSD).every((key) => {
          if(colorSD[key] < 1300) return true
          else return false
        })

        if(isSDLessThan1300)
          resolve(true)
        else
          resolve(false)
      })
    })

    if(leftBorderSD && rightBorderSD) {
      const gmLeftBorder  = await gm(leftBorderTrue),
            topColorLeft  = await VisionBase.getTopColors(gmLeftBorder, 1),
            lbColor       = topColorLeft[0] as any,
            hexColorLeft  = `#${(lbColor.r).toString(16)}${(lbColor.g).toString(16)}${(lbColor.b).toString(16)}`,
            gmRightBorder = await gm(rightBorderTrue),
            topColorRight = await VisionBase.getTopColors(gmLeftBorder, 1),
            rbColor       = topColorRight[0] as any,
            hexColorRight = `#${(rbColor.r).toString(16)}${(rbColor.g).toString(16)}${(rbColor.b).toString(16)}`

      return [hexColorLeft, hexColorRight]
    } else {
      return []
    }
  }

/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                               VISION BASE FUNCTIONS
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
  private static async processDataVB(rc           : RunContextServer,
                                     imageData    : Buffer,
                                     imageOptions : VisionParameters,
                                     resBase64    : boolean) : Promise<ProcessedReturn> {

    const crops : any = imageOptions.ratio
                        ? await VisionBase.detectCrops(rc, imageOptions.ratio, '', imageData)
                        : null

    const processOptions = {
            quality      : imageOptions.quality,
            shrink       : imageOptions.shrink,
            crops        : crops,
            returnBase64 : resBase64
          } as ProcessOptions
          
    return VisionBase.process(rc, imageData, processOptions)
  }

  private static async processUrlVB(rc           : RunContextServer,
                                    imageUrl     : string,
                                    imageOptions : VisionParameters,
                                    resBase64    : boolean) : Promise<ProcessedReturn> {
    
    const imageData      : Buffer = new Buffer(await executeHttpsRequest(rc, imageUrl, {'User-Agent': 'Newschat/1.0'}), 'binary'),
          crops          : any    = imageOptions.ratio ? await VisionBase.detectCrops(rc, imageOptions.ratio, imageUrl) : null,
          processOptions          = {
            quality      : imageOptions.quality,
            shrink       : imageOptions.shrink,
            crops        : crops,
            returnBase64 : resBase64
          } as ProcessOptions

    return VisionBase.process(rc, imageData, processOptions)
  }

  private static async processDataToGcsVB(rc           : RunContextServer,
                                          imageData    : Buffer,
                                          imageOptions : VisionParameters,
                                          fileInfo     : GcsUUIDFileInfo) : Promise<ProcessedUrlReturn> {
    
    rc.isDebug() && rc.debug(rc.getName(this), `Detecting Crops: Image Data: ${imageData.length} bytes`)
    const crops : any = imageOptions.ratio
                        ? await VisionBase.detectCrops(rc, imageOptions.ratio, '', imageData)
                        : null

    rc.isDebug() && rc.debug(rc.getName(this), `Crops Detected, Crop Size: ${JSON.stringify(imageOptions)}`)
    const processOptions = {
            quality      : imageOptions.quality,
            shrink       : imageOptions.shrink,
            crops        : crops,
            returnBase64 : false
          } as ProcessOptions
    
    return VisionBase.processAndUpload(rc, imageData, processOptions, fileInfo)
}

  private static async getImageMeta(rc : RunContextServer, imageData : Buffer) : Promise<ImageMeta> {
    const gmImage = gm(imageData)

    return new Promise((resolve, reject) => {
      gmImage.size((error, size) => {
        if(error) reject(error)

        const retVal : ImageMeta = {
          height : size.height,
          width  : size.width
        }
        
        resolve(retVal)
      })
    }) as Promise<ImageMeta>
  }

  private static async detectCrops(rc : RunContextServer, ratio : number, imagePath ?: string, data ?: Buffer) : Promise<string> {
    const sourceVal : any = {},
          features  : any = [{
            type        : gVision.types.Feature.Type.CROP_HINTS
            // maxResults  : 1,
          }],
          imageContext    = {
            cropHintsParams : {
              aspectRatios : [ratio]
            }
          }

    if(data) sourceVal.content = data
    else sourceVal.source = {imageUri : imagePath}

    try {
      const res = await VisionBase._vision.annotateImage({image : sourceVal, features, imageContext})

      if(res[0].error) throw(res[0].error)
      return res[0].cropHintsAnnotation.cropHints[0].boundingPoly.vertices
    } catch(error) {
      throw(new VisionError(VISION_ERROR_CODES.CROP_DETECTION_FAILED, `Crop detection failed : ${JSON.stringify(error)}`))
    } 
  }

  private static async process(rc : RunContextServer, imageData : Buffer, options : ProcessOptions) {
    let height : number  = 0,
        width  : number  = 0

    const gmImage = await gm(imageData)
    
    if(options.crops && options.crops.length) {
      const crops  = options.crops,
            x      = crops[0].x,
            y      = crops[0].y

      width  = crops[1].x - crops[0].x
      height = crops[3].y - crops[0].y

      gmImage.crop(width, height, x, y)
    }

    if(options.shrink)  gmImage.resize(options.shrink.w, options.shrink.h)
    if(options.quality) gmImage.quality(options.quality)

    const palette = await this.getTopColors(lo.cloneDeep(gmImage))

    return {
      data    : options.returnBase64 ? (await this.getGmBuffer(gmImage)).toString('base64') : await this.getGmBuffer(gmImage),
      mime    : await this.getGmMime(gmImage),
      height  : (options.shrink) ? options.shrink.h : height,
      width   : (options.shrink) ? options.shrink.w : width,
      palette : palette as any
    }
  }

  private static async processAndUpload(rc : RunContextServer, imageData : Buffer, options : ProcessOptions, fileInfo : GcsUUIDFileInfo) {
    const gmImage   = await gm(imageData),
          retVal    = {} as ProcessedUrlReturn,
          mime      = await this.getGmMime(gmImage),
          palette   = await this.getTopColors(lo.cloneDeep(gmImage))

    fileInfo.mimeVal = mime
    retVal.mime      = mime
    retVal.palette   = palette as any

    if(options.crops && options.crops.length) {
      const crops  = options.crops,
            x      = crops[0].x,
            y      = crops[0].y,
            width  = crops[1].x - crops[0].x,
            height = crops[3].y - crops[0].y

      gmImage.crop(width, height, x, y)
      retVal.height = (options.shrink) ? options.shrink.h : height
      retVal.width  = (options.shrink) ? options.shrink.w : width
    }

    if(options.shrink)  gmImage.resize(options.shrink.w, options.shrink.h)
    if(options.quality) gmImage.quality(options.quality)

    retVal.url = await CloudStorageBase.uploadDataToCloudStorage(rc, gmImage.stream(), fileInfo)

    return retVal
  }

  private static getGmBuffer(gmImage : any) : Promise<Buffer> {
    return new Promise((resolve, reject) => {
      gmImage.toBuffer((error : any, buffer : any) => {
        if(error) reject(VISION_ERROR_CODES.IMAGE_PROCESSING_FAILED)
        resolve(buffer)
      })
    })
  }

  private static getGmMime(gmImage : any) : Promise<string> {
    return new Promise((resolve, reject) => {
      gmImage.format((error : any, data : any) => {
        if(error) reject(VISION_ERROR_CODES.IMAGE_PROCESSING_FAILED)
        resolve(mime.lookup(data) || '')
      })
    })
  }

  public static async getTopColors(img : any, count ?: number) {
    const HIST_START = 'comment={',
          HIST_END   = '\x0A}'

    count = count ? count : 8

    const strData = await new Promise((resolve, reject) => {
      img.noProfile()
      .colors(count)
      .stream('histogram', (error : any, stdout : any, stderr : any) => {
        if(error || !stdout) throw(new Error(`${VISION_ERROR_CODES.PALETTE_DETECTION_FAILED} : ${error || stderr}`))
        const writeStream = new stream.PassThrough()
        let   strData     = ''
        
        writeStream.on('data', (data: any) => {strData = strData + data.toString()})
        writeStream.on('end', () => {resolve (strData)})
        writeStream.on('error', (error: any) => {throw(new Error(`${VISION_ERROR_CODES.PALETTE_DETECTION_FAILED} : ${error}`))})
        stdout.pipe(writeStream)
      }) 
    }) as string
    
    const beginIndex = strData.indexOf(HIST_START) + HIST_START.length + 1,
          endIndex   = strData.indexOf(HIST_END),
          cData      = strData.slice(beginIndex, endIndex).split('\n')
  
    if(cData.length > count) cData.splice(0, cData.length - count)
    if(beginIndex === -1 || endIndex === -1) throw(new Error(`${VISION_ERROR_CODES.PALETTE_DETECTION_FAILED} : HIST_START or HIST_END not found`))

    return lo.map(cData, this.parseHistogramLine)
  }

  private static parseHistogramLine(xs : any) {
    xs = xs.trim().split(':')
    if(xs.length !== 2) return null
  
    const res = xs[1].split('(')[1].split(')')[0].split(',')

    return {
      r : Number(res[0]),
      g : Number(res[1]),
      b : Number(res[2])
    }
  }
}