#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { starcanvasRequest, waitForStarCanvasTask } from "./starcanvas-client.mjs";
import { normalizeTianjiAutomationPayload } from "./starcanvas-tianji-input.mjs";

const usage = "用法：status | models | tasks | image generate | video generate | tianji generate | media import --type image|video|audio --source <path-or-url> | task get|wait|cancel|export | operation submit --json '<request>' | operation get|cancel <id> --receipt <receipt>";
const fail = (error) => { console.error(JSON.stringify({ok:false,code:error?.code||'CLI_ERROR',error:String(error?.message||error),...(error?.permission?{permission:error.permission}:{}),...(error?.idempotencyKey?{idempotencyKey:error.idempotencyKey}:{})})); process.exitCode = 1; };
const option = (args, name, fallback = "") => { const i = args.indexOf(name); return i >= 0 ? String(args[i + 1] || fallback) : fallback; };
const options = (args, name) => args.flatMap((value, index) => value === name && args[index + 1] ? [String(args[index + 1])] : []);
const requiredOptions = (args, name) => args.flatMap((value, index) => {
  if (value !== name) return [];
  const next = args[index + 1];
  if (!next || String(next).startsWith("--")) throw new Error(`${name} 必须提供值`);
  return [String(next)];
});
const print = (value) => console.log(JSON.stringify(value, null, 2));
const cliVersion = (() => {
  try { return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "VERSION.txt"), "utf8").trim(); } catch { return "unknown"; }
})();
const [command = "status", subcommand = "", ...args] = process.argv.slice(2);
const requestScope={...(option(args,'--project')?{projectId:option(args,'--project')}:{}),...(option(args,'--request-id')?{idempotencyKey:option(args,'--request-id')}: {})};

try {
  const referenceIds=requiredOptions(args,'--reference-id'),generationReferences=referenceIds.length?{references:referenceIds}:{};
  if (["--help", "-h", "help"].includes(command)) console.log(`StarCanvas CLI\n${usage}`);
  else if (["--version", "-v", "version"].includes(command)) console.log(cliVersion);
  else if (command === "status") print(await starcanvasRequest("GET", "/v1/status"));
  else if (command === "models") print(await starcanvasRequest("GET", "/v1/models"));
  else if (command === "tasks") print(await starcanvasRequest("GET", "/v1/tasks"));
  else if(command==='operation'&&subcommand==='submit')print(await starcanvasRequest('POST','/v1/operations',JSON.parse(option(args,'--json','{}'))));
  else if(command==='media'&&subcommand==='import')print(await starcanvasRequest('POST','/v1/media/import',{...requestScope,type:option(args,'--type'),source:option(args,'--source')}));
  else if(command==='operation'&&['get','cancel'].includes(subcommand))print(await starcanvasRequest(subcommand==='get'?'GET':'DELETE',`/v1/operations/${encodeURIComponent(args[0]||'')}`,undefined,{operationReceipt:option(args,'--receipt',process.env.STARCANVAS_OPERATION_RECEIPT||'')}));
  else if (command === "image" && subcommand === "generate") print(await starcanvasRequest("POST", "/v1/image/generate", { ...requestScope,...generationReferences,prompt: option(args, "--prompt"), model: option(args, "--model"), size: option(args, "--size", "1024x1024"), referenceImage: option(args, "--reference") }));
  else if (command === "video" && subcommand === "generate") print(await starcanvasRequest("POST", "/v1/video/generate", { ...requestScope,...generationReferences,prompt: option(args, "--prompt"), model: option(args, "--model"), resolution: option(args, "--resolution", "1280x720"), duration: option(args, "--duration"), aspectRatio: option(args, "--ratio"), referenceImage: option(args, "--image") }));
  else if (command === "tianji" && subcommand === "generate") print(await starcanvasRequest("POST", "/v1/tianji/generate", {...requestScope,...normalizeTianjiAutomationPayload({ ...generationReferences,prompt: option(args, "--prompt"), model: option(args, "--model"), resolution: option(args, "--resolution", "720p"), duration: option(args, "--duration", "5"), aspectRatio: option(args, "--ratio", "16:9"), mode: option(args, "--mode"), images: requiredOptions(args, "--image"), portraitAssetIds: requiredOptions(args, "--portrait-asset-id"), videos: requiredOptions(args, "--video"), audios: requiredOptions(args, "--audio") })}));
  else if (command === "task" && subcommand === "get") print(await starcanvasRequest("GET", `/v1/tasks/${encodeURIComponent(args[0] || "")}`));
  else if (command === "task" && subcommand === "export") print(await starcanvasRequest("POST", `/v1/tasks/${encodeURIComponent(args[0] || "")}/export`,requestScope));
  else if (command === "task" && subcommand === "cancel") print(await starcanvasRequest("POST", `/v1/tasks/${encodeURIComponent(args[0] || "")}`,requestScope));
  else if (command === "task" && subcommand === "wait") print(await waitForStarCanvasTask(args[0] || "", { timeoutMs: Number(option(args, "--timeout", "600")) * 1000 }));
  else throw new Error(usage);
} catch (error) { fail(error); }
