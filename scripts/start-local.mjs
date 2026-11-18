import {startLocal} from '../src/service/lifecycle.mjs'
import {readFileSync,statSync} from 'node:fs'
import {parse} from '../src/ops/secrets.mjs'
const secretFile=process.env.HERMES_MARKETING_SECRETS_FILE
if(secretFile){
  try {
    if (process.platform !== 'win32') {
      const mode=statSync(secretFile).mode & 0o777
      if((mode & 0o077)!==0) throw new Error('Marketing secrets file permissions must be owner-only (0600)')
    }
    const values=parse(readFileSync(secretFile,'utf8'))
    for(const [key,value] of Object.entries(values)) process.env[key]=value
  } catch(error) {
    if(error.code === 'ENOENT') throw new Error('Configured marketing secrets file does not exist')
    throw error
  }
}
const service=await startLocal({servicePort:Number(process.env.HERMES_MARKETING_SERVICE_PORT??8764),rendererPort:Number(process.env.HERMES_MARKETING_RENDERER_PORT??8765),allowedOrigin:process.env.HERMES_MARKETING_ALLOWED_ORIGIN??'null'})
console.log(`Marketing service: ${service.server.address().address}:${service.server.address().port}; connection details: ${service.connection}`)
const stop=()=>service.stop().finally(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop)
