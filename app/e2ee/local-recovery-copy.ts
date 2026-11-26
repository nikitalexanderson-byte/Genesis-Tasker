import copy from '../../contracts/e2ee/local-recovery-copy-v1.json' with {type:'json'};
export const localRecoveryText=(language:string)=>copy.locales[language as keyof typeof copy.locales]??copy.locales.en;
