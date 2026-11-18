const test = require("node:test");
const assert = require("node:assert/strict");
const { createDesktopActivityReporter } = require("./desktop-activity.cjs");

test("only a signed-in production account is reported; credentials never go in the body", async () => {
  const sent=[];
  let account="";
  const options={allowed:true,resolveEndpoint:async()=>({apiKey:account,baseURL:"https://api.example.test/"}),
    fetchImpl:async(url,options)=>{sent.push({url,options});return {ok:true};}};
  await createDesktopActivityReporter({...options,allowed:false}).report();
  const reporter=createDesktopActivityReporter({...options,now:()=>60_000});
  await reporter.report();
  assert.equal(sent.length,0);
  account="runtime-test-key";
  await createDesktopActivityReporter({...options,now:()=>120_000}).report();
  assert.equal(sent.length,1);
  assert.equal(sent[0].url,"https://api.example.test/v1/desktop-activity");
  assert.equal(sent[0].options.body,undefined);
  assert.equal(sent[0].options.headers.authorization,"Bearer runtime-test-key");
});

test("one successful signal per minute and account; failed signals can retry",async()=>{
  let clock=60_000;
  let key="account-one";
  let ok=false;
  let sent=0;
  const reporter=createDesktopActivityReporter({allowed:true,now:()=>clock,
    resolveEndpoint:async()=>({apiKey:key,baseURL:"https://api.example.test"}),
    fetchImpl:async()=>{sent++;return {ok};}});
  await reporter.report();assert.equal(sent,1);
  await reporter.report();assert.equal(sent,1);
  clock+=5_000;ok=true;
  await reporter.report();assert.equal(sent,2);
  clock+=5_000;
  await reporter.report();assert.equal(sent,2);
  key="account-two";clock+=5_000;
  await reporter.report();assert.equal(sent,3);
  clock=120_000;
  await reporter.report();assert.equal(sent,4);
});

test("overlapping input actions cannot send overlapping requests",async()=>{
  let release;
  let sent=0;
  const reporter=createDesktopActivityReporter({allowed:true,
    resolveEndpoint:async()=>({apiKey:"test",baseURL:"https://api.example.test"}),
    fetchImpl:async()=>{sent++;await new Promise(resolve=>{release=resolve;});return {ok:true};}});
  const first=reporter.report();
  await new Promise(resolve=>setImmediate(resolve));
  await reporter.report();
  assert.equal(sent,1);
  release();
  await first;
});
