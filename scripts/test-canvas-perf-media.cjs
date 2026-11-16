const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('debug canvas fixture uses valid bounded synthetic WebM/WAV data, not an external sample service',async()=>{
 const {canvasPerfMedia}=await import('../src/renderer/lib/canvas-perf-media.mjs');
 const media=canvasPerfMedia(),wav=Buffer.from(media.audio.split(',')[1],'base64'),video=Buffer.from(media.video.split(',')[1],'base64');
 assert.equal(wav.subarray(0,4).toString(),'RIFF');assert.equal(wav.readUInt32LE(4),wav.length-8);assert.equal(wav.subarray(8,16).toString(),'WAVEfmt ');assert.equal(wav.readUInt16LE(20),1);assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt32LE(24),8000);assert.equal(wav.readUInt32LE(28),16000);assert.equal(wav.readUInt16LE(32),2);assert.equal(wav.readUInt16LE(34),16);assert.equal(wav.subarray(36,40).toString(),'data');assert.equal(wav.readUInt32LE(40),wav.length-44);assert.equal(wav.length,8044);assert.equal(video.subarray(0,4).toString('hex'),'1a45dfa3');assert.equal(video.length,385);
 assert.deepEqual(canvasPerfMedia(),media);assert(!Object.values(media).some(value=>/^https?:/.test(value)));
 const source=fs.readFileSync(require.resolve('../src/renderer/bundle/index.js'),'utf8');assert(!source.includes('interactive-examples.mdn.mozilla.net'));assert(source.includes('document.documentElement.dataset.wanjuanDebug !== `1`'));
});
