/*
 * Websocket Loader
*/

import Event from '../events';
import EventHandler from '../event-handler';
import H264Demuxer from '../demux/h264-demuxer';
import crc  from './crc.js';
const H264_DATA_LEN_POS = 6
const H264_DATA_START_POS = 10
const H264_DATA_MIN_LEN = 13
const H264_HEAD_MEDIA_TYPE_POS = 4
const H264_HEAD_FRAME_TYPE_POS = 5
const H264_FRAME_TYPE_I = 1
const H264_FRAME_TYPE_P = 2
const H264_FRAME_TYPE_B = 3
class WebsocketLoader extends EventHandler {

  constructor(wfs) {
    super(wfs, 
    Event.WEBSOCKET_ATTACHING,
    Event.WEBSOCKET_DATA_UPLOADING,
    Event.WEBSOCKET_MESSAGE_SENDING)   
    this.buf = null;
    this.h264Demuxer = new H264Demuxer(wfs);    
    this.mediaType = undefined; 
    this.channelName = undefined;
    this.frameBuf = []
    this.frameBufLen = 0
    this.isFirst = true
    this.isPlaying = false
    setInterval(() => {
      if (this.isFirst) {
        if (this.frameBuf.length > 2) {
          this.isFirst = false
          for (let idx = 0; idx < this.frameBuf.length; idx++) {
            this.wfs.trigger(Event.H264_DATA_PARSING, { data: this.frameBuf[idx] })
          }
          this.frameBuf = []
          this.frameBufLen = 0
        }
      } else {
        for (let idx = 0; idx < this.frameBuf.length; idx++) {
          this.wfs.trigger(Event.H264_DATA_PARSING, { data: this.frameBuf[idx] })
        }
        this.frameBuf = []
        this.frameBufLen = 0
      }
    }, 10)
  }

  
  isNalu (data) {
    // console.log("len:",data.length,data[0],data[1],data[2],data[3])
    if ((data.length >= H264_DATA_MIN_LEN && data[H264_DATA_START_POS] === 0 && data[H264_DATA_START_POS+1] === 0 && data[H264_DATA_START_POS+2] === 1) ||
          (data.length >= H264_DATA_MIN_LEN+1 && data[H264_DATA_START_POS] === 0 && data[H264_DATA_START_POS+1] === 0 && data[H264_DATA_START_POS+2] === 0 && data[H264_DATA_START_POS+3] === 1)) {
      return true
    }
    return false
  }
 
  destroy() { 
    EventHandler.prototype.destroy.call(this);
  }

  onWebsocketAttaching(data) {
  	this.mediaType = data.mediaType; 
  	this.channelName = data.channelName;  
    if( data.websocket instanceof WebSocket ) {
      this.client = data.websocket;
      this.client.onopen = this.initSocketClient.bind(this);
      const self = this   
      this.client.onclose = function(e) {
          console.log('Websocket Disconnected!');
          if(!self.wfs.clientCallback.closeStream){
            console.error('clientCallback.closeStream no set')
            return
          }
          self.wfs.clientCallback.closeStream(e)
       
      }; 
    }    
  }

  initSocketClient(client){
    this.client.binaryType = 'arraybuffer';
    this.client.onmessage = this.receiveSocketMessage.bind(this);
   // this.wfs.trigger(Event.WEBSOCKET_MESSAGE_SENDING, {commandType: "open", channelName:this.channelName, commandValue:"NA" });
    console.log('Websocket Open!'); 
    let info = {
      clientUID: this.wfs.clientUID,
      isTransparent: 0,
      sessionID: this.wfs.sessionID,
      webClientUid: this.wfs.webClientUid
    }
    this.wfs.trigger(Event.WEBSOCKET_MESSAGE_SENDING, info);
  }
 
  receiveSocketMessage( event ){
    if (!this.wfs.playStatus) {
      this.isPlaying = false
      return
    }
    var buffer = new Uint8Array(event.data);
    var readFrame = new DataView(buffer.buffer)
    if (readFrame.getUint8(H264_HEAD_MEDIA_TYPE_POS) !== 1) { // 1:video,2:audio// no support audio
      return
    }
    if(!this.isPlaying){
      if (readFrame.getUint8(H264_HEAD_FRAME_TYPE_POS) !== H264_FRAME_TYPE_I) { // 1:video,2:audio// no support audio
        console.log('wait i frame')
        return
      }
      this.isPlaying = true
      if(!this.wfs.clientCallback.startStream){
          console.error('clientCallback.startStream no set')
          return
      }
      this.wfs.clientCallback.startStream()
    }
 
    if (!this.isNalu(buffer)) {
      console.error('is not nalu')
      return
    }

    this.wfs.streamSize += buffer.length
    var newBuffer;
    if(this.buf){
      newBuffer = new Uint8Array(this.buf.byteLength + buffer.byteLength);
      newBuffer.set(this.buf);
      newBuffer.set(buffer, this.buf.byteLength);
      console.log(newBuffer.length);
    }
    else
      newBuffer = new Uint8Array(buffer);
    //get len
    var offset = 0;
    var lenView = new DataView(newBuffer.buffer);
    var len = lenView.getUint32(H264_DATA_LEN_POS);  
    while(len < newBuffer.byteLength -H264_DATA_START_POS){

      var copy = newBuffer.subarray(H264_DATA_START_POS, len+H264_DATA_START_POS);
      this.frameBuf.push(copy)
      this.frameBufLen += copy.byteLength

      newBuffer = newBuffer.subarray(len + H264_DATA_START_POS)
      offset += len + H264_DATA_START_POS
      len = lenView.getUint32(offset)
      //get len
    }
    if(len === newBuffer.byteLength - H264_DATA_START_POS){
      var copy = newBuffer.subarray(H264_DATA_START_POS,len+H264_DATA_START_POS);
      this.frameBuf.push(copy)
      this.frameBufLen += copy.byteLength
      this.buf = null;
    }
    else
      this.buf = new Uint8Array(newBuffer);
  }

  onWebsocketDataUploading( event ){
    this.client.send( event.data );
  }
  
  onWebsocketMessageSending( event ){  
    this.client.send( JSON.stringify(event ) );
  }

}

export default WebsocketLoader;  
