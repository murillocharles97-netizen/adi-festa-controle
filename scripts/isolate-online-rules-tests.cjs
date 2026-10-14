'use strict';
// Test-only project routing. Transactions/Auth/Rules/Storage SDKs stay real.
// A fresh Firestore namespace prevents old immutable receipts contaminating a
// repeated suite; Storage cross-service lookups use the emulator's CLI project.
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8097'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9097'||process.env.FIREBASE_STORAGE_EMULATOR_HOST!=='127.0.0.1:9297'||process.env.VECONI_EMULATOR_PROJECT_ID!=='demo-veconi-rules-qa'||!/^demo-veconi-rules-run-[a-z0-9]+$/.test(process.env.VECONI_RULES_RUN_ID||''))throw Error('Isolated rule-test emulators required');
const Module=require('node:module'),load=Module._load;
const project=id=>id==='adi-festa-variations-test'?process.env.VECONI_RULES_RUN_ID:id;
Module._load=function(name,parent,isMain){
 const sdk=load.call(this,name,parent,isMain);
 if(name==='@firebase/rules-unit-testing')return {...sdk,initializeTestEnvironment:options=>sdk.initializeTestEnvironment({...options,projectId:options.storage?process.env.VECONI_EMULATOR_PROJECT_ID:project(options.projectId)})};
 if(name==='firebase-admin/app')return {...sdk,initializeApp:(options,...rest)=>sdk.initializeApp({...options,projectId:project(options?.projectId)},...rest)};
 return sdk;
};
