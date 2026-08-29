import CDP from 'chrome-remote-interface';
const PORT = 9537;
const b = await CDP({ port: PORT });
const { targetInfos } = await b.send('Target.getTargets');
for (const t of targetInfos) console.log(t.type.padEnd(16), (t.url||'').slice(0,80), t.attached);
b.close();
