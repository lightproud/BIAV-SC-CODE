import http from 'node:http';
import { createNodeFetch } from '/home/user/BIAV-SC-CODE/projects/silver-core-sdk/src/transport/node-http.ts';

function listen(server: http.Server): Promise<string> {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as any).port}`)));
}
const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));

// Test A: server sends Connection: close -> next request must be a NEW socket
{
  let conns = 0;
  const server = http.createServer((req,res)=>{ res.writeHead(200,{'connection':'close'}); res.end('ok'); });
  server.on('connection',()=>conns++);
  const base = await listen(server);
  const nf = createNodeFetch();
  await (await nf(base,{})).text();
  await sleep(20);
  await (await nf(base,{})).text();
  await sleep(20);
  console.log('A Connection:close -> conns (expect 2):', conns);
  const free = Object.values(nf.agents.http.freeSockets).flat();
  console.log('A free sockets after close (expect 0 or 1 fresh):', free.length);
  await new Promise(r=>server.close(r));
}

// Test B: TTL destroy then immediate reuse race window - fire request right at TTL
{
  let conns = 0;
  const server = http.createServer((req,res)=>{ res.writeHead(200); res.end('ok'); });
  server.on('connection',()=>conns++);
  const base = await listen(server);
  const nf = createNodeFetch({ freeSocketTtlMs: 50 });
  await (await nf(base,{})).text();
  await sleep(48); // just before TTL
  await (await nf(base,{})).text(); // should reuse
  await sleep(20);
  console.log('B reuse just before TTL -> conns (expect 1):', conns);
  await new Promise(r=>server.close(r));
}

// Test C: unref/ref balance - does an idle warm pool block exit? (measured via free socket hasRef)
{
  const server = http.createServer((req,res)=>{ res.writeHead(200); res.end('ok'); });
  const base = await listen(server);
  const nf = createNodeFetch();
  await (await nf(base,{})).text();
  await sleep(20);
  const free = Object.values(nf.agents.http.freeSockets).flat() as any[];
  const h = free[0]?._handle;
  console.log('C idle socket hasRef (expect false):', h?.hasRef ? h.hasRef() : 'n/a');
  await new Promise(r=>server.close(r));
}

// Test D: body byteLength for multibyte string content-length
{
  let seenCL: string|undefined;
  const server = http.createServer((req,res)=>{ seenCL = req.headers['content-length'] as string; res.writeHead(200); res.end('ok'); });
  const base = await listen(server);
  const nf = createNodeFetch();
  const body = JSON.stringify({m:'世界'});
  await (await nf(base,{method:'POST',body})).text();
  console.log('D content-length (expect', Buffer.byteLength(body),'):', seenCL);
  await new Promise(r=>server.close(r));
}
process.exit(0);
