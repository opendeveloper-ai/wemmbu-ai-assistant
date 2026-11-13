const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

async function testRender() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--window-size=1024,487',
    '--disable-gpu',
    'http://127.0.0.1:4173'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  http.get('http://127.0.0.1:9222/json', (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', async () => {
      const tabs = JSON.parse(data);
      const tab = tabs.find(t => t.type === 'page');
      if (tab) {
        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        ws.onopen = async () => {
          ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
          await new Promise(r => setTimeout(r, 3000));
          ws.send(JSON.stringify({ id: 10, method: 'Page.captureScreenshot', params: { format: 'png' } }));
        };
        ws.onmessage = (event) => {
          const parsed = JSON.parse(event.data);
          if (parsed.id === 10 && parsed.result?.data) {
            const buf = Buffer.from(parsed.result.data, 'base64');
            fs.writeFileSync('C:\\Users\\leokh\\.gemini\\antigravity\\brain\\50d7d3f5-9241-4f5e-9230-e06e3251dd71\\test-comparison.png', buf);
            console.log('Saved test comparison');
            ws.close();
            chrome.kill();
          }
        };
      }
    });
  });
}

testRender().catch(console.error);
