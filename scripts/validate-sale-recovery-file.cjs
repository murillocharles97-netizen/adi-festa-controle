'use strict';
// Offline validation only. This script never initializes Firebase or calls a service.
const fs=require('node:fs'),crypto=require('node:crypto'),client=require('../js/sale-recovery-client');
async function validate(file,unlockCode){
  const data=await client.openExport(file,unlockCode,crypto.webcrypto);
  const {validateOriginal}=require('../functions/src/services/sale-recovery-service');
  for(const record of data.records){const parsed=validateOriginal(record,data.identity.uid,data.identity.businessId);if(parsed.operationId!==record.operationId||parsed.saleId!==record.saleId||parsed.spaceId!==record.spaceId)throw Error('Identidade divergente na validação do servidor.');}
  return{valid:true,purpose:data.purpose,businessId:data.identity.businessId,operations:data.records.map(r=>({operationId:r.operationId,saleId:r.saleId,spaceId:r.spaceId,contentHash:r.contentHash,payloadHash:r.payloadHash})),commercialEffects:false};
}
module.exports={validate};
if(require.main===module)(async()=>{
  const file=process.argv[2];if(!file||!process.env.VECONI_RECOVERY_FILE_KEY)throw Error('Informe o arquivo e o código na variável privada VECONI_RECOVERY_FILE_KEY. Não coloque o código nos argumentos ou no relatório.');
  if(fs.statSync(file).size>25*1024*1024)throw Error('Arquivo acima do limite seguro.');
  console.log(JSON.stringify(await validate(JSON.parse(fs.readFileSync(file,'utf8')),process.env.VECONI_RECOVERY_FILE_KEY),null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
