// Keep the account broker and the Harness shutdown independently bounded.
// The caller must retain its runtime and home if either outcome is uncertain.
function stopUnconfirmed() {
  const error = new Error('ASSISTANT_RUNTIME_STOP_UNCONFIRMED');
  error.code = 'ASSISTANT_RUNTIME_STOP_UNCONFIRMED';
  return error;
}

async function boundedClose(resource, timeoutMs) {
  if (!resource) return;
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => resource.close()),
      new Promise((_,reject) => {timer = setTimeout(() => reject(stopUnconfirmed()), timeoutMs);}),
    ]);
  } finally {clearTimeout(timer);}
}

async function closeAssistantResources({broker, client}, {brokerTimeoutMs=5000, clientTimeoutMs=10000}={}) {
  // A blocked broker must never prevent us from attempting to stop the child.
  const outcomes = await Promise.allSettled([boundedClose(broker,brokerTimeoutMs), boundedClose(client,clientTimeoutMs)]);
  if (outcomes.some(outcome => outcome.status === 'rejected')) throw stopUnconfirmed();
}

module.exports = {closeAssistantResources};
