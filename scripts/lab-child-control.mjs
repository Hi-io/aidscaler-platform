// A private parent/child IPC message invokes the entry point's existing graceful
// shutdown handler inside JavaScript. Windows process.kill is not a substitute:
// it can terminate Node without letting stores and workers finish.
const token=process.env.AIDSCALER_CHILD_CONTROL_TOKEN;
let stopping=false;
if(process.send&&token)process.on('message',message=>{
  if(message?.type!=='aidscaler-lab-shutdown'||message.token!==token||stopping)return;
  stopping=true;
  const stop=()=>{
    if(process.listenerCount('SIGTERM'))process.emit('SIGTERM');
    else setTimeout(stop,50).unref();
  };
  stop();
});
