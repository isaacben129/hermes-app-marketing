import {startLocal} from '../src/service/lifecycle.mjs'
const service=await startLocal({servicePort:Number(process.env.HERMES_MARKETING_SERVICE_PORT??8764),rendererPort:Number(process.env.HERMES_MARKETING_RENDERER_PORT??8765),allowedOrigin:process.env.HERMES_MARKETING_ALLOWED_ORIGIN??null})
console.log(`Marketing service: ${service.server.address().address}:${service.server.address().port}; connection details: ${service.connection}`)
const stop=()=>service.stop().finally(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop)
