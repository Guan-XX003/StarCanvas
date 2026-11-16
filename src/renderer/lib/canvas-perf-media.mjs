// Synthetic, offline-only media for the explicitly gated canvas debug fixture.
// No user media, external URL, provider or decoder download is involved.
const video='data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAFREU2bdLlNu4tTq4QVSalmU6yBbk27i1OrhBZUrmtTrIGTTbuLU6uEH0O2dVOsgcFNu4xTq4QcU7trU6yCAT/srgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBEiYQ/gAAATYCGQ2hyb21lV0GGQ2hyb21lFlSua6mup9eBAXPFh8QnDFSrLLWDgQFV7oEBhoVWX1ZQOOCKsIFAuoFAU8CBAR9DtnUBAAAAAAAAcueBAKDtobuBAAAAcAMAnQEqQABAAAAHCIWFiJmEiAEkEBOtUBA2MjfqgtSEwBTAAP74wqu3Yu3Vb/5sD9vPt54WAHWhraar7oEBpabwAgCdASpAAEAAAAcIhYWImYSIASQQADOB4hMAVZEHuYD+/7qDABxTu2uNu4uzgQC3hveBAfGBwQ==';
let audio;
export function canvasPerfMedia(){
 if(!audio){
  const frames=4000,bytes=new Uint8Array(44+frames*2),view=new DataView(bytes.buffer);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};
  text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  text(36,'data');view.setUint32(40,frames*2,true);
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  audio='data:audio/wav;base64,'+btoa(binary);
 }
 return {video,audio};
}
