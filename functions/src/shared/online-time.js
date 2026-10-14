'use strict';
const {Timestamp}=require('firebase-admin/firestore');
const millis=value=>typeof value?.toMillis==='function'?value.toMillis():typeof value?.seconds==='number'?value.seconds*1000+(value.nanoseconds||0)/1e6:new Date(value).getTime();
function serialize(value){
  if(value==null)return value;
  if(typeof value.toDate==='function')return value.toDate().toISOString();
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(serialize);
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,serialize(v)]));
  return value;
}
module.exports={Timestamp,millis,serialize};
