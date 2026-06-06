import 'dotenv/config';
import express from 'express';
import httpProxy from 'http-proxy';

const app = express();
const port = process.env.PORT || 8080;
const S3_BASE_URL = process.env.S3_BASE_URL || '';

// Split S3_BASE_URL into origin (protocol+host) and path prefix (bucket path)
// This lets us control the full path sent to the upstream storage
// e.g. http://localhost:9000/sideops → origin: http://localhost:9000, prefix: /sideops
let s3Origin = '';
let s3PathPrefix = '';
if (S3_BASE_URL) {
  try {
    const parsed = new URL(S3_BASE_URL);
    s3Origin = `${parsed.protocol}//${parsed.host}`;
    s3PathPrefix = parsed.pathname.replace(/\/+$/, ''); // strip trailing slash
  } catch {
    console.error(`[proxy] Invalid S3_BASE_URL: ${S3_BASE_URL}`);
  }
}

const proxy = httpProxy.createProxyServer();

app.use((req, res) => {
  if (!s3Origin) {
    return res.status(500).json({ error: 'S3_BASE_URL is not configured' });
  }

  const hostname = req.hostname;
  const subdomain = hostname.split('.')[0];

  // Store subdomain on the request object so proxyReq handler can use it
  req.subdomain = subdomain;

  return proxy.web(req, res, {
    target: s3Origin,
    changeOrigin: true,
  });
});

proxy.on('proxyReq', (proxyReq, req, _res) => {
  const subdomain = req.subdomain;
  // Add index.html fallback and prepend /<bucket>/<projectId>/dist/
  const reqPath = req.url === '/' ? '/index.html' : req.url;
  proxyReq.path = `${s3PathPrefix}/${subdomain}/dist${reqPath}`;
});

app.listen(port, () => {
  console.log(`Reverse Proxy Server listening on port ${port}`);
});