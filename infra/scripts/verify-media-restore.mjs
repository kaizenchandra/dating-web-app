import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
if (!process.argv[2])
  throw Error(
    "Usage: node infra/scripts/verify-media-restore.mjs <backup directory>",
  );
const dir = resolve(process.argv[2]);
const name = "raahi-restore-" + randomBytes(5).toString("hex");
const volume = name + "-data";
const docker = process.env.DOCKER_BIN || "docker";
function run(args) {
  const r = spawnSync(docker, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (r.status !== 0)
    throw Error(
      "Media validation failed at " + args[0] + ": " + r.stderr.slice(0, 400),
    );
  return r.stdout.trim();
}
const network = process.env.RAAHI_TEST_NETWORK || "raahi_default";
run(["volume", "create", volume]);
let started = false;
try {
  run([
    "run",
    "--rm",
    "--network",
    "none",
    "-v",
    volume + ":/data",
    "-v",
    dir + ":/backup:ro",
    "--entrypoint",
    "sh",
    "chrislusf/seaweedfs:4.00",
    "-c",
    "tar -xzf /backup/media.tar.gz -C /data",
  ]);
  run([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    network,
    "--env-file",
    ".env.local",
    "-e",
    "MEDIA_HOST=" + name,
    "-v",
    volume + ":/data",
    "-v",
    resolve("infra/compose/media-entrypoint.sh") + ":/config/start.sh:ro",
    "--entrypoint",
    "sh",
    "chrislusf/seaweedfs:4.00",
    "/config/start.sh",
  ]);
  started = true;
  const script = `
 const {createHmac,createHash}=await import('node:crypto');
 const host=process.env.RESTORED_HOST+':9000';
 const sha=x=>createHash('sha256').update(x).digest('hex');const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
 async function get(path,query=''){
 const date=new Date().toISOString().replace(/[-:]|\\.\\d{3}/g,'');const day=date.slice(0,8);const scope=day+'/us-east-1/s3/aws4_request';const payload=sha('');const canonical='GET\\n'+path+'\\n'+query+'\\nhost:'+host+'\\nx-amz-content-sha256:'+payload+'\\nx-amz-date:'+date+'\\n\\nhost;x-amz-content-sha256;x-amz-date\\n'+payload;
 const key=hmac(hmac(hmac(hmac('AWS4'+process.env.S3_SECRET_KEY,day),'us-east-1'),'s3'),'aws4_request');const signature=hmac(key,'AWS4-HMAC-SHA256\\n'+date+'\\n'+scope+'\\n'+sha(canonical)).toString('hex');
 const r=await fetch('http://'+host+path+(query?'?'+query:''),{headers:{'x-amz-date':date,'x-amz-content-sha256':payload,authorization:'AWS4-HMAC-SHA256 Credential=raahi_media/'+scope+', SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature='+signature},signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('Restored S3 response '+r.status);return r;
 }
 let listing;for(let attempt=0;attempt<30;attempt++){try{listing=await(await get('/profile-photos','list-type=2')).text();break}catch{await new Promise(r=>setTimeout(r,1000))}}
 if(!listing)throw Error('Restored S3 unavailable');const keys=[...listing.matchAll(/<Key>([^<]+)<\\/Key>/g)].map(x=>x[1]);if(!keys.length)throw Error('No restored objects to verify');let count=0;for(const key of keys.slice(0,5)){const bytes=Buffer.from(await(await get('/profile-photos/'+key)).arrayBuffer());if(bytes[0]!==255||bytes[1]!==216)throw Error('Restored JPEG invalid');count++}console.log('Restored private S3: '+keys.length+' objects listed; '+count+' JPEG objects retrieved and validated.');`;
  console.log(
    run([
      "run",
      "--rm",
      "--network",
      network,
      "--env-file",
      ".env.local",
      "-e",
      "RESTORED_HOST=" + name,
      "node:24-bookworm-slim",
      "node",
      "--input-type=module",
      "-e",
      script,
    ]),
  );
} finally {
  if (started) run(["rm", "-f", name]);
  run(["volume", "rm", volume]);
}
