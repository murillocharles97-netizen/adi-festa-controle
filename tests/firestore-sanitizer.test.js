const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs
  .readFileSync("js/firebase/firestore-utils.js", "utf8")
  .replace(/export function /g, "function ")
  .concat("\nthis.api={sanitizeForFirestore};");
const context = vm.createContext({});
vm.runInContext(source, context);
const sanitize = context.api.sanitizeForFirestore;

test("sanitização remove undefined, funções e símbolos recursivamente", () => {
  const input = vm.runInContext(
    `({operationId:undefined,valid:"ok",nullable:null,nested:{drop:undefined,keep:2},fn:()=>1,sym:Symbol("x")})`,
    context,
  );
  const result = sanitize(input);
  assert.equal(result.valid, "ok");
  assert.equal(result.nullable, null);
  assert.deepEqual(Object.keys(result).sort(), ["nested", "nullable", "valid"]);
  assert.deepEqual(Object.keys(result.nested), ["keep"]);
});

test("arrays válidos são preservados e itens indefinidos são removidos", () => {
  const input = vm.runInContext(`[1,undefined,null,{value:true,drop:undefined}]`, context);
  const result = sanitize(input);
  assert.equal(result.length, 3);
  assert.equal(result[0], 1);
  assert.equal(result[1], null);
  assert.equal(result[2].value, true);
});

test("Timestamp e FieldValue preservam identidade para o SDK", () => {
  const values = vm.runInContext(
    `(()=>{class Timestamp{toDate(){return new Date()}toMillis(){return 1}}class FieldValue{constructor(){this._methodName="serverTimestamp"}}return{timestamp:new Timestamp(),fieldValue:new FieldValue()}})()`,
    context,
  );
  const result = sanitize(values);
  assert.equal(result.timestamp, values.timestamp);
  assert.equal(result.fieldValue, values.fieldValue);
});
