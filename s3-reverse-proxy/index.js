import express from 'express';
import httpProxy from 'http-proxy';

const app = express();
const port = 8000;
const Base_path = '' // s3 bucket base address

const proxy = httpProxy.createProxyServer()

app.use((req, res) => {
  const hostname = req.hostname;
  const subdomain = hostname.split('.')[0];

  // Db query to fetch site
  const resolveTo = `${Base_path}/${subdomain}`;
  return proxy.web(req, res, {
    target: resolveTo,
    changeOrigin: true,
  })
});

proxy.on('proxyReq', (proxyReq, req, res) => {
  const url = req.url;
  if (url == '/') {
    proxyReq.path += 'index.html';
  }
})

app.listen(port, () => {
  console.log(`Reverse Proxy Server listening on port ${port}`)
});