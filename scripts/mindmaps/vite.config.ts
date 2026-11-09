import base from '../../vite.web.config';
const port = process.env.GENESIS_MINDMAPS === 'true' ? 4319 : 4322;
export default { ...base, server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4320' } },
  preview: { host: '127.0.0.1', port: 4323, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4320' } } };
