import { execFileSync } from 'node:child_process';
const out=execFileSync(process.env.DOCKER_BIN||'docker',['compose','--env-file','.env.local','-f','infra/compose/compose.yml','exec','-T','gateway','node','--input-type=module','-e',`
import {networkInterfaces} from 'node:os';import {createHash} from 'node:crypto';import {createClient} from 'redis';
if(process.env.APP_ENV!=='local')throw Error('Local verification only');
const redis=createClient({url:process.env.REDIS_URL});await redis.connect();
const spoof='192.0.2.177';const key='rate:'+createHash('sha256').update(spoof+':'+Math.floor(Date.now()/60000)).digest('hex');
const before=await redis.get(key);
const ip=Object.values(networkInterfaces()).flat().find(x=>x && !x.internal && x.family==='IPv4').address;
const actual='rate:'+createHash('sha256').update(ip+':'+Math.floor(Date.now()/60000)).digest('hex');
const count=Number(await redis.get(actual)||0);
const r=await fetch('http://edge:8080/api/v1/account',{headers:{'x-raahi-client-address':spoof,'x-raahi-edge-token':'untrusted','x-forwarded-for':spoof,'x-client-address':spoof}});
if(r.status!==401)throw Error('Edge request did not reach session validation: '+r.status);
if(await redis.get(key)!==before)throw Error('Spoofed address affected rate key');
if(Number(await redis.get(actual))!==count+1)throw Error('Authenticated edge address was not used');
await redis.quit();console.log('Edge request passed; spoofed forwarding headers did not control the rate key.');
`],{encoding:'utf8'});process.stdout.write(out);
