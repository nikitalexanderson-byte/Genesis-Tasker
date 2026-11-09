import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('../../',import.meta.url)),plugins:[react()],
 define:{'process.env.NEXT_PUBLIC_GENESIS_API_URL':JSON.stringify('/unused-qa-api')},
 optimizeDeps:{entries:['scripts/aurora/preview.html','scripts/aurora/dream-preview.html']},
 server:{host:'127.0.0.1',port:4178,strictPort:true,watch:{ignored:['**/android/**','**/output/**','**/dist/**']}},publicDir:'public'});
