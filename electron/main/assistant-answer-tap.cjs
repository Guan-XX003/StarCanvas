// A bounded, best-effort preview of actual upstream answer bytes. It neither
// alters the Harness wire nor determines turn completion or action authority.
const {StringDecoder} = require('node:string_decoder');
function createAssistantAnswerTap(onText) {
  const decoder = new StringDecoder('utf8'), blocks = new Set();
  let buffer = '', text = '', started = false, ended = false;
  const publish = () => { try { onText?.(text); } catch {} };
  const append = value => {
    if (typeof value !== 'string') return;
    if (text.length + value.length > 200000) { ended = true; buffer = ''; return; }
    if (value) { text += value; publish(); }
  };
  function frame(raw) {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let event; try { event = JSON.parse(data); } catch { ended = true; return; }
    if (event?.type === 'message_start') {
      if (started || event.message?.role !== 'assistant') { ended = true; return; }
      started = true; publish();
    } else if (started && event?.type === 'content_block_start') {
      if (!Number.isSafeInteger(event.index) || event.index < 0 || event.index > 1024 || blocks.size >= 128) { ended = true; return; }
      if (event.content_block?.type === 'text') { blocks.add(event.index); append(event.content_block.text); }
    } else if (started && event?.type === 'content_block_delta' && blocks.has(event.index) && event.delta?.type === 'text_delta') append(event.delta.text);
    else if (event?.type === 'content_block_stop') blocks.delete(event.index);
    else if (event?.type === 'message_stop' || event?.type === 'error') ended = true;
  }
  return {write(chunk) {
    if (ended) return;
    buffer += decoder.write(chunk).replace(/\r\n/g,'\n');
    // Normalize again after concatenation for a CR/LF split across chunks.
    buffer = buffer.replace(/\r\n/g,'\n');
    let boundary;
    while (!ended && (boundary = buffer.indexOf('\n\n')) !== -1) {
      if (boundary > 256 * 1024) { ended = true; break; }
      const raw = buffer.slice(0,boundary); buffer = buffer.slice(boundary + 2); frame(raw);
    }
    if (ended || buffer.length > 256 * 1024) { ended = true; buffer = ''; }
  }};
}
module.exports = {createAssistantAnswerTap};
