import { spawn } from 'node:child_process';
for(const file of ['scripts/verify.mjs','.local/run-ui-verification.mjs']){
 console.log(JSON.stringify({phase:'gate_started',file}));
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{windowsHide:true,stdio:['ignore','pipe','pipe']}); child.stdout.on('data',d=>process.stdout.write(d));child.stderr.on('data',d=>process.stderr.write(d));child.once('error',reject);child.once('close',resolve);});
 console.log(JSON.stringify({phase:'gate_closed',file,code}));if(code){process.exitCode=code;break;}
}
