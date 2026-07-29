const http = require('http');
const fs = require('fs');
const path = require('path');

const recommend = require('./api/recommend');

const root = __dirname;
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const envScript = `
  <script>
    window.SUPABASE_URL = ${JSON.stringify(process.env.SUPABASE_URL || '')};
    window.SUPABASE_ANON_KEY = ${JSON.stringify(process.env.SUPABASE_ANON_KEY || '')};
    window.SUPABASE_TABLE = ${JSON.stringify(process.env.SUPABASE_TABLE || 'lottery_draws')};
  </script>
`;

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/recommend') return recommend(req, res);

  if (req.url === '/' || req.url === '/index.html') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(indexHtml.replace('</head>', `${envScript}</head>`));
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
