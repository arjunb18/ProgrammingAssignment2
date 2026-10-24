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
}).listen(3000, () => console.log('http://localhost:3000'));
