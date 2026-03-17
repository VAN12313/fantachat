const express = require('express');
const http = require('http' );
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app );
const wss = new WebSocket.Server({ server });

// [핵심] 현재 폴더에 있는 모든 파일을 그냥 다 보여주라고 설정 (public 폴더 필요 없음)
app.use(express.static(__dirname));

// [핵심] 누군가 접속하면 바로 옆에 있는 index.html을 강제로 던져줌
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 채팅 기능 (기존과 동일)
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 ${PORT}번 포트에서 돌아가고 있습니다!`);
});
