const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/renderer/bundle/index.js"), "utf8");

assert.match(source, /automationGenerateVideoRef\.current = generateVideo/);
assert.match(source, /const waitForCanvasState = async \(\{ nodeId, sourceNodeIds = \[\] \} = \{\}\) =>/);
assert.match(source, /currentNodes\.some\(\(node\) => node\.id === nodeId\) && nodesRef\.current\.some/);
assert.match(source, /currentEdges\.some\(\(edge\) => edge\.source === sourceId && edge\.target === nodeId\)/);
assert.doesNotMatch(source, /const waitForCanvasState = \(\) => new Promise\(\(resolve\) => setTimeout\(resolve, 80\)\)/);

// Tianji no longer owns a parallel unapproved raw-reference implementation.
// All three aliases invoke the same guarded root function. Its real factory,
// committed references and actual dispatch are behavior-tested in
// test-application-reference-generation.cjs, not inferred from this regex.
assert.match(source,/generateTianjiVideo: \(args,guard\) => executeApprovedGeneration\("tianji",args,guard\)/);
assert.match(source,/prepareApplicationGenerationReferences\(nodeId,args\.referenceMedia\|\|\[\],nodeFactory\.prepareNodeAt,args\.portraitMedia\|\|\[\]\)/);
assert.match(source,/resolveTianjiPortraits: async \(ids,guard\)/);
assert.match(source,/await waitForCanvasState\(\{nodeId,sourceNodeIds:references\.nodes\.map\(n=>n\.id\)\}\)/);
assert.match(source,/automationGenerateVideoRef\.current\(nodeId/);
const generation=fs.readFileSync(path.join(root,'src/renderer/lib/application-generation.ts'),'utf8');
assert.match(generation,/seedanceMode:'tianji'/);
assert.match(generation,/tianjiSelectedModel:model/);

console.log("automation canvas state: waits for committed nodes/edges and invokes the latest generation callback");
