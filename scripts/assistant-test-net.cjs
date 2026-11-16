// Test-only official-target remapping. Never imported by application code.
const http = require('node:http');
module.exports = getEndpoint => ({request(options) {
  if (options.url !== 'https://api.deepseek.com/anthropic/v1/messages' || options.redirect !== 'manual' || options.useSessionCookies !== false) throw Error('UNEXPECTED_SYNTHETIC_TARGET');
  return http.request(getEndpoint()+'/v1/messages',{method:options.method});
}});
