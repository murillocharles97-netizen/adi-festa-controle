'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {disabledNativeProbe}=require('../src/native-probe');
test('native real endpoint refusal is required; proofs remain in POST body only',async()=>{
 const probe=disabledNativeProbe({apiKey:'AIza-not-real-test-only',fetchImpl:async(url,request)=>{assert.equal(new URL(url).hostname,'identitytoolkit.googleapis.com');assert.equal(new URL(url).searchParams.get('id_token'),null);assert.equal(request.method,'POST');const data=JSON.parse(request.body);assert.equal(new URLSearchParams(data.postBody).get('id_token'),'synthetic-test-proof');assert.equal(data.returnIdpCredential,false);return{status:400,json:async()=>({error:{message:'OPERATION_NOT_ALLOWED'}})};}});
 assert.deepEqual(await probe('synthetic-test-proof','https://qa.test'),{blocked:true});
});
for(const [status,code]of [[200,''],[400,'INVALID_IDP_RESPONSE'],[403,'PERMISSION_DENIED']])test('unexpected native result '+status+'/'+code+' remains NO-GO',async()=>{const probe=disabledNativeProbe({apiKey:'AIza-not-real-test-only',fetchImpl:async()=>({status,json:async()=>({error:{message:code}})})});await assert.rejects(probe('synthetic-test-proof','https://qa.test'),{code:'native-block-unconfirmed'});});
test('canonical disabled-provider code accepts the documented production description without broadening errors',async()=>{const probe=disabledNativeProbe({apiKey:'AIza-not-real-test-only',fetchImpl:async()=>({status:400,json:async()=>({error:{message:'OPERATION_NOT_ALLOWED : The identity provider configuration is disabled.'}})})});assert.deepEqual(await probe('synthetic-test-proof','https://qa.test'),{blocked:true});});
