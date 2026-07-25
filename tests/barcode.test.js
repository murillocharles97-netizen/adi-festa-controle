const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const source=fs.readFileSync('js/barcode.js','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');
const productsMobile=fs.readFileSync('js/produtos-mobile.js','utf8');
const checkoutMobile=fs.readFileSync('js/checkout-mobile.js','utf8');
const clientsMobile=fs.readFileSync('js/clientes-mobile.js','utf8');
assert.ok(!/getDocs|onSnapshot|firebase-firestore|collection\(/i.test(source),'scanner must not query Firebase or create listeners');
assert.match(worker,/assets\/zxing-browser\.min\.js/);
assert.match(worker,/adi-festa-v54-crm-client-profile/);
assert.match(source,/mode:'sale'/);
assert.match(source,/mode:'products'/);
assert.match(source,/mode:'stock'/);
assert.match(source,/Produto não encontrado/);
assert.match(source,/persistent:true/);
assert.match(source,/openedWhatsAppAt|BarcodeFeedback|navigator\.vibrate/);
assert.match(source,/AudioContext/,'success sound must be generated locally');
assert.ok(!/\.mp3|\.wav|new Audio\(/i.test(source),'scanner sound must not download a remote file');
assert.match(source,/adiBarcodeSound/);
assert.match(source,/adiBarcodeVibration/);
assert.match(source,/label:'Escanear',action:'scan-sale'/);
assert.match(source,/label:'Ler código',action:'scan-product'/);
assert.match(productsMobile,/mobile-product-compact-actions/);
assert.doesNotMatch(productsMobile,/mobile-product-actions/,'the oversized product shortcut row must be removed');
assert.match(checkoutMobile,/primaryAction==='scan-sale'/);
assert.match(clientsMobile,/\['new-client','quick-action'\]\.includes/,'client creation must only handle its own FAB routes');

const stores={empresa_a:{produtos:[],movimentacoesEstoque:[]},empresa_b:{produtos:[],movimentacoesEstoque:[]}};
let active='empresa_a',trackStopped=0,loadCount=0;
const listeners={};
const context={
  console,
  setTimeout,
  clearTimeout,
  Date,
  Map,
  Error,
  String,
  Number,
  Boolean,
  Array,
  Object,
  JSON,
  Promise,
  CSS:{escape:String},
  crypto:{randomUUID:()=>`id_${Math.random()}`},
  location:{hash:'#/produtos'},
  localStorage:{data:{},getItem(key){return this.data[key]??null},setItem(key,value){this.data[key]=String(value)}},
  navigator:{mediaDevices:{
    async getUserMedia(){return{getTracks:()=>[{stop:()=>trackStopped++}],getVideoTracks:()=>[{stop:()=>trackStopped++,getCapabilities:()=>({torch:false})}]}},
    async enumerateDevices(){return[{kind:'videoinput',deviceId:'rear'}]}
  }},
  document:{
    hidden:false,
    addEventListener(type,callback){(listeners[type]??=[]).push(callback)},
    querySelector(){return null},
    createElement(){return{set src(value){this._src=value},dataset:{},addEventListener(){}}},
    head:{append(){}},
    body:{append(){}}
  },
  addEventListener(type,callback){(listeners[type]??=[]).push(callback)},
  dispatchEvent(){},
  CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},
  Utils:{uuid:()=>`id_${Math.random()}`,escapar:String,toast(){}},
  DB:{
    getBusinessId:()=>active,
    carregar:()=>{loadCount++;return stores[active]},
    alterar(mutator){mutator(stores[active]);return stores[active]}
  }
};
context.window=context;
context.BarcodeDetector=class{
  static async getSupportedFormats(){return['ean_13','ean_8','upc_a','code_128']}
  async detect(){return[]}
};
vm.createContext(context);
vm.runInContext(source,context);
vm.runInContext(fs.readFileSync('js/produtos.js','utf8'),context);

assert.equal(context.normalizeBarcode(' 0789 123\u200b456\n'),'0789123456','normalization must preserve leading zero');
const first=context.Produtos.salvar({nome:'Produto A',barcode:'0789123456789',preco:10,estoqueAtual:1});
assert.equal(context.BarcodeIndex.find('0789123456789').id,first.id);
const indexedLoadCount=loadCount;
context.BarcodeIndex.find('0789123456789');
assert.equal(loadCount,indexedLoadCount,'known scans must reuse the local index instead of iterating all products');
assert.throws(()=>context.Produtos.salvar({nome:'Duplicado',barcode:'0789123456789',preco:5}),/já está vinculado/);
context.Produtos.salvar({id:first.id,nome:'Produto A',barcode:'',preco:10,estoqueAtual:1});
assert.equal(context.BarcodeIndex.find('0789123456789'),null,'removing a barcode must invalidate its index');

active='empresa_b';
const second=context.Produtos.salvar({nome:'Outra empresa',barcode:'0789123456789',preco:8});
assert.equal(context.BarcodeIndex.find('0789123456789').id,second.id,'same barcode is allowed in a different business');
active='empresa_a';
assert.equal(context.BarcodeIndex.find('0789123456789'),null,'index must remain isolated by business');

(async()=>{
  const video={srcObject:null,setAttribute(){},async play(){},pause(){}};
  await context.BarcodeScannerService.startScanner({videoElement:video,onDetected(){}});
  assert.equal(context.BarcodeScannerService.isActive(),true);
  context.BarcodeScannerService.stopScanner();
  assert.ok(trackStopped>0,'stopping the scanner must release camera tracks');
  assert.equal(context.BarcodeScannerService.isActive(),false);
  console.log('barcode.test.js: OK');
})().catch(error=>{console.error(error);process.exitCode=1});
