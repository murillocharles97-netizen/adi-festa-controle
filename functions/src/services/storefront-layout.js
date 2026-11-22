'use strict';

const {HttpsError}=require('firebase-functions/v2/https');
const templates=new Set(['robot','offers','arrivals','promotion','featured','discover','easy']);
const internalTargets=new Set(['catalog','cart','featured']);
const invalid=message=>{throw new HttpsError('invalid-argument',message);};
function field(value,max){
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))invalid('Texto do banner inválido.');
  return value;
}
function httpsUrl(value) {
  let url;
  try{url=new URL(value);}catch{invalid('Informe um endereço HTTPS válido.');}
  if(url.protocol!=='https:'||url.username||url.password)invalid('Informe um endereço HTTPS válido.');
  return url;
}
function image(value,scope,legacyImages){
  if(!value)return '';
  const url=httpsUrl(value);
  if(legacyImages.has(value) && url.hostname!=='firebasestorage.googleapis.com')return value;
  const match=url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
  const project=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT;
  const allowedBuckets=new Set(project?[project+'.appspot.com',project+'.firebasestorage.app']:[]);
  if(process.env.FIREBASE_CONFIG){
    try{const config=JSON.parse(process.env.FIREBASE_CONFIG);if(config.storageBucket)allowedBuckets.add(config.storageBucket);}catch{}
  }
  let object;
  try{object=match && decodeURIComponent(match[2]);}catch{invalid('Caminho de imagem inválido.');}
  const businessFolder=`businesses/${scope.businessId}/catalog/`;
  const folder=`${businessFolder}spaces/${scope.spaceId}/`;
  const newBanner=object?.startsWith(folder)&&/^banner\/main-[a-zA-Z0-9_-]{1,80}\.(webp|jpg)$/.test(object.slice(folder.length));
  // Retain exact links already saved for this store, including Storage objects
  // created by the previous banner editor and its thumbnail convention.
  const oldBanner=legacyImages.has(value)&&(
    (object?.startsWith(folder)&&/^(?:cover|banner)\/(main|thumb)-[a-zA-Z0-9_-]{1,80}\.(webp|jpg)$/.test(object.slice(folder.length)))||
    (object?.startsWith(businessFolder)&&/^banners\/[a-zA-Z0-9_-]+\/(main|thumb)-[a-zA-Z0-9_-]{1,80}\.(webp|jpg)$/.test(object.slice(businessFolder.length)))
  );
  if(url.hostname!=='firebasestorage.googleapis.com'||url.port||!match||!allowedBuckets.has(match[1])||
    !(newBanner||oldBanner))
    invalid('A arte deve pertencer aos banners desta loja.');
  return value;
}
function readLayout(input,scope,legacyImages=new Set()){
  if(!input||input.version!==1||!Array.isArray(input.slides)||input.slides.length>24||
    typeof input.featured!=='boolean')invalid('Use até 24 slides e um banner secundário.');
  function slide(value){
    if(!value||!templates.has(value.template)||typeof value.active!=='boolean')invalid('Modelo de banner inválido.');
    const target=field(value.target,2000);
    if(!internalTargets.has(target))httpsUrl(target);
    return {template:value.template,title:field(value.title,100),description:field(value.description,300),
      button:field(value.button,40),target,active:value.active,imageUrl:image(field(value.imageUrl,2200),scope,legacyImages)};
  }
  let home;
  if(input.home!==undefined){
    if(!input.home||typeof input.home.search!=='boolean')invalid('Configuração de busca inválida.');
    home={search:input.home.search,placeholder:field(input.home.placeholder,80),featuredTitle:field(input.home.featuredTitle,80)};
  }
  return {version:1,slides:input.slides.map(slide),featured:input.featured,secondary:slide(input.secondary),...(home?{home}:{})};
}
function publicLayout(layout){
  const active=layout.slides.filter(s=>s.active);
  return {...layout,...(layout.home?{home:{...layout.home,placeholder:layout.home.search?layout.home.placeholder:'',featuredTitle:layout.featured?layout.home.featuredTitle:''}}:{}),slides:active,secondary:layout.secondary.active?layout.secondary:{active:false}};
}
module.exports={readLayout,publicLayout};
