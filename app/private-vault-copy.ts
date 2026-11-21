import type {Language} from './i18n';
import copy from '../contracts/e2ee/vault-copy-v1.json' with {type:'json'};
type Copy={title:string;description:string;secret:string;kit:string;kitHint:string;unlock:string;busy:string;error:string;exit:string;privacy:string};
/** Android packages this same catalogue; recovery meaning cannot drift between clients. */
export const PRIVATE_VAULT_COPY:Record<Language,Copy>=copy;
