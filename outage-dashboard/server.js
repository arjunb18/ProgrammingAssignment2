// Local dev server: node server.js  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const outages = require('./api/outages');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/outages') {
    req.query = Object.fromEntries(url.searchParams);
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (o) => (res.setHeader('content-type', 'application/json'), res.end(JSON.stringify(o)));
    return outages(req, Object.assign(res, { json: res.json }));
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
}).listen(process.env.PORT || 3000, '0.0.0.0', () => {
  const port = process.env.PORT || 3000;
  console.log(`Local:   http://localhost:${port}`);
  for (const list of Object.values(require('os').networkInterfaces()))
    for (const i of list) if (i.family === 'IPv4' && !i.internal) console.log(`On phone: http://${i.address}:${port}`);
});
