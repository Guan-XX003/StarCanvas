// Imported before application modules so their console arguments cannot echo
// request/response bodies, errors, media addresses or user content to DevTools.
import { installRendererDiagnosticConsole } from "./log-utils";
installRendererDiagnosticConsole();
