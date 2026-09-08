import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const handlers = {}, calls = [];
let offline = false, cacheTouches = 0;
vm.runInNewContext(code, {
  URL, Request, Response, AbortController, console, setTimeout, clearTimeout,
  self: { registration:{scope:'https://example.test/3d-heart-pwa/'}, addEventListener:(k,f)=>handlers[k]=f },
  caches:{open:async()=>{cacheTouches++;return{match:async()=>new Response('cached-heart'),put:async()=>{}};}},
  fetch:async(req,options)=>{calls.push(options);if(offline)throw new Error('offline');return new Response('fresh-bus');}
});
const dispatch = (path, mode='navigate') => {
  let result;
  handlers.fetch({request:{url:new URL(path,'https://example.test').href,method:'GET',mode},respondWith:p=>{result=p;}});
  return result;
};
test('bus HTML and assets bypass the old app cache, including query URLs',async()=>{
  for(const path of ['/3d-heart-pwa/bus/','/3d-heart-pwa/bus/v2.html?reload=1','/3d-heart-pwa/bus/app.v2.mjs','/3d-heart-pwa/bus']){
    assert.equal(await(await dispatch(path)).text(),'fresh-bus');
    assert.equal(calls.at(-1).cache,'no-store');
  }
  assert.equal(cacheTouches,0);
});
test('offline bus returns explicit 503, never cached HTML or stale arrivals',async()=>{
  offline=true;
  assert.equal((await dispatch('/3d-heart-pwa/bus/')).status,503);
  assert.equal((await dispatch('/3d-heart-pwa/bus/app.v2.mjs','cors')).status,503);
  assert.equal(cacheTouches,0);
});
test('existing heart navigation retains offline cache behavior',async()=>{
  offline=true;
  assert.equal(await(await dispatch('/3d-heart-pwa/luobu.html')).text(),'cached-heart');
});
test('worker scope does not affect other sites or unrelated paths',async()=>{
  assert.equal(dispatch('https://other.test/3d-heart-pwa/bus/'),undefined);
  assert.equal(dispatch('/another-app/'),undefined);
});
