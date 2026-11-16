#!/usr/bin/env node

// Set STARCANVAS_CANDIDATE_APP to a candidate .app (Mac) or .exe (Windows).
// No development Electron is loaded in packaged mode. Explicit restart/upgrade
// profiles must be under the OS temporary root; normal launches use a fresh one.
const { spawn } = require("node:child_process");
const {createCandidateLaunchPlan} = require('./candidate-launch-plan.cjs');

if (require.main === module) {
  try {
    const plan = createCandidateLaunchPlan();
    console.log(JSON.stringify({status:'CANDIDATE_LAUNCH',kind:plan.kind,userDataPath:plan.userDataPath}));
    const child = spawn(plan.command,plan.args,{cwd:plan.cwd,env:plan.env,stdio:'inherit'});
    child.once('error',()=>{console.error('CANDIDATE_LAUNCH_FAILED');process.exitCode=1;});
    child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
  } catch (error) {
    console.error(error?.code || 'CANDIDATE_LAUNCH_FAILED'); process.exitCode=1;
  }
}
