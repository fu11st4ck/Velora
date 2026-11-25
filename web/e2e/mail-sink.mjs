// Test-only SMTP server for the end-to-end run: accepts every message and stores it as a file in
// e2e/.mail/, so tests can read emails the API sends (invitation and reset links). Speaks just
// enough SMTP for nodemailer (no TLS, no auth). Never used outside `npm run e2e`.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '.mail');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const port = Number(process.env.SMTP_PORT ?? 2525);
let count = 0;

createServer((socket) => {
  let buffer = '';
  let inData = false;
  let data = '';
  let to = [];
  const reply = (line) => socket.write(`${line}\r\n`);
  reply('220 velora-e2e-sink ESMTP');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          count += 1;
          writeFileSync(join(dir, `${Date.now()}-${count}.eml`), `X-Sink-To: ${to.join(',')}\r\n${data}`);
          data = '';
          to = [];
          reply('250 OK stored');
        } else {
          data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
        }
        continue;
      }
      const verb = line.slice(0, 4).toUpperCase();
      if (verb === 'EHLO') reply('250 velora-e2e-sink');
      else if (verb === 'HELO') reply('250 velora-e2e-sink');
      else if (verb === 'MAIL') reply('250 OK');
      else if (verb === 'RCPT') {
        to.push(/<([^>]+)>/.exec(line)?.[1] ?? '');
        reply('250 OK');
      } else if (verb === 'DATA') {
        inData = true;
        reply('354 End data with <CR><LF>.<CR><LF>');
      } else if (verb === 'RSET') reply('250 OK');
      else if (verb === 'NOOP') reply('250 OK');
      else if (verb === 'QUIT') {
        reply('221 Bye');
        socket.end();
      } else reply('502 Not implemented');
    }
  });
  socket.on('error', () => undefined);
}).listen(port, '127.0.0.1', () => console.log(`mail sink on ${port}`));
