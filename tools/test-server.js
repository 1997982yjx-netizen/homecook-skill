#!/usr/bin/env node
/*
 * 测试 server.js 的静态路由：白名单、目录穿越、400/404/405、HEAD、PWA 文件。不访问网络。
 *   node tools/test-server.js
 */
'use strict';
const assert = require('assert');
const http = require('http');
const { createServer } = require('../server.js');

let n = 0;
function test(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

function request(server, path, method) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: method || 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const home = await request(server, '/');
    assert.strictEqual(home.status, 200);
    assert.ok(/text\/html/.test(home.headers['content-type']));
    assert.ok(/做饭/.test(home.body));

    const js = await request(server, '/cook.js');
    assert.strictEqual(js.status, 200);
    assert.ok(/javascript/.test(js.headers['content-type']));
    n += 2; console.log('  ✓ 首页和 cook.js 能取到');

    const manifest = await request(server, '/manifest.json');
    assert.strictEqual(manifest.status, 200);
    assert.ok(/manifest\+json/.test(manifest.headers['content-type']));
    const sw = await request(server, '/sw.js');
    assert.strictEqual(sw.status, 200);
    const core = await request(server, '/core/dict-utils.js');
    assert.strictEqual(core.status, 200);
    n += 3; console.log('  ✓ PWA manifest、Service Worker、core 脚本都能取到');

    const head = await request(server, '/', 'HEAD');
    assert.strictEqual(head.status, 200);
    assert.strictEqual(head.body, '');
    n += 1; console.log('  ✓ HEAD 只回头不回正文');

    const pkg = await request(server, '/package.json');
    assert.strictEqual(pkg.status, 404);
    const secret = await request(server, '/server.js');
    assert.strictEqual(secret.status, 404);
    const trav = await request(server, '/%2e%2e/package.json');
    assert.strictEqual(trav.status, 404);
    const rawTrav = await request(server, '/..%2f..%2fetc%2fpasswd');
    assert.strictEqual(rawTrav.status, 404);
    n += 4; console.log('  ✓ 非白名单文件、服务端代码和目录穿越都返回 404');

    const bad = await request(server, '/%E0%A4%A');
    assert.strictEqual(bad.status, 400);
    n += 1; console.log('  ✓ 畸形路径返回 400 不会崩溃');

    const post = await request(server, '/', 'POST');
    assert.strictEqual(post.status, 405);
    n += 1; console.log('  ✓ 非 GET/HEAD 返回 405');

    const still = await request(server, '/');
    assert.strictEqual(still.status, 200);
    n += 1; console.log('  ✓ 出错之后服务仍然可用');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(`\n${n} 项测试全部通过。`);
})().catch((e) => { console.error(e); process.exit(1); });
