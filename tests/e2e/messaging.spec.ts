import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {member,resetOtp,connection,origin} from '../../packages/test-fixtures/browser';
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}});
test.beforeAll(()=>resetOtp(['+916000000007','+916000000008']));
test('two sessions exchange durable messages, retry without duplicates, reconnect and lose access on block',async({browser})=>{
 test.setTimeout(90000);const a=await member(browser,'+916000000007','Ira','Woman');const b=await member(browser,'+916000000008','Dev','Man');
 try{
 await connection(a.context,b.id,'unblock');await connection(b.context,a.id,'unblock');await connection(a.context,b.id,'unmatch');await connection(a.context,b.id,'like');const match=await (await connection(b.context,a.id,'like')).json();expect(match.matched).toBe(true);const id=match.matchId;
 await a.page.goto('/inbox?match='+id);await b.page.goto('/inbox?match='+id);await expect(a.page.getByText('Live',{exact:true})).toBeVisible();await expect(b.page.getByText('Live',{exact:true})).toBeVisible();
 await a.page.getByLabel('Message',{exact:true}).fill('Hello Dev, what made you smile today?');await a.page.getByRole('button',{name:'Send →',exact:true}).click();await expect(b.page.getByRole('log').getByText('Hello Dev, what made you smile today?',{exact:true})).toBeVisible();
 await b.page.getByLabel('Message',{exact:true}).fill('A long walk and this hello 😊');await b.page.getByRole('button',{name:'Send →',exact:true}).click();await expect(a.page.getByRole('log').getByText('A long walk and this hello 😊',{exact:true})).toBeVisible();
 const clientMessageId=randomUUID();const data={conversationId:id,clientMessageId,text:'One persisted message, even after a retry.'};const responses=await Promise.all(Array.from({length:6},()=>a.context.request.post(origin+'/api/v1/messages',{headers:{origin},data})));for(const response of responses)expect(response.status()).toBe(200);const ids=await Promise.all(responses.map(async r=>(await r.json()).id));expect(new Set(ids).size).toBe(1);
 const history=await (await b.context.request.get(origin+'/api/v1/messages?conversationId='+id)).json();expect(history.messages.filter((m:{text:string})=>m.text===data.text)).toHaveLength(1);
 expect((await a.context.request.post(origin+'/api/v1/messages',{headers:{origin},data:{...data,text:'Different content'}})).status()).toBe(409);
 const outsider=await browser.newContext();expect((await outsider.request.get(origin+'/api/v1/messages?conversationId='+id)).status()).toBe(401);await outsider.close();
 // Restart only the real communication service; persisted history and sockets must recover.
 execFileSync(process.env.DOCKER_BIN||'docker',['compose','--env-file','.env.local','-f','infra/compose/compose.yml','restart','communication'],{stdio:'pipe'});
 await expect.poll(async()=>{try{return(await a.context.request.get(origin+'/api/v1/messages?conversationId='+id)).status()}catch{return 0}},{timeout:20000}).toBe(200);
 await a.page.reload();await expect(a.page.getByRole('log').getByText(data.text,{exact:true})).toBeVisible();await expect(a.page.getByText('Live',{exact:true})).toBeVisible();
 await a.page.getByRole('button',{name:'Block',exact:true}).click();await expect(a.page.getByText('Blocked. Communication access has ended.')).toBeVisible();await expect(b.page.getByLabel('Message',{exact:true})).toBeDisabled({timeout:10000});
 expect((await b.context.request.post(origin+'/api/v1/messages',{headers:{origin},data:{conversationId:id,clientMessageId:randomUUID(),text:'Must not persist'}})).status()).toBe(403);
 expect((await b.context.request.get(origin+'/api/v1/messages?conversationId='+id)).status()).toBe(403);
 }finally{await a.context.close();await b.context.close()}
});
