'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall}=require('firebase-functions/v2/https');
const {createOriginEvidenceHandler}=require('./fiado-origin-evidence-handler');

const config=path.resolve(__dirname,'../private');
const policy=JSON.parse(fs.readFileSync(path.join(config,'policy.json'),'utf8'));
const app=initializeApp();
const execute=createOriginEvidenceHandler(getFirestore(app),{access:{
 ...policy,approvedLotBytes:fs.readFileSync(path.join(config,'initial-lot.json'))
}});

exports.reviewFiadoOriginEvidence=onCall({
 region:'southamerica-east1',timeoutSeconds:120,maxInstances:2,concurrency:4
},execute);
