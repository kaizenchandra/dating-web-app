import {execFileSync} from 'node:child_process';
import {expect,type Browser,type BrowserContext} from '@playwright/test';
export const origin=process.env.TEST_BASE_URL||'http://localhost:3000';
export function resetOtp(phones:string[]){if(phones.some(p=>!/^\+9160000000\d{2}$/.test(p)))throw Error('Only reserved local test fixtures can be reset');execFileSync(process.env.DOCKER_BIN||'docker',['compose','--env-file','.env.local','-f','infra/compose/compose.yml','exec','-T','identity','node','--input-type=module','-e',`import pg from 'pg';if(process.env.APP_ENV!=='local')throw Error('Local fixtures only');const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query('DELETE FROM otp_challenges WHERE phone=ANY($1)',[JSON.parse(process.argv[1])]);await db.end();`,JSON.stringify(phones)],{stdio:'pipe'})}
export async function member(browser:Browser,phone:string,name:string,gender:string){
 const context=await browser.newContext({permissions:['camera']});const page=await context.newPage();
 await page.goto('/login');await page.getByLabel('Indian mobile number').fill(phone.slice(3));await page.getByRole('button',{name:'Send local test code'}).click();await page.getByLabel('Six-digit code').fill(await page.getByTestId('local-code').innerText());await page.getByRole('button',{name:'Verify & continue'}).click();await expect(page).toHaveURL(/onboarding/);
 const request=context.request;const headers={origin};
 for(const [path,data,method] of [
 ['/account/consent',{displayName:name,adult:true,indiaResident:true,terms:true},'post'],
 ['/account/preferences',{paused:false},'patch'],
 ['/verification/start',{route:'local',consent:true,dateOfBirth:'1997-04-20'},'post'],
 ['/verification/local-decision',{decision:'approved'},'post'],
 ] as const){const response=await request[method](origin+'/api/v1'+path,{headers,data});expect(response.status()).toBe(200)}
 const profile=await (await request.get(origin+'/api/v1/profile')).json();const saved=await request.put(origin+'/api/v1/profile',{headers,data:{...profile.profile,displayName:name,gender,city:'Bengaluru',intent:'Long-term relationship',bio:'Books, music, and a curious mind.',preferredGender:'Any',minAge:18,maxAge:50,longDistance:false,incognito:false}});expect(saved.status()).toBe(200);
 await page.goto('/profile');await page.getByRole('button',{name:'Open camera',exact:true}).click();await page.waitForFunction(()=>{const v=document.querySelector('video');return !!v&&v.videoWidth>0});await page.getByRole('button',{name:'Capture photo',exact:true}).click();await page.getByRole('button',{name:'Use this photo',exact:true}).click();await expect(page.getByText('Photo saved. Review is pending; replacement resets photo approval.')).toBeVisible();await page.getByRole('button',{name:'Simulate photo approval'}).click();await expect(page.getByText('Photo review simulated.')).toBeVisible();
 const account=await (await request.get(origin+'/api/v1/account')).json();return {context,page,id:account.id as string};
}
export async function connection(context:BrowserContext,targetId:string,action:string){return context.request.post(origin+'/api/v1/connections/action',{headers:{origin},data:{targetId,action}})}
