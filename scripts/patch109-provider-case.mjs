/** Patch109 actual Galaga browser session module in simulated browser runtime. */
import assert from 'node:assert/strict';
const scenario=process.argv[2]||'valid',token='K'.repeat(43),id='galaga-qa-launch-01';
const fragments={
 valid:'#provider_launch_token='+token+'&provider_launch_id='+id,
 duplicate:'#provider_launch_token='+token+'&provider_launch_token='+token+'&provider_launch_id='+id,
 duplicateId:'#provider_launch_token='+token+'&provider_launch_id='+id+'&provider_launch_id='+id,
 invalid:'#provider_launch_token=bad&provider_launch_id='+id,
 noId:'#provider_launch_token='+token,
 orphanId:'#provider_launch_id='+id,
 extra:'#provider_launch_token='+token+'&provider_launch_id='+id+'&local=1',
 failed:'#provider_launch_token='+token+'&provider_launch_id='+id,
 demo:'',
}[scenario];
const invalid=new Set(['duplicate','duplicateId','invalid','noId','orphanId','extra']);
assert.notEqual(fragments,undefined);
const where='https://galaga-fe.vercel.app/'+fragments;
const saved=new Map([['galaga.wallet.session.v2:https://galaga-be.onrender.com','old-provider-session']]);
globalThis.location={href:where,hostname:'galaga-fe.vercel.app',protocol:'https:',pathname:'/',
 search:'',hash:fragments};
globalThis.window={location:globalThis.location,localStorage:{
 getItem(){return null;},setItem(){},removeItem(){} }};
globalThis.sessionStorage={
 getItem:k=>saved.get(k)||null,
 setItem:(k,v)=>saved.set(k,String(v)),
 removeItem:k=>saved.delete(k)
};
globalThis.history={state:{},replaceState(_state,_unused,to){
 globalThis.location.hash=to.includes('#')?to.slice(to.indexOf('#')):'';
}};
const requests=[];
globalThis.fetch=async(url,opts)=>{
 requests.push({url,opts});
 if(scenario==='failed')return new Response(
  JSON.stringify({ok:false,code:'PROVIDER_TICKET_EXPIRED',error:'Ticket expired'}),{status:401});
 if(String(url).endsWith('/api/platform/launch')){
  const payload=JSON.parse(opts.body);
  assert.equal(payload.providerLaunchToken,token);
  assert.match(payload.exchangeId,/^[A-Za-z0-9_.:-]{8,128}$/);
  return new Response(JSON.stringify({ok:true,mode:'PROVIDER',token:'galaga-provider-session'}),{status:201});
 }
 throw Error('unexpected:'+url);
};
const {ensurePlatformSession,platformLaunchPresent}=await import('../src/platformSession.js');
if(invalid.has(scenario)){
 await assert.rejects(ensurePlatformSession(),{code:'PROVIDER_LAUNCH_INVALID'});
 assert.equal(requests.length,0);
 assert.equal(saved.get('galaga.wallet.session.v2:https://galaga-be.onrender.com'),undefined);
 assert.equal(platformLaunchPresent(),true);
 assert.equal(globalThis.location.hash,'');
}else if(scenario==='failed'){
 await assert.rejects(ensurePlatformSession(),{code:'PROVIDER_TICKET_EXPIRED'});
 assert.equal(requests.length,1);
 assert.equal(saved.get('galaga.wallet.session.v2:https://galaga-be.onrender.com'),undefined);
}else if(scenario==='valid'){
 const got=await ensurePlatformSession();
 assert.equal(got,'galaga-provider-session');
 assert.equal(saved.get('galaga.wallet.session.v2:https://galaga-be.onrender.com'),got);
 assert.equal(requests.length,1);
 assert.equal(platformLaunchPresent(),true);
 assert.equal(globalThis.location.hash,'');
}else{
 assert.equal(platformLaunchPresent(),false);
 assert.equal(await ensurePlatformSession(),'old-provider-session');
 assert.equal(requests.length,0);
}
console.log('P109 GALAGA '+scenario+': PASS');
